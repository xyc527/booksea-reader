// 跨书源搜索调度（纯逻辑，网络由注入的 run 提供）
// 目标：分批并发、谁先回来先展示、单个源慢/挂不影响整体、相同请求不重复发。

import { groupResults, rank } from './dedupe.js'

export function cacheKey(sourceId, kw, page) {
  return String(sourceId) + '\u0001' + String(kw).trim().toLowerCase() + '\u0001' + (page || 1)
}

function nowMs() {
  return Date.now()
}

// 简洁的 TTL 缓存 + 进行中请求去重
export function createCache(ttlMs) {
  const store = {}
  const inflight = {}
  const ttl = ttlMs || 10 * 60 * 1000
  return {
    get: function (k) {
      const e = store[k]
      if (!e) return null
      if (nowMs() - e.at > ttl) { delete store[k]; return null }
      return e.value
    },
    set: function (k, v) {
      store[k] = { at: nowMs(), value: v }
    },
    clear: function (prefix) {
      if (!prefix) {
        for (const k in store) delete store[k]
        return
      }
      for (const k in store) if (k.indexOf(prefix) === 0) delete store[k]
    },
    size: function () {
      let n = 0
      for (const k in store) n++
      return n
    },
    // 同 key 只跑一次；后来的等同一个 Promise
    once: function (k, fn) {
      if (inflight[k]) return inflight[k]
      const p = Promise.resolve()
        .then(fn)
        .then(function (v) { delete inflight[k]; return v }, function (e) { delete inflight[k]; throw e })
      inflight[k] = p
      return p
    },
    inflightCount: function () {
      let n = 0
      for (const k in inflight) n++
      return n
    }
  }
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise
  let timer = null
  const guard = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error('timeout ' + (label || ''))) }, ms)
  })
  return Promise.race([promise, guard]).then(function (v) {
    if (timer) clearTimeout(timer)
    return v
  }, function (e) {
    if (timer) clearTimeout(timer)
    throw e
  })
}

// 主入口
// cfg = {
//   kw, page, sources:[{id,name,priority,enabled,searchOne(kw,page)->Promise<items>}],
//   concurrency=3, timeout=8000, overallTimeout=15000,
//   cache, dedupe=true, onPartial(groups, stats), retry=1, refresh=false
// }
export function searchAll(cfg) {
  const c = cfg || {}
  const kw = String(c.kw == null ? '' : c.kw).trim()
  const page = c.page || 1
  const cache = c.cache || createCache(c.cacheTtl)
  const concurrency = Math.max(1, c.concurrency || 3)
  const timeout = c.timeout || 8000
  const overall = c.overallTimeout || Math.max(timeout, 15000)
  const retry = c.retry == null ? 1 : c.retry
  const started = nowMs()
  const stats = { total: 0, done: 0, ok: 0, fail: 0, timeout: 0, cached: 0, ms: 0, errors: [] }
  const items = []
  const finished = {}
  let cancelled = false

  const enabled = (c.sources || []).filter(function (s) { return s && s.enabled !== false })
  enabled.sort(function (a, b) {
    const pa = a.priority == null ? 99 : a.priority
    const pb = b.priority == null ? 99 : b.priority
    return pa - pb
  })
  stats.total = enabled.length

  function emit() {
    if (cancelled || typeof c.onPartial !== 'function') return
    const groups = build(c.dedupe !== false)
    stats.ms = nowMs() - started
    c.onPartial(groups, stats)
  }

  function build(dedupeOn) {
    const g = groupResults(items, { dedupe: dedupeOn })
    return rank(g, kw, {})
  }

  function addItems(list, src) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (!it || !it.title) continue
      items.push({
        sourceId: src.id,
        sourceName: src.name,
        priority: src.priority == null ? 99 : src.priority,
        status: src.status || 'untested',
        title: it.title,
        author: it.author || '',
        url: it.url || '',
        bid: it.bid || '',
        cover: it.cover || '',
        intro: it.intro || '',
        kind: it.kind || '',
        lastChapter: it.lastChapter || '',
        wordCount: it.wordCount || '',
        vars: it.vars || null
      })
    }
  }

  async function runOne(src) {
    const key = cacheKey(src.id, kw, page)
    const hit = c.refresh ? null : cache.get(key)
    if (hit) {
      stats.cached++
      stats.done++
      addItems(hit, src)
      return { id: src.id, ok: true, cached: true, count: hit.length }
    }
    let lastErr = ''
    for (let attempt = 0; attempt <= retry; attempt++) {
      if (cancelled) return { id: src.id, ok: false, error: 'cancelled' }
      try {
        const v = await withTimeout(Promise.resolve().then(function () { return src.searchOne(kw, page) }), timeout, src.id)
        const list = Array.isArray(v) ? v : (v && v.items) || []
        cache.set(key, list)
        stats.done++
        stats.ok++
        addItems(list, src)
        return { id: src.id, ok: true, count: list.length, ms: nowMs() - started }
      } catch (e) {
        lastErr = String((e && e.message) || e)
        if (lastErr.indexOf('timeout') >= 0) stats.timeout++
        if (attempt === retry) {
          stats.done++
          stats.fail++
          stats.errors.push({ sourceId: src.id, name: src.name, error: lastErr })
          return { id: src.id, ok: false, error: lastErr }
        }
      }
    }
    return { id: src.id, ok: false, error: lastErr }
  }

  const promise = new Promise(function (resolve) {
    let idx = 0
    let active = 0
    let settled = 0
    let killer = null

    // 统一出口：清掉兜底定时器（否则一次搜索结束后定时器还会挂着，
    // 设备上会残留一堆计时器影响后面的请求）
    function done(payload) {
      if (killer) {
        clearTimeout(killer)
        killer = null
      }
      resolve(payload)
    }

    function next() {
      if (cancelled) return
      if (idx >= enabled.length && active === 0) {
        stats.ms = nowMs() - started
        done({ items: items, groups: build(c.dedupe !== false), stats: stats, cancelled: cancelled })
        return
      }
      while (active < concurrency && idx < enabled.length) {
        const src = enabled[idx++]
        active++
        settled++
        runOne(src)
          .catch(function () { return { id: src.id, ok: false } })
          .then(function (r) {
            active--
            finished[src.id] = r
            emit()
            next()
          })
      }
      if (idx >= enabled.length && active === 0) {
        stats.ms = nowMs() - started
        done({ items: items, groups: build(c.dedupe !== false), stats: stats, cancelled: cancelled })
      }
    }

    killer = setTimeout(function () {
      cancelled = true
      stats.ms = nowMs() - started
      done({ items: items, groups: build(c.dedupe !== false), stats: stats, cancelled: true })
    }, overall)

    next()
  })

  return {
    promise: promise,
    stats: function () { return stats },
    cancel: function () {
      cancelled = true
      return { items: items, groups: build(c.dedupe !== false), stats: stats, cancelled: true }
    }
  }
}

// 只搜指定来源（切换来源后补搜用）
export function searchSubset(cfg, sourceIds) {
  const set = {}
  for (let i = 0; i < (sourceIds || []).length; i++) set[sourceIds[i]] = 1
  const c = Object.assign({}, cfg, {
    sources: (cfg.sources || []).filter(function (s) { return set[s.id] })
  })
  return searchAll(c)
}
