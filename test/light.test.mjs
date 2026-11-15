// 轻小说源解析单测：全部用真实响应快照（2026-11-10 直连轻之国度取得）
// 不联网也能跑，用来防止改解析逻辑时把已有站点改坏。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { siteOf, parseBookUrl, htmlToText, lnAdapter, LN_SITES, cleanIntro } from '../src/lib/lightnovel.js'
import { lnSourceAdapter } from '../src/lib/sources.js'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ln')
const read = (n) => fs.readFileSync(path.join(DIR, n), 'utf8')

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) pass++
  else fails.push(name + (extra ? ' → ' + extra : ''))
}

const lk = siteOf('lk')

// ---------- 站点注册 ----------
ok('注册表里有轻之国度', !!lk && lk.id === 'lk')
ok('站点地址正确', lk.base === 'https://www.lightnovel.fun')
ok('标记为不需要登录', lk.login === false)
ok('依赖声明：无 JS/Cookie/WebView/XPath', !lk.need.js && !lk.need.webview && !lk.need.xpath)

// ---------- URL 反解 ----------
ok('反解书籍地址', (function () { const r = parseBookUrl('https://www.lightnovel.fun/book/1338'); return r && r.bookId === '1338' && r.chapterId === '' })())
ok('反解章节地址', (function () { const r = parseBookUrl('https://www.lightnovel.fun/book/1338/chapter/276838'); return r && r.bookId === '1338' && r.chapterId === '276838' })())
ok('非法地址返回 null', parseBookUrl('https://x.com/a') === null)

// ---------- 请求构造 ----------
const sreq = lk.build.search('败犬', 1)
ok('搜索是 POST', sreq.method === 'POST')
ok('搜索 URL 命中接口', sreq.url.endsWith('/api/pc-proxy/api/bff/apk-search-result-v1'))
ok('搜索 Content-Type 是 JSON', /application\/json/.test(sreq.headers['Content-Type']))
ok('搜索带 Referer', /lightnovel\.fun/.test(sreq.headers.Referer))
const sbody = JSON.parse(sreq.body)
ok('页码从 0 开始（1 → 0）', sbody.page === 0, String(sbody.page))
ok('关键词进 body', sbody.q === '败犬')
ok('每页 20 条', sbody.pageSize === 20)

const sreq3 = lk.build.search('刀剑', 3)
ok('第 3 页 → page=2', JSON.parse(sreq3.body).page === 2)

const dreq = lk.build.detail('1338')
ok('详情接口地址', dreq.url.endsWith('/get-book-detail'))
ok('详情 body 带 book_id', JSON.parse(dreq.body).book_id === '1338')

const creq = lk.build.chapter('1338', '276838')
ok('正文接口地址', creq.url.endsWith('/get-chapter-detail'))
ok('正文 body 带 book_id/chapter_id', (function () {
  const b = JSON.parse(creq.body)
  return b.book_id === '1338' && b.chapter_id === '276838'
})())

