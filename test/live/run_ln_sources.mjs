// 轻小说候选源全链路测试（Legado 源通用）
//
// 对每条源按 8 项走：
//   1 搜索  2 详情  3 完整目录（含翻页）  4 正文  5 单章落盘
//   6 连续 3 章  7 整本逐章抽样  8 EPUB/TXT 直链探测
//
// 与 run_sources.mjs 的区别：那个只测搜索，这个必须读到正文才算过。
// 用法：node test/live/run_ln_sources.mjs [fixture] [关键词]
//       fixture 默认 ../fixtures/ln_candidates.json

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { makeAdapter, classify } from '../../src/lib/legado.js'

const FIXTURE = process.env.FIXTURE || '../fixtures/ln_candidates.json'
const KW = process.argv[2] || '刀剑'
const OUT = 'out/light'
fs.mkdirSync(OUT, { recursive: true })

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const NET = { n: 0, ms: 0, max: 0, codes: [] }

function resetNet() { NET.n = 0; NET.ms = 0; NET.max = 0; NET.codes = [] }

function curlRaw(url, opts) {
  const o = opts || {}
  const args = ['-sS', '--noproxy', '*', '--compressed', '--connect-timeout', '8', '-m', String(o.timeout || 20), '-A', o.ua || UA]
  if (o.method === 'POST') args.push('-X', 'POST', '--data-binary', o.body || '')
  else args.push('-L', '--max-redirs', '5')
  const hs = o.headers || {}
  for (const k in hs) if (hs[k] != null) args.push('-H', k + ': ' + String(hs[k]))
  if (o.referer) args.push('-e', o.referer)
  const t0 = Date.now()
  let buf = Buffer.alloc(0)
  let code = 0
  try {
    const r = execFileSync('curl', args.concat(['-w', '\n__C__%{http_code}', url]), { maxBuffer: 64 * 1024 * 1024, timeout: (o.timeout || 20) * 1000 + 5000 })
    const s = r.toString('latin1')
    const i = s.lastIndexOf('\n__C__')
    code = i >= 0 ? parseInt(s.slice(i + 6), 10) : 0
    buf = i >= 0 ? r.slice(0, i) : r
  } catch (e) {
    code = -1
  }
  const ms = Date.now() - t0
  NET.n++
  NET.ms += ms
  NET.max = Math.max(NET.max, buf.length)
  NET.codes.push(code)
  if (code >= 400 || code < 0) return null
  // GBK 站点：Node 内置 TextDecoder 支持 gbk
  const cs = String(o.charset || '')
  if (/gbk|gb2312|gb18030/i.test(cs)) {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch (e) {
      return buf.toString('utf8')
    }
  }
  return buf.toString('utf8')
}

function netSum() { return NET.n + ' 次 / ' + NET.ms + 'ms / 最大 ' + NET.max + 'B / codes ' + NET.codes.join(',') }

// 用适配器约定的 request 结果发请求
function send(req, charset) {
  if (!req || !req.url) return null
  return curlRaw(req.url, {
    method: req.method,
    body: req.body,
    headers: req.headers,
    referer: req.referer,
    charset: charset || req.charset
  })
}

function abs(base, u) {
  const t = String(u == null ? '' : u).trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  if (t.indexOf('//') === 0) return 'https:' + t
  if (t.charAt(0) === '/') {
    const m = String(base).match(/^https?:\/\/[^/]+/)
    return (m ? m[0] : '') + t
  }
  return String(base).replace(/\/+$/, '') + '/' + t.replace(/^\/+/, '')
}

