// CDN 多线路管理（纯逻辑 + 可注入 fetcher）
// 只用于拿"书源配置文件"这类静态文件；小说正文永远直连书源站点。

export const CDN_LINES = [
  {
    id: 'jsdelivr',
    name: 'jsDelivr',
    template: 'https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}',
    note: '国内一般可用，支持固定 tag/commit'
  },
  {
    id: 'statically',
    name: 'Statically',
    template: 'https://cdn.statically.io/gh/{owner}/{repo}@{ref}/{path}',
    note: '镜像，部分时段不稳'
  },
  {
    id: 'githack',
    name: 'raw.githack',
    template: 'https://rawcdn.githack.com/{owner}/{repo}/{ref}/{path}',
    note: '生产线路，要求 ref 是 tag/commit'
  },
  {
    id: 'githubraw',
    name: 'GitHubRaw',
    template: 'https://cdn.githubraw.com/{owner}/{repo}/{ref}/{path}',
    note: '第三方镜像'
  },
  {
    id: 'ghraw',
    name: 'GitHub Raw',
    template: 'https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}',
    note: '最后备用，国内常被墙'
  }
]

export function defaultLines() {
  const out = []
  for (let i = 0; i < CDN_LINES.length; i++) {
    const d = CDN_LINES[i]
    out.push({
      id: d.id,
      name: d.name,
      template: d.template,
      note: d.note,
      enabled: true,
      ok: null, // null=未测 / true / false
      lastTestAt: 0,
      lastMs: 0,
      lastError: '',
      priority: i + 1,
      bytes: 0,
      sha: ''
    })
  }
  return out
}

export function buildUrl(line, target) {
  if (!line || !line.template) return ''
  const t = target || {}
  return String(line.template)
    .replace(/\{owner\}/g, t.owner || '')
    .replace(/\{repo\}/g, t.repo || '')
    .replace(/\{ref\}/g, t.ref || 'main')
    .replace(/\{path\}/g, String(t.path || '').replace(/^\/+/, ''))
}

// ---------- 内容校验 ----------

// 不把 HTTP 200 当成功：要能解析、字段齐全、条数合理
export function validatePayload(text, expect) {
  const s = String(text == null ? '' : text)
  if (!s) return { ok: false, reason: '空响应' }
  const head = s.slice(0, 400).toLowerCase()
  if (head.indexOf('<!doctype html') >= 0 || head.indexOf('<html') >= 0) {
    return { ok: false, reason: '返回的是 HTML 页面' }
  }
  if (/^\s*</.test(s)) return { ok: false, reason: '返回内容以标签开头' }
  if (/rate limit|too many requests|access denied|forbidden/i.test(head) && s.length < 2000) {
    return { ok: false, reason: '被限流或拒绝' }
  }
  let data
  try {
    data = JSON.parse(s)
  } catch (e) {
    return { ok: false, reason: 'JSON 解析失败' }
  }
  let list = data
  if (!Array.isArray(list)) {
    if (data && Array.isArray(data.bookSources)) list = data.bookSources
    else if (data && Array.isArray(data.data)) list = data.data
    else if (data && typeof data === 'object') list = [data]
    else return { ok: false, reason: '结构不符（不是数组）' }
  }
  const want = expect || {}
  if (want.kind === 'legado') {
    let good = 0
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (it && typeof it === 'object' && it.bookSourceUrl) good++
    }
    if (!good) return { ok: false, reason: '没有可用书源（缺 bookSourceUrl）', count: 0 }
    if (want.minCount && good < want.minCount) {
      return { ok: false, reason: '书源数量异常（' + good + '）', count: good }
    }
    return { ok: true, reason: '', count: good, bytes: s.length }
  }
  return { ok: true, reason: '', count: list.length, bytes: s.length }
}

// ---------- 哈希 ----------

export function fnv1a(s) {
  let h = 0x811c9dc5
  const t = String(s == null ? '' : s)
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
}

// SHA-256（纯 JS，用于跨 CDN 比对同一版本；设备端可按需跳过）
export function sha256(msg) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  // UTF-8 编码为字节
  const bytes = []
  const s = String(msg == null ? '' : msg)
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else {
      const c2 = s.charCodeAt(++i)
      const cp = 0x10000 + ((c - 0xd800) << 10) + ((c2 || 0) - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  // 高 32 位始终为 0（附件远小于 512MB）
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255)

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Array(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)) }
  const arr = [h0, h1, h2, h3, h4, h5, h6, h7]
  let out = ''
  for (let i = 0; i < 8; i++) out += ('00000000' + (arr[i] >>> 0).toString(16)).slice(-8)
  return out
}

// ---------- 线路选择与故障切换 ----------

export function sortByPriority(lines) {
  return (lines || []).slice().sort(function (a, b) {
    const pa = a.priority == null ? 99 : a.priority
    const pb = b.priority == null ? 99 : b.priority
    return pa - pb
  })
}

export function primaryLine(lines) {
  const s = sortByPriority(lines).filter(function (l) { return l.enabled !== false })
  return s.length ? s[0] : null
}

// fetchOne(line, url, timeout) -> {ok, text, ms, error}
// 结果写回 line 的状态字段（调用方负责持久化）
export async function testLine(line, target, fetchOne, timeout) {
  const url = buildUrl(line, target)
  const t0 = now()
  const r = await fetchOne(url, timeout || 12000)
  const ms = now() - t0
  const v = r && r.ok ? validatePayload(r.text, target && target.expect) : { ok: false, reason: (r && r.error) || '请求失败' }
  line.ok = !!v.ok
  line.lastTestAt = Date.now()
  line.lastMs = ms
  line.lastError = v.ok ? '' : (v.reason || '')
  if (v.ok) {
    line.bytes = String(r.text || '').length
    line.sha = fnv1a(r.text || '')
  }
  return { id: line.id, ok: !!v.ok, ms: ms, error: line.lastError, url: url, count: v.count || 0, text: v.ok ? r.text : '' }
}

function now() {
  return typeof Date !== 'undefined' ? Date.now() : 0
}

// 依次尝试，失败自动切下一条；全部失败返回 errors
export async function fetchWithFailover(lines, target, fetchOne, opts) {
  const opt = opts || {}
  const timeout = opt.timeout || 12000
  const tries = []
  const order = sortByPriority(lines).filter(function (l) { return l.enabled !== false })
  for (let i = 0; i < order.length; i++) {
    const line = order[i]
    const r = await testLine(line, target, fetchOne, timeout)
    tries.push({ id: line.id, name: line.name, ok: r.ok, ms: r.ms, error: r.error })
    if (r.ok) {
      line.lastOkAt = Date.now()
      return { ok: true, text: r.text, line: line.id, lineName: line.name, ms: r.ms, tries: tries }
    }
  }
  return { ok: false, text: '', line: '', tries: tries, errors: tries.map(function (t) { return t.name + ': ' + t.error }) }
}

// 缓存是否可继续使用（网络全挂时不清空旧配置）
export function canUseCache(cache, maxAgeMs) {
  if (!cache || !cache.text) return false
  if (!maxAgeMs) return true
  return Date.now() - (cache.at || 0) <= maxAgeMs
}
