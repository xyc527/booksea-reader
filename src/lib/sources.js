// 书源注册表：把「原生源」与「Legado 导入源」统一成同一种记录与适配器
// 纯逻辑，不碰网络；抓取由 platform 注入。

import { makeAdapter, classify, normalizeImport, hash, absUrl } from './legado.js'
import { parseSearch, parseToc, parseChapter, tidy } from './parse.js'
import { LN_SITES, siteOf, parseBookUrl } from './lightnovel.js'

export const NATIVE_ID = 'native_washai'
// 轻小说源不走 Legado 规则（那批规则的核心是 @js 打站点私有 API，本项目没有 JS 引擎），
// 用 lightnovel.js 里的声明式接口实现，id 统一加前缀方便识别与迁移。
export const LN_PREFIX = 'ln_'

export function normUrl(u) {
  return String(u == null ? '' : u)
    .split('#')[0]
    .replace(/\/+$/, '')
}

export function bidOf(url, sourceId) {
  const s = String(url || '')
  const m = s.match(/\/(?:book\/)?(\d{4,})(?:\.html|\/|$)/)
  if (m && !sourceId) return m[1]
  return hash((sourceId || '') + '|' + s)
}

// ---------- 原生源（书海阁）----------

export function makeNative(baseUrl) {
  const base = normUrl(baseUrl)
  return {
    id: NATIVE_ID,
    name: '书海阁',
    kind: 'native',
    baseUrl: base,
    searchRequest: function (kw, page) {
      let u = base + '/book/bookclass.html?k=' + encodeURIComponent(String(kw || ''))
      if (page && page > 1) u += '&page=' + page
      return { url: u, method: 'GET', body: '', charset: 'utf-8' }
    },
    parseSearch: function (html) {
      const list = parseSearch(html)
      const out = []
      for (let i = 0; i < list.length; i++) {
        const b = list[i]
        out.push({
          title: b.title,
          author: b.author,
          url: base + '/book/' + b.bid + '.html',
          bid: String(b.bid),
          cover: '',
          intro: b.desc || '',
          kind: b.meta || '',
          lastChapter: b.last || '',
          wordCount: '',
          vars: null
        })
      }
      return out
    },
    tocRequest: function (book, pageNo) {
      const n = pageNo || 1
      const bid = String(book.bid || '')
      const u = n <= 1 ? base + '/book/indexList-' + bid + '.html' : base + '/book/indexList/' + bid + '/' + n + '.html'
      return { url: u, method: 'GET', body: '', charset: 'utf-8' }
    },
    parseToc: function (html, book) {
      const r = parseToc(html, book && book.bid)
      const total = r.total || 0
      const pages = r.pages || 1
      return { chapters: r.chapters.map(function (c, i) {
        return { cid: String(c.cid || i + 1), title: c.title, url: '' }
      }), total: total, pages: pages }
    },
    chapterRequest: function (book, ch) {
      return { url: base + '/book/' + String(book.bid) + '/' + String(ch.cid) + '.html', method: 'GET', body: '', charset: 'utf-8' }
    },
    parseChapter: function (html) {
      // 统一适配器的约定是「返回正文纯文本」；原生解析器返回的是
      // {title, paras, chars}，直接透传会让调用方 String() 出 "[object Object]"
      // （测试里就显示成「正文只有 15 字」）。
      const r = parseChapter(html)
      return r && r.paras ? r.paras.join('\n') : ''
    }
  }
}

// ---------- Legado 源 ----------