async function testOne(def, kw) {
  const a = makeAdapter(def)
  const cs = (def.searchUrl && /charset["']?\s*:\s*["']?([\w-]+)/i.test(def.searchUrl)) ? RegExp.$1 : ''
  const r = { name: a.name, base: a.baseUrl, file: def.__file || '', kw }
  resetNet()

  // 1 搜索
  let searchReq
  try {
    searchReq = a.request(def.searchUrl, { key: kw, page: 1, vars: {} })
  } catch (e) {
    r.search = { count: 0, error: '构造请求失败：' + e.message }
    return r
  }
  const sh = send(searchReq)
  if (sh == null) {
    r.search = { count: 0, error: '网络失败 ' + netSum() }
    return r
  }
  let list = []
  try {
    list = a.parseSearch(sh, { key: kw, page: 1, vars: {} })
  } catch (e) {
    r.search = { count: 0, error: '解析异常：' + e.message }
    return r
  }
  r.search = { count: list.length, error: list.length ? '' : '解析 0 条', ms: NET.ms, net: netSum() }
  if (!list.length) {
    r.search.rawHead = String(sh).replace(/\s+/g, ' ').slice(0, 160)
    return r
  }
  const book = list[0]
  book.url = abs(a.baseUrl, book.url)
  r.sample = { title: book.title, author: book.author, url: book.url }

  // 2 详情
  resetNet()
  const rb = def.ruleBookInfo || {}
  let detailPage = null
  let durl = book.url
  if (rb.init) {
    const initReq = a.request(rb.init, { key: '', page: 1, vars: book.vars || {} })
    if (initReq && initReq.url) durl = abs(a.baseUrl, initReq.url)
  }
  detailPage = send({ url: durl, headers: {}, method: 'GET' })
  if (detailPage == null) {
    r.detail = { error: '详情页取不到 ' + netSum() }
  } else {
    const d = a.parseDetail(detailPage, book)
    r.detail = {
      name: d.name || '', author: d.author || '', introLen: String(d.intro || '').length,
      cover: !!d.coverUrl, tocUrl: d.tocUrl ? abs(a.baseUrl, d.tocUrl) : '', ms: NET.ms
    }
    if (d.tocUrl) book.tocUrl = abs(a.baseUrl, d.tocUrl)
  }

  // 3 目录
  resetNet()
  const rt = def.ruleToc || {}
  const tocPageUrl = book.tocUrl || book.url
  const tocReq = rt.url ? a.request(rt.url, { key: '', page: 1, vars: book.vars || {} }) : { url: tocPageUrl }
  let tocHtml = send(tocReq)
  if (tocHtml == null) {
    r.toc = { count: 0, error: '目录页取不到 ' + netSum() }
    return r
  }
  let toc = a.parseToc(tocHtml, book)
  // 翻页：nextTocUrl 若是静态可求值的就继续翻，最多 30 页
  let pages = 1
  const nx = String(rt.nextTocUrl || '')
  if (nx && !/[@<]/.test(nx.replace(/\{\{page\}\}/g, ''))) {
    let p = 2
    while (p <= 30) {
      const nu = a.request(nx, { key: '', page: p, vars: book.vars || {} })
      if (!nu || !nu.url) break
      const h = send(nu)
      if (h == null) break
      const more = a.parseToc(h, book)
      if (!more.length) break
      toc = toc.concat(more)
      pages = p
      p++
    }
  }
  r.toc = { count: toc.length, pages: pages, error: toc.length ? '' : '解析 0 章', ms: NET.ms, net: netSum() }
  if (!toc.length) {
    r.toc.rawHead = String(tocHtml).replace(/\s+/g, ' ').slice(0, 160)
    return r
  }
  toc.forEach((c) => { c.url = abs(a.baseUrl, c.url || book.url) })

  // 4 正文（第一章）
  const ruleContent = (def.ruleContent || {}).content || ''
  const chapUrlOf = (c) => {
    if (ruleContent && !/^https?:/.test(ruleContent) && String(ruleContent).indexOf('{{') >= 0) {
      const u = String(ruleContent).replace(/\{\{([^}]*)\}\}/g, (m, k) => (c.vars && c.vars[k]) || '')
      if (/^https?:/.test(u)) return u
    }
    return c.url
  }
  const c1 = toc[0]
  resetNet()
  let h1 = send({ url: chapUrlOf(c1), headers: {}, method: 'GET' })
  let t1 = ''
  if (h1 != null) {
    try { t1 = a.parseChapter(h1, book) } catch (e) { t1 = '' }
  }
  r.chapter = { title: c1.title, chars: String(t1).length, error: t1 ? '' : '正文为空', ms: NET.ms }

  // 5 单章落盘
  if (t1) {
    const f = OUT + '/src_' + a.id + '_1.txt'
    fs.writeFileSync(f, c1.title + '\n\n' + t1)
    r.single = { file: f, bytes: fs.statSync(f).size }
  }

  // 6 连续 3 章
  resetNet()
  let ok3 = 0
  let chars3 = 0
  for (let i = 0; i < Math.min(3, toc.length); i++) {
    const h = send({ url: chapUrlOf(toc[i]), headers: {}, method: 'GET' })
    if (h == null) continue
    let t = ''
    try { t = a.parseChapter(h, book) } catch (e) { t = '' }
    if (t) { ok3++; chars3 += String(t).length }
  }
  r.multi = { asked: Math.min(3, toc.length), ok: ok3, chars: chars3, ms: NET.ms, net: netSum() }

  // 7 整本抽样（最多 8 章，均匀取）
  const step = Math.max(1, Math.ceil(toc.length / 8))
  const sample = toc.filter((_, i) => i % step === 0).slice(0, 8)
  resetNet()
  let okS = 0
  let charsS = 0
  let firstErr = ''
  for (const c of sample) {
    const h = send({ url: chapUrlOf(c), headers: {}, method: 'GET' })
    if (h == null) { if (!firstErr) firstErr = 'HTTP 失败'; continue }
    let t = ''
    try { t = a.parseChapter(h, book) } catch (e) { t = '' }
    if (t) { okS++; charsS += String(t).length } else if (!firstErr) firstErr = '正文解析为空'
  }
  r.book = {
    tocTotal: toc.length,
    sampled: sample.length,
    ok: okS,
    avgChars: okS ? Math.round(charsS / okS) : 0,
    estChars: okS ? Math.round((charsS / okS) * toc.length) : 0,
    firstErr,
    ms: NET.ms,
    net: netSum()
  }

  // 8 EPUB/TXT 直链：站点是否在页面里给出成品文件
  const blob = String(tocHtml) + String(detailPage || '')
  const epub = blob.match(/https?:\/\/[^"'\s]+\.epub(\?[^"'\s]*)?/i)
  const txt = blob.match(/https?:\/\/[^"'\s]+\.txt(\?[^"'\s]*)?/i)
  r.fileDirect = epub ? { kind: 'epub', url: epub[0] } : txt ? { kind: 'txt', url: txt[0] } : { kind: '', note: '页面未提供 epub/txt 直链（只有网页正文）' }
  return r
}

const defs = JSON.parse(fs.readFileSync(new URL(FIXTURE, import.meta.url), 'utf8'))
const results = []
for (const d of defs) {
  const c = classify(d)
  console.log('\n######## ' + d.bookSourceName + ' [' + c.level + '] ' + d.bookSourceUrl)
  const r = await testOne(d, KW)
  r.classify = c
  results.push(r)
  const s = r.search
  const q = r.toc
  const ch = r.chapter
  console.log('  搜索 ' + (s.count || 0) + ' 条 ' + (s.error || '') )
  if (r.toc) console.log('  目录 ' + (q.count || 0) + ' 章 ' + (q.error || ''))
  if (r.chapter) console.log('  正文 ' + ch.chars + ' 字 ' + (ch.error || ''))
  if (r.book) console.log('  整本抽样 ' + r.book.ok + '/' + r.book.sampled + ' 每章均 ' + r.book.avgChars + ' 字')
}
fs.writeFileSync(OUT + '/sources_result.json', JSON.stringify(results, null, 2))
const okn = results.filter((r) => r.chapter && r.chapter.chars > 0).length
console.log('\n==== 全链路可用 ' + okn + ' / ' + results.length + ' ====')
