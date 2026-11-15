import { FONTS, fontByKey, maxEmOf, maxLinesOf, paginate, pageOfOffset, ellipsis, measure, percent, wrap } from '../src/lib/text.js'
import { parseSearch, parseToc, parseChapter, tidy } from '../src/lib/parse.js'
import { tocPageOf, indexOfToc, windowOf, moveCursor, kb } from '../src/lib/fmt.js'

let pass = 0
let fail = 0
const failures = []

function ok(cond, name, extra) {
  if (cond) pass++
  else {
    fail++
    failures.push(name + (extra ? ' :: ' + extra : ''))
  }
}

function eq(a, b, name) {
  ok(a === b, name, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))
}

// ---------- 字号与几何 ----------
const M = fontByKey('M')
eq(M.size, 18, 'font M size')
eq(fontByKey('X').key, 'M', 'unknown font falls back to M')
ok(maxEmOf(M) > 40 && maxEmOf(M) < 60, 'maxEm M in range', maxEmOf(M))
ok(maxLinesOf(M) >= 7 && maxLinesOf(M) <= 10, 'maxLines M in range', maxLinesOf(M))

// 字号越大，每页字越少
const emS = maxEmOf(fontByKey('S'))
const emL = maxEmOf(fontByKey('L'))
ok(emS > emL, 'small font fits more chars per line')
ok(maxLinesOf(fontByKey('S')) > maxLinesOf(fontByKey('L')), 'small font fits more lines')

// ---------- 折行 / 分页 ----------
const long = '这是一段用来测试分页的中文文字，'.repeat(30)
const pages = paginate([long], 20, 5)
ok(pages.length >= 5, 'long paragraph spans pages', pages.length)
ok(pages[0].lines.length === 5, 'page has exactly maxLines lines')
// 所有行都不超宽（缩进两格算在内）
let widest = 0
pages.forEach((p) => p.lines.forEach((l) => { widest = Math.max(widest, measure(l)) }))
ok(widest <= 20.01, 'no line exceeds maxEm', widest)
// 内容不丢字
const allText = pages.map((p) => p.lines.join('')).join('').replace(/　+/g, '')
ok(allText.length >= long.length, 'no characters lost', allText.length + '/' + long.length)

// 空段落也能出页
const emptyPages = paginate([], 20, 5)
eq(emptyPages.length, 1, 'empty input still has one page')

// 段落缩进
const p2 = paginate(['第一段', '第二段'], 20, 5)
ok(p2[0].lines[0].indexOf('　　') === 0, 'paragraph starts with indent')
ok(p2[0].lines.length === 2, 'two short paragraphs occupy two lines')

// 位置找回
const many = []
for (let i = 0; i < 40; i++) many.push('这是第' + i + '段内容，用来测试偏移找回。')
const big = paginate(many, 20, 5)
const mid = big[Math.floor(big.length / 2)]
const found = pageOfOffset(big, mid.start + 1)
ok(found >= Math.floor(big.length / 2) - 1 && found <= Math.floor(big.length / 2), 'pageOfOffset near middle', found)
eq(pageOfOffset(big, 0), 0, 'offset 0 -> first page')
eq(pageOfOffset(big, 1e9), big.length - 1, 'huge offset -> last page')

// 截断
ok(ellipsis('一二三四五六七八九十', 4).length <= 5, 'ellipsis shortens')
ok(ellipsis('短', 10) === '短', 'ellipsis keeps short text')

eq(percent(1, 4), 25, 'percent 1/4')
eq(percent(0, 0), 0, 'percent guard')

// ---------- 搜索解析 ----------
const searchHtml = `
<div class="bookClassCardGrid" id="bookList">
<article class="classBookCard"><span class="classBookCover"><a class="classBookCoverLink" href="/book/1262260513468561506.html" title="我不是戏神"><img src="x.jpg"/></a></span>
<div class="classBookBody"><h3 class="classBookTitle"><a href="/book/1262260513468561506.html">我不是戏神</a></h3>
<p class="classBookAuthor">作者：<a href="#">三九音域</a></p>
<p class="classBookMeta">已完结 · 414.56万字</p>
<p class="classBookChapter"><a href="/book/1/2.html">完本感言。</a></p>
<p class="classBookDesc">《斩神》作家三九音域全新力作 &amp; 逆转时代</p></div></article>
<article class="classBookCard"><span class="classBookCover"><a class="classBookCoverLink" href="/book/999.html" title="另<em>一本</em>书"></a></span>
<div class="classBookBody"><h3 class="classBookTitle"><a href="/book/999.html">另<em>一本</em>书</a></h3>
<p class="classBookAuthor">作者：<a href="#">某人</a></p></div></article>
</div>`
const rs = parseSearch(searchHtml)
eq(rs.length, 2, 'parse two search cards')
eq(rs[0].bid, '1262260513468561506', 'search bid')
eq(rs[0].title, '我不是戏神', 'search title')
eq(rs[0].author, '三九音域', 'search author strips 作者 prefix')
eq(rs[0].meta, '已完结 · 414.56万字', 'search meta')
ok(rs[0].desc.indexOf('&') >= 0, 'search desc entity decoded', rs[0].desc)
eq(rs[1].title, '另一本书', 'search title strips inner tags')

