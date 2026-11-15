// 整本逐章下载实测：把轻之国度的 88 章全部抓下来落盘成一个 txt
// 目的：证明「整本下载 = 逐章遍历」在本项目里真的跑得通（不依赖站点整本接口）
//
// 用法：node test/live/run_ln_full.mjs [bookId] [章数上限]

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { siteOf, parseBookUrl } from '../../src/lib/lightnovel.js'

const UA = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'
const BOOK = process.argv[2] || '1338'
const LIMIT = parseInt(process.argv[3] || '0', 10)
const OUT = 'out/light'
fs.mkdirSync(OUT, { recursive: true })

const lk = siteOf('lk')
const stats = { req: 0, ms: 0, fail: 0, chars: 0 }

function post(req) {
  const t0 = Date.now()
  try {
    const r = execFileSync('curl', [
      '-sS', '--noproxy', '*', '--compressed', '--connect-timeout', '8', '-m', '30',
      '-A', UA, '-X', 'POST', '--data-binary', req.body,
      '-H', 'Content-Type: application/json; charset=UTF-8',
      '-H', 'Referer: https://www.lightnovel.fun/',
      '-w', '\n__C__%{http_code}', req.url
    ], { maxBuffer: 48 * 1024 * 1024, timeout: 35000 })
    const s = r.toString('utf8')
    const i = s.lastIndexOf('\n__C__')
    const code = i >= 0 ? parseInt(s.slice(i + 6), 10) : 0
    stats.req++
    stats.ms += Date.now() - t0
    return code === 200 ? s.slice(0, i) : null
  } catch (e) {
    stats.req++
    stats.fail++
    return null
  }
}

// 1) 目录全量
console.log('[1] 拉目录 book=' + BOOK)
const toc = []
let page = 1
while (page < 40) {
  const rt = post(lk.build.toc(BOOK, page))
  if (!rt) break
  const pv = lk.parse.toc(rt)
  for (const v of pv.list) {
    let cp = 1
    while (cp < 60) {
      const rc = post(lk.build.chapters(BOOK, v.volumeId, cp))
      if (!rc) break
      const pc = lk.parse.chapters(rc)
      for (const c of pc.list) toc.push({ title: c.title, volume: v.title, id: c.chapterId })
      if (!pc.hasNext) break
      cp++
    }
  }
  if (!pv.hasNext) break
  page++
}
console.log('    目录 ' + toc.length + ' 章 / 请求 ' + stats.req + ' 次 / ' + stats.ms + 'ms')

const list = LIMIT > 0 ? toc.slice(0, LIMIT) : toc
console.log('[2] 逐章下载 ' + list.length + ' 章')
const t0 = Date.now()
const buf = []
let ok = 0
for (let i = 0; i < list.length; i++) {
  const c = list[i]
  const raw = post(lk.build.chapter(BOOK, c.id))
  if (!raw) {
    console.log('    ✗ 第 ' + (i + 1) + ' 章 请求失败：' + c.title.slice(0, 20))
    continue
  }
  const st = lk.parse.chapterStatus(raw)
  const text = lk.parse.chapter(raw)
  if (!text) {
    console.log('    ✗ 第 ' + (i + 1) + ' 章 ' + (st.reason || '正文为空') + '：' + c.title.slice(0, 20))
    continue
  }
  ok++
  stats.chars += text.length
  buf.push('## ' + c.volume + ' · ' + c.title + '\n\n' + text)
  if ((i + 1) % 20 === 0) console.log('    已下 ' + (i + 1) + '/' + list.length + ' · ' + Math.round((Date.now() - t0) / 1000) + 's')
}

const file = OUT + '/lk_full_' + BOOK + '.txt'
fs.writeFileSync(file, buf.join('\n\n'))
const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2)
console.log('[3] 落盘 ' + file)
console.log('    成功 ' + ok + '/' + list.length + ' 章 · ' + stats.chars + ' 字 · ' + mb + 'MB')
console.log('    总耗时 ' + Math.round((Date.now() - Date.now() + (Date.now() - t0)) / 1000) + 's（本次下载段）· 网络请求 ' + stats.req + ' 次 / ' + stats.ms + 'ms')
const avg = stats.req ? Math.round(stats.ms / stats.req) : 0
console.log('    单请求平均 ' + avg + 'ms → 估算 ' + toc.length + ' 章整本约 ' + Math.round((avg * (toc.length + 14)) / 1000 / 60 * 10) / 10 + ' 分钟')

fs.writeFileSync(OUT + '/full_result.json', JSON.stringify({
  book: BOOK, tocTotal: toc.length, tried: list.length, ok, chars: stats.chars,
  bytes: fs.statSync(file).size, req: stats.req, netMs: stats.ms, avgMs: avg,
  secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString()
}, null, 2))