// ---------- 搜索解析 ----------
const sres = lk.parse.search(read('search.json'))
ok('搜索解析出 10 条', sres.length === 10, String(sres.length))
ok('第一条书名正确', sres[0].title === '败犬女主太多了！', sres[0].title)
ok('作者正确', sres[0].author === '雨森たきび', sres[0].author)
ok('书籍地址自解释', sres[0].url === 'https://www.lightnovel.fun/book/1338', sres[0].url)
ok('bid 等于 book_id', sres[0].bid === '1338')
ok('有简介', String(sres[0].intro).length > 5)
ok('有封面', /^https?:\/\//.test(sres[0].cover))
ok('带来源 id', sres[0].sourceId === 'lk')
ok('分类取到轻小说', sres[0].kind === '轻小说', sres[0].kind)

// 解析工具对脏数据的容忍
ok('空响应解析成空数组', lk.parse.search('').length === 0)
ok('HTML 响应解析成空数组', lk.parse.search('<html><body>拦截页</body></html>').length === 0)
ok('code 非 0 解析成空数组', lk.parse.search('{"code":1,"message":"未登录"}').length === 0)

// ---------- 详情解析 ----------
const dres = lk.parse.detail(read('detail.json'))
ok('详情书名', dres.name === '败犬女主太多了！', dres.name)
ok('详情作者', dres.author === '雨森たきび')
ok('详情有简介', String(dres.intro).length > 5)
ok('详情 tocUrl 指向书页', dres.tocUrl === 'https://www.lightnovel.fun/book/1338')
ok('无成品 EPUB（epub_ready=0）', dres.epubReady === false)

// ---------- 卷目录 ----------
const vres = lk.parse.toc(read('volumes.json'))
ok('13 卷', vres.list.length === 13, String(vres.list.length))
ok('卷名正确', vres.list[0].title === '1卷', vres.list[0].title)
ok('卷有 id', vres.list[0].volumeId === 36754)
ok('章数透传', vres.list[0].chapterCount === 7, String(vres.list[0].chapterCount))
ok('单页无下一页', vres.hasNext === false)

// ---------- 章节列表 ----------
const cres = lk.parse.chapters(read('chapters.json'))
ok('7 章', cres.list.length === 7, String(cres.list.length))
ok('章名正确', cres.list[0].title.indexOf('一败目') === 0, cres.list[0].title)
ok('chapter_id 正确', cres.list[0].chapterId === 276838)
ok('公开章节识别为未锁定', cres.list[0].locked === false)
ok('access_type=public', cres.list[0].accessType === 'public')
ok('单价 0', cres.list[0].price === 0)

// ---------- 正文 ----------
const rawChapter = read('chapter.json')
const ctext = lk.parse.chapter(rawChapter)
ok('正文 2 万字以上', ctext.length > 20000, String(ctext.length))
ok('正文按段落分行（>500 行）', ctext.split('\n').length > 500, String(ctext.split('\n').length))
ok('没有残留 HTML 标签', ctext.indexOf('<') < 0)
ok('没有残留实体', !/&[a-z]+;/.test(ctext))
ok('首行是章节标题', ctext.split('\n')[0].indexOf('一败目') >= 0)

const st = lk.parse.chapterStatus(rawChapter)
ok('正文状态判定为成功', st.ok === true, JSON.stringify(st))
ok('正文状态不要求登录', !st.needLogin)

const locked = JSON.stringify({ code: 0, data: { access_type: 'vip', locked: 1, coin_price: 30, body_snapshot: {} } })
const st2 = lk.parse.chapterStatus(locked)
ok('付费章节识别为需登录/购买', st2.ok === false && st2.needLogin === true, JSON.stringify(st2))
ok('付费章节给出原因', /access_type/.test(st2.reason))

const htmlPage = '<html><body>Just a moment...</body></html>'
ok('非 JSON 响应不算成功', lk.parse.chapterStatus(htmlPage).ok === false)
ok('非 JSON 响应解析出空正文', lk.parse.chapter(htmlPage) === '')

// ---------- 正文 HTML 转文本细节 ----------
ok('ruby 注音被剥离', htmlToText('<p>漢<ruby>字<rt>じ</rt></ruby>です</p>') === '漢字です')
ok('插图变占位标记', /\[插图\]/.test(htmlToText('<p>a<img src="x.jpg"/>b</p>')))
ok('br 切行', htmlToText('<p>一<br/>二</p>').split('\n').length === 2)
ok('嵌套 div>p 不重复', htmlToText('<div><p>只有一次</p></div>') === '只有一次')
ok('script/style 被删', htmlToText('<p>正文</p><script>var a=1</script><style>.a{}</style>') === '正文')
ok('空标签不产出空行', htmlToText('<p></p><p> </p><p>x</p>') === 'x')

// ---------- 适配器（注入假 fetch） ----------
const fakeBook = { bid: '1338', url: 'https://www.lightnovel.fun/book/1338', title: 'T' }
const ad = lnAdapter('lk', async function (req) {
  if (req.url.indexOf('apk-search-result-v1') >= 0) return read('search.json')
  if (req.url.indexOf('get-book-detail') >= 0) return read('detail.json')
  if (req.url.indexOf('get-book-volumes') >= 0) return read('volumes.json')
  if (req.url.indexOf('get-volume-chapters') >= 0) return read('chapters.json')
  if (req.url.indexOf('get-chapter-detail') >= 0) return read('chapter.json')
  return null
})
const sr = await ad.search('败犬', 1)
ok('适配器搜索 10 条', sr.list.length === 10)
const tr = await ad.toc(fakeBook)
ok('适配器目录按卷展开（13 卷 × 7 章 = 91 章）', tr.list.length === 91, String(tr.list.length))
ok('目录带卷名', tr.list[0].volume === '1卷', tr.list[0].volume)
ok('目录章节地址自解释', /\/book\/1338\/chapter\/276838/.test(tr.list[0].url), tr.list[0].url)
const cr = await ad.chapter({ url: tr.list[0].url }, fakeBook)
ok('适配器取正文成功', cr.text.length > 20000)
ok('适配器正文无错误', cr.error === '')

// 空网络
const adNull = lnAdapter('lk', async function () { return null })
ok('网络全失败时搜索不抛异常', (await adNull.search('x', 1)).list.length === 0)
ok('网络全失败时目录不抛异常', (await adNull.toc(fakeBook)).list.length === 0)
ok('网络全失败时正文给出错误', (await adNull.chapter({ url: 'https://www.lightnovel.fun/book/1/chapter/2' })).error.length > 0)

// ---------- 简介清洗（真机上抓到的问题） ----------
// 站点把 summary 截在 HTML 标签中间，会漏出 CSS 残片，设备上会当正文显示
ok('清掉 font= 残片', cleanIntro('书名：同为败犬啊！[font=webfont, 微软雅黑, "Microso') === '书名：同为败犬啊！',
  cleanIntro('书名：同为败犬啊！[font=webfont, 微软雅黑, "Microso'))
ok('清掉未闭合标签', cleanIntro('正常简介<span style="col').indexOf('<') < 0, cleanIntro('正常简介<span style="col'))
ok('清掉 font-family 残片', cleanIntro('简介文字;font-family: webfont').indexOf('font') < 0,
  cleanIntro('简介文字;font-family: webfont'))
ok('不误伤正常方括号', cleanIntro('【系统流】主角很强').indexOf('【系统流】') === 0,
  cleanIntro('【系统流】主角很强'))
ok('空值安全', cleanIntro(null) === '')

// ---------- 抓取回调返回约定（真机抓到的 bug） ----------
// 页面层传进来的 fetchReq 返回裸字符串，适配器曾经按 {text} 取，导致
// 「一次拿全目录」的站点（鲸云）永远得到 null，界面报「目录没抓到」而请求是 200。
{
  const jyRaw = JSON.stringify({
    code: 0,
    msg: '成功',
    data: [{ id: 1, chapter_name: '正文', directory: [
      { id: 11, page: 1, title: '第一章 黑龙少女', words: 3527, is_pay: 0, section_coins: 0 },
      { id: 12, page: 2, title: '第二章 被诅咒的', words: 2100, is_pay: 0, section_coins: 0 }
    ] }]
  })
  const ad = lnSourceAdapter({ id: 'ln_jy', name: '鲸云轻小说', kind: 'ln', lnId: 'jy' })
  const gotStr = await ad.tocAll({ bid: '422', url: '' }, async () => jyRaw)
  ok('裸字符串回调能解析出目录', gotStr.chapters.length === 2, String(gotStr.chapters.length))
  ok('章节标题正确', gotStr.chapters[0].title === '第一章 黑龙少女', gotStr.chapters[0].title)
  const gotObj = await ad.tocAll({ bid: '422', url: '' }, async () => ({ text: jyRaw }))
  ok('{text} 回调同样能解析', gotObj.chapters.length === 2, String(gotObj.chapters.length))
  const gotNull = await ad.tocAll({ bid: '422', url: '' }, async () => null)
  ok('回调返回 null 时给空目录不抛错', gotNull.chapters.length === 0)
}

// ---------- 站点数量 ----------
ok('至少注册 1 个轻小说站点', LN_SITES.length >= 1)

console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项')
if (fails.length) {
  console.log('失败项：')
  fails.forEach((f) => console.log(' - ' + f))
  process.exit(1)
}
console.log('全部通过 ✅')
