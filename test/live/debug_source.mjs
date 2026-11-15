// 单源调试：打印请求、响应片段、bookList 命中数与各字段取值
// node test/live/debug_source.mjs <书源名> [关键词]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { makeAdapter, classify } from '../../src/lib/legado.js'
import { selectNodes, selectChain } from '../../src/lib/css.js'

const NAME = process.argv[2]
const KW = process.argv[3] || '诡秘之主'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'

const all = JSON.parse(fs.readFileSync(new URL('../fixtures/legado_candidates.json', import.meta.url), 'utf8'))
const src = all.find(s => s.bookSourceName === NAME)
if (!src) { console.log('未找到：' + NAME); process.exit(1) }

const a = makeAdapter(src)
const req = a.request(src.searchUrl, { key: KW, page: 1 })
console.log('源   :', src.bookSourceName, src.bookSourceUrl)
console.log('分类 :', JSON.stringify(classify(src)))
console.log('请求 :', req.method, req.url)
if (req.body) console.log('body :', req.body.slice(0, 200))

const args = ['-sS', '-L', '--compressed', '--connect-timeout', '6', '-m', '10', '-A', UA, '--noproxy', '*']
if (req.method === 'POST') args.push('-X', 'POST', '--data-binary', req.body, '-H', 'Content-Type: application/x-www-form-urlencoded')
args.push('-w', '\n__M__%{http_code}|%{content_type}|%{size_download}', req.url)
let out
try {
  out = execFileSync('curl', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
} catch (e) {
  console.log('curl 失败：', String(e.message).split('\n')[0]); process.exit(2)
}
const s = out.toString('utf8')
const i = s.lastIndexOf('\n__M__')
const body = i >= 0 ? s.slice(0, i) : s
console.log('响应 :', (i >= 0 ? s.slice(i + 5).trim() : ''), '| 长度', body.length)
console.log('片段 :', body.slice(0, 200).replace(/\s+/g, ' '))

const rs = src.ruleSearch || {}
const isJson = /^\s*\$/.test(String(rs.bookList || ''))
let data = body
if (isJson) { try { data = JSON.parse(body) } catch (e) { console.log('JSON 解析失败'); process.exit(3) } }
console.log('bookList 规则:', rs.bookList, '| JSON?', isJson)
const nodes = isJson ? [] : selectNodes(data, rs.bookList)
console.log('bookList 命中:', isJson ? '(json)' : nodes.length)
if (!isJson) {
  for (const f of ['name', 'author', 'bookUrl', 'coverUrl', 'intro', 'kind', 'lastChapter']) {
    if (!rs[f]) continue
    console.log('  ' + f.padEnd(12), JSON.stringify(selectChain(data, rs[f].replace(/@put:\{[^}]*\}/g, '')).slice(0, 90)))
  }
} else {
  const list = a.parseSearch(data, { key: KW, page: 1 })
  console.log('解析条数:', list.length)
  console.log(JSON.stringify(list.slice(0, 2), null, 1))
}
