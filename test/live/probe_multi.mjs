// 多源搜索结果实测：对 sources.json 里全部启用源跑一次真实搜索，打印每源命中条数。
// 目的：定位「搜完只显示一个源的结果」——是源真没结果，还是解析后被丢掉。
// 运行：node test/live/probe_multi.mjs [关键词] [sources.json路径]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { adapterOf } from '../../src/lib/sources.js'

const KW = process.argv[2] || '斗破苍穹'
const SRC = process.argv[3] || 'C:/tmp/pen/sources.json'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'

function curlText(req, timeoutSec) {
  const args = ['-sS', '-L', '--compressed', '--noproxy', '*',
    '--connect-timeout', '6', '-m', String(timeoutSec || 12), '-A', UA,
    '-w', '\n__M__%{http_code}|%{size_download}']
  if (req.method === 'POST') {
    args.push('-X', 'POST', '--data-binary', req.body || '')
    args.push('-H', 'Content-Type: application/x-www-form-urlencoded')
  }
  const hs = req.headers || {}
  for (const k in hs) args.push('-H', k + ': ' + hs[k])
  args.push(req.url)
  const t0 = Date.now()
  let out
  try {
    out = execFileSync('curl', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    return { err: String(e.message).split('\n')[0], ms: Date.now() - t0 }
  }
  const raw = out.toString('utf8')
  const i = raw.lastIndexOf('\n__M__')
  const body = i >= 0 ? raw.slice(0, i) : raw
  const meta = i >= 0 ? raw.slice(i + 5).trim() : ''
  return { body: body, code: meta.split('|')[0], size: body.length, ms: Date.now() - t0 }
}

const conf = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const list = (conf.list || []).filter(function (s) { return s.enabled && s.status !== 'bad' })
console.log('关键词：' + KW + '，参与源：' + list.length + '\n')

const rows = []
for (let i = 0; i < list.length; i++) {
  const rec = list[i]
  const t0 = Date.now()
  let r = { name: rec.name, kind: rec.kind, status: rec.status, site: rec.site }
  try {
    const ad = adapterOf(rec)
    if (!ad) throw new Error('无适配器')
    const req = ad.searchRequest(KW, 1)
    if (!req || !req.url) throw new Error('搜索地址为空')
    r.url = req.url
    const resp = curlText(req)
    r.ms = resp.ms
    if (resp.err) throw new Error(resp.err)
    r.code = resp.code
    r.size = resp.size
    const items = ad.parseSearch(resp.body, { key: KW, page: 1 })
    r.count = (items || []).length
    r.titles = (items || []).slice(0, 2).map(function (x) { return x.title })
    const bad = (items || []).filter(function (x) { return !x.title }).length
    if (bad) r.noTitle = bad
  } catch (e) {
    r.err = String((e && e.message) || e).slice(0, 120)
    r.count = -1
  }
  rows.push(r)
  const tag = r.count > 0 ? 'OK  ' : (r.count === 0 ? 'EMPTY' : 'FAIL')
  console.log(
    tag.padEnd(5) + String(r.count).padStart(3) + ' 条  ' +
    String(r.ms || 0).padStart(5) + 'ms  code=' + String(r.code || '-').padStart(3) +
    '  ' + rec.name + (r.err ? '  ← ' + r.err : '') + (r.titles && r.titles.length ? '  ' + r.titles.join(' / ') : '')
  )
  fs.writeFileSync('C:/tmp/pen/probe_multi.json', JSON.stringify({ kw: KW, rows: rows }, null, 1))
}

const ok = rows.filter(function (r) { return r.count > 0 })
const empty = rows.filter(function (r) { return r.count === 0 })
const fail = rows.filter(function (r) { return r.count < 0 })
console.log('\n汇总：有结果 ' + ok.length + ' · 解析 0 条 ' + empty.length + ' · 失败 ' + fail.length +
  ' · 合计命中书 ' + rows.reduce(function (s, r) { return s + Math.max(0, r.count) }, 0) + ' 本')