// ---------- 目录解析 ----------
const bid = '123'
const tocHtml = `<meta name="description" content="第1页，共1928章，本页收录...">
<a href="/book/${bid}/111.html">第1章 起点<i class="red"> [免费]</i></a>
<a href="/book/${bid}/222.html">第2章 继续</a>
<a href="/book/${bid}/111.html">第1章 起点</a>`
const toc = parseToc(tocHtml, bid)
eq(toc.total, 1928, 'toc total')
eq(toc.chapters.length, 2, 'toc dedup')
eq(toc.chapters[0].cid, '111', 'toc cid')
eq(toc.chapters[0].title, '第1章 起点', 'toc title strips free badge')
eq(toc.chapters[1].title, '第2章 继续', 'toc second')

const toc2 = parseToc('<meta name="keywords" content="书海阁,我不是戏神,章节目录,最新章节"/>', bid)
eq(toc2.title, '我不是戏神', 'toc book title')

// ---------- 正文解析 ----------
const chHtml = `<h1><span id="indexName">第1章 戏鬼回家</span></h1>
<div class="readChapterAppendHeader"><span class="readChapterAppendText">第1章 戏鬼回家</span></div>
<div class="readChapterAppendBody"><p>第1章</p><p>​戏鬼回家</p><p>“我……是谁？”</p><p>轰隆——</p><p>请记住本站域名</p><p>正文最后一段。</p></div></section>
<div id="vipPanel">后面不该被读到</div>`
const ch = parseChapter(chHtml, '')
eq(ch.title, '第1章 戏鬼回家', 'chapter title')
eq(ch.paras.length, 3, 'chapter drops title dup and junk', JSON.stringify(ch.paras))
eq(ch.paras[0], '“我……是谁？”', 'chapter first para')
ok(ch.chars > 0, 'chapter chars')

// 没有容器时也能兜底
const ch2 = parseChapter('<p>只有一段</p>', '第9章 兜底')
eq(ch2.title, '第9章 兜底', 'chapter fallback title')
eq(ch2.paras.length, 1, 'chapter fallback body')

// ---------- 目录换算 ----------
eq(tocPageOf(0), 1, 'toc page of 0')
eq(tocPageOf(99), 1, 'toc page of 99')
eq(tocPageOf(100), 2, 'toc page of 100')
eq(tocPageOf(1927), 20, 'toc page of 1927')
eq(indexOfToc(1, 0), 0, 'index of page1 pos0')
eq(indexOfToc(2, 0), 100, 'index of page2 pos0')
eq(indexOfToc(20, 27), 1927, 'index of last chapter')

const win = windowOf(5, 1928, 8)
eq(win.from, 5, 'window from')
eq(win.to, 13, 'window to')
const winEnd = windowOf(1925, 1928, 8)
eq(winEnd.to, 1928, 'window clamps at end')

eq(moveCursor(0, -1, 1928, 8), 0, 'cursor cannot go below 0')
eq(moveCursor(1920, 1, 1928, 8), 1927, 'cursor clamps at last')

eq(kb(512), '512 B', 'kb bytes')
eq(kb(2048), '2 KB', 'kb kilo')
eq(kb(3 * 1024 * 1024), '3.0 MB', 'kb mega')

// ---------- 避头尾 ----------
const wPunc = wrap('一二三四五六七八九十！', 10)
eq(wPunc.length, 1, 'avoid-start: 标点不另起一行')
eq(wPunc[0].slice(-1), '！', 'avoid-start: 标点留在行尾')

const wPlain = wrap('一二三四五六七八九十一', 10)
eq(wPlain.length, 2, 'wrap: 普通字符照常折行')
eq(wPlain[0], '一二三四五六七八九十', 'wrap: 首行满宽')

// 折行后拼回原文，确保不丢字、不乱序
const src = '风从长街尽头吹来，卷起满地碎纸。他抬手压住帽檐，一步一步走过去，没有回头。'
const joined = wrap(src, 8).join('')
eq(joined, src, 'wrap: 拼回等于原文')

// 分页内的折行同样遵守避头尾（段落会加两格全角缩进）
const pg = paginate(['一二三四五六七八九十！'], 12, 5)
eq(pg[0].lines.length, 1, 'paginate: 标点不另起一行')
eq(pg[0].lines[0].slice(-1), '！', 'paginate: 标点留在行尾')
const pgPlain = paginate(['一二三四五六七八九十一'], 12, 5)
eq(pgPlain[0].lines.length, 2, 'paginate: 普通字符照常折行')

// ---------- 结果 ----------
console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项')
if (fail) {
  failures.forEach((f) => console.log('  ✗ ' + f))
  process.exit(1)
}
console.log('全部通过 ✅')
