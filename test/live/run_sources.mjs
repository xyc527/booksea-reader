// 真实网络测试：对通过能力门槛的 Legado 书源逐个跑「搜索」并打印结果
// 用法： node test/live/run_sources.mjs [关键词] [并发] [数量上限]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { makeAdapter, classify, normalizeImport } from '../../src/lib/legado.js'

const KW = process.argv[2] || '诡秘之主'
const CONC = parseInt(process.argv[3] || '3', 10)
const LIMIT = parseInt(process.argv[4] || '0', 10)

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'
const MODE = process.env.MODE === 'proxy' ? 'proxy' : 'direct'
const PROXY = process.env.PROXY_URL || 'http://127.0.0.1:7890'

function curl(url, opts) {
  const o = opts || {}
  const args = ['-sS', '-L', '--compressed', '--connect-timeout', '6', '-m', String(o.timeout || 10), '-A', o.ua || UA]
  // 本机 shell 环境变量里挂着工作区代理（127.0.0.1:1518），会让国内站点出现 502/403 假失败。
  // 默认直连（与词典笔一致），需要时用 MODE=proxy 显式走代理。
  if (MODE === 'proxy') args.push('-x', PROXY)
  else args.push('--noproxy', '*')
  if (o.method === 'POST') {
    args.push('-X', 'POST')
    if (o.body) args.push('--data-binary', o.body)
    args.push('-H', 'Content-Type: application/x-www-form-urlencoded')
  }
  if (o.referer) args.push('-e', o.referer)
  args.push('-w', '\n__META__%{http_code}|%{content_type}|%{size_download}|%{time_total}')
  args.push(url)
  const t0 = Date.now()
  try {
    const buf = execFileSync('curl', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: (o.timeout || 12) * 1000 + 3000 })
    const s = buf.toString('utf8')
    const i = s.lastIndexOf('\n__META__')
    const meta = i >= 0 ? s.slice(i + 9).trim() : ''
    const bodyBuf = i >= 0 ? buf.subarray(0, Buffer.byteLength(s.slice(0, i), 'utf8')) : buf
    const p = meta.split('|')
    const ctype = p[1] || ''
    let text = bodyBuf.toString('utf8')
    if (/charset=(gb2312|gbk|gb18030)/i.test(ctype)) {
      try { text = new TextDecoder('gbk').decode(bodyBuf) } catch (e) { /* 保留 utf8 结果 */ }
    }
    return { ok: true, text: text, code: parseInt(p[0], 10) || 0, ctype: ctype, bytes: parseInt(p[2], 10) || bodyBuf.length, ms: Math.round((parseFloat(p[3]) || 0) * 1000) || (Date.now() - t0) }
  } catch (e) {
    return { ok: false, text: '', error: String((e && e.message) || e).split('\n')[0], ms: Date.now() - t0 }
  }
}

function isJsonRule(rule) {
  return /^\s*\$/.test(String(rule || ''))
}

async function testSource(src) {
  const a = makeAdapter(src)
  const cls = classify(src)
  const rec = { name: a.name, url: a.baseUrl, level: cls.level, reasons: cls.reasons, group: src.bookSourceGroup || '' }
  if (cls.level === 'unsupported') return Object.assign(rec, { status: '不兼容', detail: cls.reasons.join(';') })
  try {
    const req = a.request(src.searchUrl, { key: KW, page: 1 })
    if (!req.url) return Object.assign(rec, { status: '失败', detail: 'searchUrl 为空' })
    const r = curl(req.url, { method: req.method, body: req.body, timeout: 10 })
    rec.http = r.ok ? r.code : 0
    rec.bytes = r.bytes || 0
    rec.ms = r.ms
    if (!r.ok) return Object.assign(rec, { status: '网络错误', detail: r.error })
    const head = r.text.slice(0, 600).toLowerCase()
    if (/verifying\.\.\.|just a moment|cf-browser-verification|checking your browser|人机验证|请稍候/.test(head)) {
      return Object.assign(rec, { status: '需要人机验证', detail: '返回挑战页（' + r.bytes + 'B）' })
    }
    if (r.code >= 400) return Object.assign(rec, { status: 'HTTP' + r.code, detail: '站点拒绝' })
    // 200 + 「Redirecting...」中转页：站点要 Cookie/JS，不能算解析失败
    if (r.text.length < 20000 && /<title>\s*Redirecting|window\.location|location\.replace\(|<meta[^>]+http-equiv=["']?refresh/i.test(r.text)) {
      return Object.assign(rec, { status: '跳转页', detail: '返回中转页，需要 Cookie/JS（' + r.bytes + 'B）' })
    }
    let data = r.text
    const rs = src.ruleSearch || {}
    if (isJsonRule(rs.bookList)) {
      try { data = JSON.parse(r.text) } catch (e) {
        return Object.assign(rec, { status: '解析失败', detail: '不是 JSON：' + r.text.slice(0, 60).replace(/\s+/g, ' ') })
      }
    }
    const list = a.parseSearch(data, { key: KW, page: 1 })
    rec.count = list.length
    rec.sample = list.slice(0, 3).map(x => x.title + ' / ' + (x.author || '?') + ' / ' + (x.url || '').slice(0, 50))
    if (!list.length) return Object.assign(rec, { status: '无结果', detail: '页面可访问但解析为 0 条' })
    return Object.assign(rec, { status: '搜索可用' })
  } catch (e) {
    return Object.assign(rec, { status: '异常', detail: String((e && e.message) || e) })
  }
}

const all = normalizeImport(fs.readFileSync(new URL(process.env.FIXTURE || '../fixtures/legado_candidates.json', import.meta.url), 'utf8'))
const list = LIMIT > 0 ? all.slice(0, LIMIT) : all
console.log('测试书源数：' + list.length + '，关键词：' + KW + '，并发：' + CONC)

const out = []
let i = 0
async function worker() {
  while (i < list.length) {
    const idx = i++
    const rec = await testSource(list[idx])
    out[idx] = rec
    console.log(('[' + (idx + 1) + '/' + list.length + '] ' + rec.name).padEnd(28) + ' ' + rec.status + (rec.detail ? ' · ' + rec.detail : '') + (rec.count != null ? ' · ' + rec.count + ' 条' : ''))
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

const ok = out.filter(x => x.status === '搜索可用')
fs.writeFileSync(new URL('../../out/source-test-' + Date.now() + '.json', import.meta.url), JSON.stringify(out, null, 1), 'utf8')
console.log('\n汇总：可用 ' + ok.length + ' / ' + out.length)