export function legadoAdapter(record) {
  const def = record && record.def
  if (!def) return null
  const a = makeAdapter(def)
  return {
    id: record.id,
    name: record.name,
    kind: 'legado',
    baseUrl: a.baseUrl,
    searchRequest: function (kw, page) {
      return a.request(def.searchUrl, { key: kw, page: page || 1 })
    },
    parseSearch: function (raw, ctx) {
      const rs = def.ruleSearch || {}
      const isJson = /^\s*\$/.test(String(rs.bookList || ''))
      const data = isJson ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : raw
      const list = a.parseSearch(data, { key: (ctx && ctx.key) || '', page: (ctx && ctx.page) || 1 })
      const out = []
      for (let i = 0; i < list.length; i++) {
        const b = list[i]
        out.push({
          title: b.title,
          author: b.author,
          url: b.url,
          bid: bidOf(b.url, record.id),
          cover: b.cover,
          intro: b.intro,
          kind: b.kind,
          lastChapter: b.lastChapter,
          wordCount: b.wordCount,
          vars: b.vars || null
        })
      }
      return out
    },
    detailRequest: function (book) {
      const rb = def.ruleBookInfo || {}
      return a.request(rb.init || (book && book.url) || '', { key: '', page: 1, vars: (book && book.vars) || {} })
    },
    parseDetail: function (raw, book) {
      const rb = def.ruleBookInfo || {}
      const isJson = /^\s*\$/.test(String(rb.intro || rb.name || ''))
      const data = isJson ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : raw
      const d = a.parseDetail(data, book)
      return {
        title: d.name || (book && book.title) || '',
        author: d.author || (book && book.author) || '',
        intro: d.intro || (book && book.intro) || '',
        kind: d.kind || (book && book.kind) || '',
        cover: d.coverUrl || '',
        lastChapter: d.lastChapter || '',
        vars: d.vars || (book && book.vars) || null,
        // 目录页链接可能是相对地址（/list/1.html），这里就补成绝对地址，
        // 调用方拿到可以直接请求
        tocUrl: d.tocUrl ? absUrl(record.site, d.tocUrl) : ''
      }
    },
    tocRequest: function (book) {
      // 只用于「地址已知」的场景；规则式的 tocUrl 必须走 tocPlan
      const target = String((book && book.tocUrl) || (book && book.url) || '')
      return a.request(target, { key: '', page: 1, vars: (book && book.vars) || {} })
    },
    // 目录页地址有两种来源，必须分清：
    //   ① 固定地址（/list/1.html）—— 直接请求
    //   ② 一段「从详情页提取链接」的规则（text.点击阅读@href、id.x@href）
    // 旧实现把 ② 的规则文本当成 URL 去 curl，全部报「目录 HTTP -」。
    // 这里返回 detail=true 时，调用方要先抓详情页、用 parseDetail 解出 tocUrl 再抓一次。
    tocPlan: function (book) {
      const rb = def.ruleBookInfo || {}
      const ctx = { key: '', page: 1, vars: (book && book.vars) || {} }
      const known = String((book && book.tocUrl) || '')
      if (known) return { req: a.request(known, ctx) }
      const tocRule = String(rb.tocUrl || '')
      const bookUrl = (book && book.url) || (book && book.detailUrl) || ''
      if (tocRule && (tocRule.indexOf('@') > 0 || /^(text|class|id|tag)\.|^[.#]/.test(tocRule))) {
        return { req: a.request(bookUrl, ctx), detail: true }
      }
      const target = tocRule || bookUrl
      return { req: a.request(target, ctx) }
    },
    parseToc: function (raw, book) {
      const rt = def.ruleToc || {}
      const isJson = /^\s*\$/.test(String(rt.chapterList || ''))
      const data = isJson ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : raw
      const list = a.parseToc(data, book)
      const out = []
      for (let i = 0; i < list.length; i++) {
        out.push({ cid: String(i + 1), title: list[i].title, url: list[i].url })
      }
      return { chapters: out, total: out.length, pages: 1 }
    },
    chapterRequest: function (book, ch) {
      const rc = def.ruleContent || {}
      const rule = (ch && ch.url) || rc.url || ''
      return a.request(rule, { key: '', page: 1, vars: (book && book.vars) || {} })
    },
    parseChapter: function (raw, book) {
      const rc = def.ruleContent || {}
      const isJson = /^\s*\$/.test(String(rc.content || ''))
      let data = raw
      if (isJson && typeof raw === 'string') {
        try { data = JSON.parse(raw) } catch (e) { data = {} }
      }
      const txt = a.parseChapter(data, book)
      return tidy(txt)
    }
  }
}

export function adapterOf(record) {
  if (!record) return null
  if (record.kind === 'native') return makeNative(record.site || record.baseUrl)
  if (record.kind === 'ln') return lnSourceAdapter(record)
  return legadoAdapter(record)
}

// ---------- 轻小说源 ----------

// 把 lightnovel.js 的站点适配器接到本项目统一的 adapter 接口上。
// 与 Legado 源最大的不同：它的目录是「卷 → 章节」两层，
// 所以多暴露一个 tocAll(book, fetch)（页面 ensureChunkAd 会优先用它）。
export function lnSourceAdapter(record) {
  const site = siteOf(record && record.lnId)
  if (!site) return null
  return {
    id: record.id,
    name: record.name,
    kind: 'ln',
    baseUrl: site.base,
    searchRequest: function (kw, page) {
      return site.build.search(kw, page || 1)
    },
    parseSearch: function (raw) {
      const list = site.parse.search(raw)
      const out = []
      for (let i = 0; i < list.length; i++) {
        const b = list[i]
        out.push({
          title: b.title,
          author: b.author,
          url: b.url,
          bid: b.bid,
          cover: b.cover || '',
          intro: b.intro || '',
          kind: b.kind || '轻小说',
          lastChapter: b.lastChapter || '',
          wordCount: b.wordCount ? b.wordCount + '字' : '',
          vars: null
        })
      }
      return out
    },
    detailRequest: function (book) {
      const ids = parseBookUrl(book && book.url)
      return site.build.detail((book && book.bid) || (ids && ids.bookId))
    },
    parseDetail: function (raw, book) {
      const d = site.parse.detail(raw)
      if (!d) {
        return { title: (book && book.title) || '', author: (book && book.author) || '', intro: '', kind: '', cover: '', lastChapter: '', vars: null }
      }
      return {
        title: d.name || (book && book.title) || '',
        author: d.author || (book && book.author) || '',
        intro: d.intro || '',
        kind: d.kind || '',
        cover: d.cover || '',
        lastChapter: d.lastChapter || '',
        vars: null
      }
    },
    // 目录：卷列表 + 逐卷章节，全部拉齐再返回（88 章的书 14 次请求、约 20 秒）
    tocAll: async function (book, fetchReq) {
      const ids = parseBookUrl(book && book.url)
      const bookId = (book && book.bid) || (ids && ids.bookId)
      if (!bookId) return { chapters: [], total: 0, pages: 1 }
      // 站点自带一次拿全的目录接口
      if (site.tocAll) {
        const flat = await site.tocAll(bookId, async function (req) {
          const r = await fetchReq(req)
          if (!r) return null
          // 抓取回调有两种返回约定：页面层给的是裸字符串（只要 200 就返回 text），
          // 历史调用方给的是 {text}。这里必须都认，否则 site.tocAll 拿到 null 直接
          // 返回空数组，表现为「目录没抓到」而请求明明是 200。
          return typeof r === 'string' ? r : r.text || null
        })
        const list = (flat || []).map(function (c) {
          return { cid: String(c.cid), title: c.title, url: c.url }
        })
        return { chapters: list, total: list.length, pages: Math.max(1, Math.ceil(list.length / 100)) }
      }
      const chapters = []
      let page = 1
      let guard = 0
      while (guard++ < 40) {
        const rt = await fetchReq(site.build.toc(bookId, page))
        if (!rt) break
        const pv = site.parse.toc(rt.text || rt)
        for (let i = 0; i < pv.list.length; i++) {
          const v = pv.list[i]
          let cp = 1
          let cg = 0
          while (cg++ < 60) {
            const rc = await fetchReq(site.build.chapters(bookId, v.volumeId, cp))
            if (!rc) break
            const pc = site.parse.chapters(rc.text || rc)
            for (let j = 0; j < pc.list.length; j++) {
              const c = pc.list[j]
              chapters.push({
                cid: String(c.chapterId),
                title: c.title,
                url: site.base + '/book/' + c.bookId + '/chapter/' + c.chapterId
              })
            }
            if (!pc.hasNext) break
            cp++
          }
        }
        if (!pv.hasNext) break
        page++
      }
      return { chapters: chapters, total: chapters.length, pages: Math.max(1, Math.ceil(chapters.length / 100)) }
    },
    // 轻小说站的章节在「卷接口」里，详情页本身没有章节列表。
    // 这两个方法是兜底（探测、以及 tocAll 不可用时），真正取目录走 tocAll。
    tocRequest: function (book) {
      const ids = parseBookUrl(book && book.url)
      return site.build.detail((book && book.bid) || (ids && ids.bookId))
    },
    parseToc: function () {
      return { chapters: [], total: 0, pages: 1 }
    },
    chapterRequest: function (book, ch) {
      const ids = parseBookUrl(ch && ch.url)
      return site.build.chapter((ids && ids.bookId) || (book && book.bid), (ids && ids.chapterId) || (ch && ch.cid))
    },
    parseChapter: function (raw) {
      return site.parse.chapter(raw)
    }
  }
}

// 轻小说站点 → 书源记录
export function recordFromLN(site, priority) {
  return {
    id: LN_PREFIX + site.id,
    name: site.name,
    kind: 'ln',
    lnId: site.id,
    baseUrl: site.base,
    enabled: true,
    priority: priority == null ? 20 : priority,
    status: site.login ? 'login' : 'untested',
    lastTestAt: 0,
    lastMs: 0,
    lastError: '',
    login: !!site.login,
    def: null
  }
}

// 首次启动时补齐内置轻小说源（已存在的不动，保留用户的启用/优先级）
export function ensureLNRecords(list) {
  const out = (list || []).slice()
  for (let i = 0; i < LN_SITES.length; i++) {
    const s = LN_SITES[i]
    const id = LN_PREFIX + s.id
    let hit = null
    for (let j = 0; j < out.length; j++) if (out[j].id === id) hit = out[j]
    if (!hit) out.push(recordFromLN(s, 20 + i))
  }
  return out
}

// ---------- 记录 ----------

export function recordFromNative(site) {
  return {
    id: NATIVE_ID,
    name: '书海阁',
    kind: 'native',
    site: normUrl(site),
    enabled: true,
    priority: 1,
    status: 'ok',
    lastTestAt: 0,
    lastMs: 0,
    lastError: '',
    login: false,
    def: null
  }
}

export function recordFromLegado(def, priority) {
  const c = classify(def)
  return {
    id: 'lg_' + hash(String(def.bookSourceUrl || '') + '|' + String(def.bookSourceName || '')),
    name: def.bookSourceName || def.bookSourceUrl,
    kind: 'legado',
    site: normUrl(def.bookSourceUrl),
    // 导入即生效：规则层能解析的默认启用，判死不兼容的不启用（否则从 CDN
    // 更新完 22 条全是停用，用户以为更新成功了却搜不到任何新源）
    enabled: c.level !== 'unsupported',
    priority: priority || 50,
    status: c.level === 'unsupported' ? 'bad' : 'untested',
    why: c.reasons.join('；'),
    lastTestAt: 0,
    lastMs: 0,
    lastError: c.level === 'unsupported' ? c.reasons.join('；') : '',
    login: !!def.loginUrl || /登录|login/i.test(String(def.bookSourceGroup || '')),
    def: def
  }
}

// 导入合并：同 URL 的源保留旧状态（测试结果/启用状态），其余更新规则
export function mergeRecords(oldList, incoming) {
  const olds = {}
  const out = []
  for (let i = 0; i < (oldList || []).length; i++) {
    olds[oldList[i].id] = oldList[i]
    out.push(oldList[i])
  }
  let added = 0
  let updated = 0
  for (let i = 0; i < (incoming || []).length; i++) {
    const n = incoming[i]
    const o = olds[n.id]
    if (o) {
      o.name = n.name
      o.def = n.def
      o.site = n.site
      o.why = n.why
      if (o.status !== 'ok' && o.status !== 'partial') {
        const c = classify(n.def)
        o.status = c.level === 'unsupported' ? 'bad' : o.status
      }
      updated++
    } else {
      out.push(n)
      added++
    }
  }
  return { list: out, added: added, updated: updated }
}

export function importLegadoJson(text, oldList) {
  const defs = normalizeImport(text)
  const pri = []
  for (let i = 0; i < defs.length; i++) pri.push(recordFromLegado(defs[i], 50 + i))
  return mergeRecords(oldList, pri)
}

// ---------- 给搜索引擎用 ----------

// fetchText(req) -> Promise<string>
export function searchSourceOf(record, fetchText) {
  const ad = adapterOf(record)
  return {
    id: record.id,
    name: record.name,
    priority: record.priority,
    enabled: record.enabled,
    status: record.status,
    searchOne: async function (kw, page) {
      if (!ad) throw new Error('源不可用')
      const req = ad.searchRequest(kw, page)
      if (!req || !req.url) throw new Error('搜索地址为空')
      const text = await fetchText(req, record)
      return ad.parseSearch(text, { key: kw, page: page })
    }
  }
}

// 排序：启用的、可用优先
export function sortForSearch(list) {
  return (list || []).slice().sort(function (a, b) {
    const ea = a.enabled ? 0 : 1
    const eb = b.enabled ? 0 : 1
    if (ea !== eb) return ea - eb
    const pa = a.priority == null ? 99 : a.priority
    const pb = b.priority == null ? 99 : b.priority
    return pa - pb
  })
}

export const STATUS_TEXT = {
  ok: '可用',
  partial: '部分可用',
  login: '需登录',
  fail: '暂时失效',
  untested: '待测试',
  bad: '不兼容'
}

export function statusText(s) {
  return STATUS_TEXT[s] || '待测试'
}

// 统计
export function statsOf(list) {
  const out = { total: 0, enabled: 0, ok: 0, partial: 0, login: 0, fail: 0, untested: 0, bad: 0 }
  for (let i = 0; i < (list || []).length; i++) {
    const s = list[i]
    out.total++
    if (s.enabled) out.enabled++
    if (out[s.status] != null) out[s.status]++
  }
  return out
}
