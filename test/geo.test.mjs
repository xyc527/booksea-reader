// 屏幕几何与分页自适配断言（纯函数，不需要设备）
import { metrics, normScreen, DESIGN_W, DESIGN_H, BASE, CHROME, fits } from '../src/lib/geo.js'
import { setScreen, maxLinesOf, maxEmOf, bodyH, fontByKey, paginateLines, layoutLines } from '../src/lib/text.js'

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

// ---------- 尺寸归一 ----------
const r1 = normScreen(936, 280)
eq(r1.w, 936, 'norm keeps landscape width')
eq(r1.h, 280, 'norm keeps landscape height')
eq(r1.fallback, false, 'norm 936x280 not fallback')

const r2 = normScreen(280, 936)
eq(r2.w, 936, 'norm flips portrait order (w)')
eq(r2.h, 280, 'norm flips portrait order (h)')

const r3 = normScreen(960, 266)
eq(r3.w, 960, 'norm 960x266 width')
eq(r3.h, 266, 'norm 960x266 height')

// 取不到尺寸（$falcon.env 没初始化完）必须回退设计稿，不能算出 0/负
for (const [w, h] of [[0, 0], [1, 1], [null, undefined], ['', ''], [NaN, 100]]) {
  const r = normScreen(w, h)
  eq(r.w, DESIGN_W, 'bad screen falls back w: ' + String(w))
  eq(r.h, DESIGN_H, 'bad screen falls back h: ' + String(h))
  eq(r.fallback, true, 'bad screen marks fallback: ' + String(w))
}

// ---------- 设计稿那一档必须和改造前完全一致 ----------
const g0 = metrics(936, 280)
eq(g0.body, 217, 'design body 217')
eq(g0.readCut, 211, 'design readCut 211')
eq(g0.setView, 171, 'design setView 171')
eq(g0.list, 139, 'design list 139')
eq(g0.homeRow, 224, 'design homeRow 224')
eq(g0.empty, 150, 'design empty 150')
eq(g0.cardSm, 107, 'design cardSm 107')
eq(g0.centerX, 468, 'design flip center 468')
eq(g0.dh, 0, 'design dh 0')

// ---------- 960×266 那档 ----------
const g1 = metrics(960, 266)
eq(g1.dh, -14, '960x266 dh -14')
eq(g1.body, BASE.body - 14, '960x266 body shrinks')
eq(g1.readCut, BASE.readCut - 14, '960x266 readCut shrinks')
eq(g1.setView, BASE.setView - 14, '960x266 setView shrinks')
eq(g1.list, BASE.list - 14, '960x266 list shrinks')
eq(g1.homeRow, BASE.homeRow - 14, '960x266 homeRow shrinks')
eq(g1.cardSm, 100, '960x266 cardSm 100')
eq(g1.centerX, 480, '960x266 flip center 480')

// ---------- 纵向预算：bd + 顶栏 + 底栏 不超屏高 ----------
// 这是本次改造的唯一目标：任何一档都不许把底部顶出屏幕
const sizes = [
  [936, 280], [960, 266], [960, 280], [1024, 300], [800, 248],
  [888, 266], [936, 266], [954, 272], [1280, 320]
]
for (const [w, h] of sizes) {
  const g = metrics(w, h)
  const label = w + 'x' + h
  ok(fits(g), 'fits screen ' + label, 'body=' + g.body + ' h=' + g.h)
  eq(g.body + CHROME.header + CHROME.footer <= g.h, true, 'body+chrome <= h ' + label)
  // 子容器必须落在 body 的 padding 内（左右 14 / 上下 8 的容器按 16 算）
  ok(g.readCut <= g.body, 'readCut <= body ' + label)
  ok(g.list + 26 + 3 + 30 <= g.body - 16, 'list+bar+pager <= body-16 ' + label,
    'need=' + (g.list + 59) + ' have=' + (g.body - 16))
  ok(g.setView + 16 + 30 <= g.body, 'setView+pager <= body ' + label)
  ok(g.cardSm * 2 + 10 <= g.homeRow, 'two cards fit row ' + label, g.cardSm * 2 + 10 + ' > ' + g.homeRow)
  ok(g.empty <= g.body, 'empty <= body ' + label)
  // 所有高度必须是正整数（内联 style 拼 px，小数/负数会渲染异常）
  for (const k of ['body', 'readCut', 'setView', 'list', 'homeRow', 'empty', 'cardSm']) {
    ok(g[k] > 0 && g[k] === Math.floor(g[k]), 'integer positive ' + k + ' ' + label, g[k])
  }
}

// 极端屏高：dh 要夹住，不能把阅读区压成 0 或无限高
const gTiny = metrics(320, 120)
ok(gTiny.body >= 120, 'tiny screen keeps min body', gTiny.body)
const gHuge = metrics(1920, 1080)
ok(gHuge.body <= BASE.body + 140, 'huge screen clamps body', gHuge.body)

// 横屏顺序反了也要得到同一套结果
const gFlip = metrics(266, 960)
eq(gFlip.w, 960, 'metrics flips portrait input (w)')
eq(gFlip.body, g1.body, 'metrics flips portrait input (body)')

// ---------- 分页随屏高变化 ----------
const M = fontByKey('M')
setScreen(936, 280)
eq(bodyH(), 217, 'bodyH design 217')
eq(maxLinesOf(M), 8, 'design maxLines M 8')
const em0 = maxEmOf(M)

setScreen(960, 266)
eq(bodyH(), 203, '960x266 bodyH 203')
eq(maxLinesOf(M), 7, '960x266 maxLines M 7')
ok(maxEmOf(M) > em0, 'wider screen fits more chars per line', maxEmOf(M) + ' vs ' + em0)

// 少一行意味着同一段正文被切成更多页，且不丢字
const text = '这是一段用来验证换屏后分页仍然完整的中文文字，'.repeat(40)
const laid = layoutLines([text], maxEmOf(M))
const pages = paginateLines(laid.items, laid.end, maxLinesOf(M))
let covered = 0
for (const p of pages) covered += p.lines.length
eq(covered, laid.items.length, 'every laid line lands on a page after resize')

// 竖向空间不足时行数不能为 0（Math.floor 到 0 会让阅读页空白）
setScreen(320, 120)
ok(maxLinesOf(M) >= 1, 'tiny screen still yields 1 line per page', maxLinesOf(M))

// 复位：其他测试文件依赖设计稿默认值
setScreen(936, 280)
eq(maxLinesOf(M), 8, 'reset to design size')

// ---------- 输出 ----------
if (fail) {
  console.log('\nFAILED ' + fail + ' / ' + (pass + fail))
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
} else {
  console.log('geo: ' + pass + ' assertions passed')
}
