// 轻小说源全链路真机外测试（PC 端，不发包到设备）
//
// 8 项：
//   1 搜索  2 详情  3 完整目录  4 正文  5 单章下载  6 连续多章
//   7 整本逐章（按目录全量走一遍，落盘成 txt）  8 EPUB/TXT 直链
//
// 用法：node test/live/run_light.mjs lk "败犬"
//      node test/live/run_light.mjs --all        # 所有注册站点，用默认关键词
// 说明：必须直连（--noproxy '*'）。本机 shell 里的 http_proxy 会把国内/境外站点
//      的请求送进工作区代理，造成 502/403 假失败——上一轮已踩过这个坑。

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LN_SITES, lnAdapter } from '../../src/lib/lightnovel.js'

const UA = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const OUT = 'out/light'
fs.mkdirSync(OUT, { recursive: true })

function curlReq(req, timeout) {
  const args = ['-sS', '--noproxy', '*', '--compressed', '--connect-timeout', '8', '-m', String(timeout || 25), '-A', req.ua || UA]
  if (req.method === 'POST') {
    args.push('-X', 'POST', '--data-binary', req.body || '')
  } else {
    args.push('-L', '--max-redirs', '4')
  }
  const hs = req.headers || {}
  for (const k in hs) {
    if (hs[k] == null) continue
    args.push('-H', k + ': ' + hs[k])
  }
  if (req.referer) args.push('-e', req.referer)
  const t0 = Date.now()
  let text = ''
  let code = 0
  try {
    const buf = execFileSync('curl', args.concat(['-w', '\n__C__%{http_code}', req.url]), {
      maxBuffer: 48 * 1024 * 1024,
      timeout: (timeout || 25) * 1000 + 5000
    })
    const s = buf.toString('utf8')
    const i = s.lastIndexOf('\n__C__')
    code = i >= 0 ? parseInt(s.slice(i + 6), 10) : 0
    text = i >= 0 ? s.slice(0, i) : s
  } catch (e) {
    text = ''
    code = -1
  }
  const ms = Date.now() - t0
  LAST.net.push({ url: req.url, code, ms, bytes: Buffer.byteLength(text) })
  if (code >= 400 || code < 0) return null
  return text
}

const LAST = { net: [] }

function reset() { LAST.net = [] }

function ms() { return LAST.net.reduce((a, b) => a + b.ms, 0) }

function netSummary() {
  const n = LAST.net
  return n.length + ' 次请求 / ' + ms() + 'ms / 最大 ' + Math.max.apply(null, n.map((x) => x.bytes || 0)) + 'B'
}

async function runOne(id, keyword) {
  const site = LN_SITES.find((s) => s.id === id)
  const a = lnAdapter(id, curlReq)
  const r = { id, name: site.name, base: site.base, kw: keyword }
  reset()

  // 1 搜索
  const s = await a.search(keyword, 1)
  r.search = { count: (s.list || []).length, error: s.error || '', ms: ms(), net: netSummary() }
  if (!r.search.count) return r
  const book = s.list[0]
  r.sample = { title: book.title, author: book.author, url: book.url, intro: String(book.intro).slice(0, 40) }

  // 2 详情
  reset()
  const d = await a.detail(book)
  r.detail = d ? { name: d.name, author: d.author, introLen: String(d.intro || '').length, cover: !!d.cover, ms: ms(), epubReady: !!d.epubReady, epubUrl: d.epubUrl || '' } : { error: '详情为空' }

  // 3 完整目录（真翻页）
  reset()
  const toc = await a.toc(book)
  r.toc = { count: (toc.list || []).length, volumes: toc.volumes || 0, error: toc.error || '', ms: ms(), net: netSummary() }
  if (!r.toc.count) return r

  // 4 正文（取第一章）
  const ch1 = toc.list[0]
  reset()
  const c1 = await a.chapter(ch1, book)
  r.chapter = { title: ch1.title, chars: String(c1.text || '').length, error: c1.error || '', ms: ms() }

  // 5 单章下载 = 抓 + 落盘
  if (c1.text) {
    const f1 = OUT + '/' + id + '_single.txt'
    fs.writeFileSync(f1, ch1.title + '\n\n' + c1.text)
    r.single = { file: f1, bytes: fs.statSync(f1).size }
  } else {
    r.single = { error: '正文为空，未落盘' }
  }

  // 6 连续多章（3 章）
  reset()
  const multi = []
  let multiFail = 0
  const pick = toc.list.slice(0, 3)
  for (const ch of pick) {
    const c = await a.chapter(ch, book)
    if (c.text) multi.push({ t: ch.title, n: c.text.length })
    else multiFail++
  }
  r.multi = { asked: pick.length, ok: multi.length, fail: multiFail, chars: multi.reduce((x, y) => x + y.n, 0), ms: ms(), net: netSummary() }
  if (multi.length) {
    const f3 = OUT + '/' + id + '_multi3.txt'
    fs.writeFileSync(f3, multi.map((x) => '## ' + x.t + '\n' + x.n + '字').join('\n'))
    r.multiFile = f3
  }

  // 7 整本逐章：目录全量跑就是整本下载。这里抽样 12 章估算，
  //   避免在电脑端一次打上百个请求把人家的接口压到限流（429）。
  const sample = toc.list.length <= 12 ? toc.list : toc.list.filter((_, i) => i % Math.ceil(toc.list.length / 12) === 0).slice(0, 12)
  reset()
  let okN = 0
  let chars = 0
  let firstErr = ''
  let needLogin = 0
  for (const ch of sample) {
    const c = await a.chapter(ch, book)
    if (c.text) { okN++; chars += c.text.length } else if (!firstErr) firstErr = c.error || '空'
    if (c.needLogin) needLogin++
  }
  r.book = {
    tocTotal: toc.list.length,
    sampled: sample.length,
    ok: okN,
    avgChars: okN ? Math.round(chars / okN) : 0,
    estChars: okN ? Math.round((chars / okN) * toc.list.length) : 0,
    needLogin: needLogin,
    firstErr: firstErr,
    ms: ms(),
    net: netSummary()
  }

  // 8 EPUB / TXT 直链
  r.epub = d && d.epubUrl
    ? { url: d.epubUrl, note: '站点字段声明有成品文件' }
    : { url: '', note: '站点未提供成品 EPUB（epub_ready=0）' }

  return r
}

const args = process.argv.slice(2)
let targets = []
let kw = '败犬'
if (args[0] === '--all') {
  targets = LN_SITES.map((s) => [s.id, s.defaultKw || '败犬'])
} else if (args.length >= 1) {
  targets = [[args[0], args[1] || kw]]
}

const results = []
for (const [id, k] of targets) {
  console.log('\n======== ' + id + ' / ' + k + ' ========')
  const r = await runOne(id, k)
  results.push(r)
  console.log(JSON.stringify(r, null, 1))
}

fs.writeFileSync(OUT + '/result.json', JSON.stringify(results, null, 2))
console.log('\n写入 ' + OUT + '/result.json')
