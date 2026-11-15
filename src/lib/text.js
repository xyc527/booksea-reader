// 纯函数：字号档位、视觉宽度、折行、分页
// 不依赖任何平台 API，可在 Node 里直接跑

import { DESIGN_W, DESIGN_H, normScreen } from './geo.js'

// 屏幕尺寸是运行时可变的：同一份代码要跑在 936×280 与 960×266 等不同机型上。
// 默认用设计稿，页面启动时调 setScreen() 换成真实尺寸，分页行数随之变化。
let SW = DESIGN_W
let SH = DESIGN_H

export function setScreen(w, h) {
  const s = normScreen(w, h)
  SW = s.w
  SH = s.h
  return { w: SW, h: SH }
}

export function screenW() {
  return SW
}

export function screenH() {
  return SH
}

// 阅读区几何（与 index.vue 的样式保持一致）
export const READ = {
  header: 33,
  footer: 30,
  padL: 16,
  padR: 16,
  padT: 4,
  padB: 2
}

export const FONTS = [
  { key: 'S', label: '小', size: 16, line: 21 },
  { key: 'M', label: '中', size: 18, line: 25 },
  { key: 'L', label: '大', size: 21, line: 29 }
]

export function fontByKey(k) {
  for (let i = 0; i < FONTS.length; i++) if (FONTS[i].key === k) return FONTS[i]
  return FONTS[1]
}

export function fontNext(k) {
  for (let i = 0; i < FONTS.length; i++) {
    if (FONTS[i].key === k) return FONTS[(i + 1) % FONTS.length].key
  }
  return 'M'
}

// 一行能放多少「全角字符」
export function maxEmOf(font) {
  // 留 10px 余量 + 1.02 的字宽修正：实测 CJK 字面比 1em 略宽，按 1em 算会贴边被裁
  const w = SW - READ.padL - READ.padR - 10
  const em = Math.floor((w / font.size / 1.02) * 100) / 100
  return em
}

// 一页能放多少行
export function maxLinesOf(font) {
  const h = SH - READ.header - READ.footer - READ.padT - READ.padB
  return Math.max(1, Math.floor(h / font.line))
}

// 正文区显式高度（这个框架里 flex:1 不会把 body 撑满，必须写死）
export function bodyH() {
  return SH - READ.header - READ.footer
}

// 单字符宽度（单位：字号 em）
export function charEm(ch) {
  const c = ch.charCodeAt(0)
  if (c === 9) return 1.0
  if (c < 0x0020) return 0
  if (c === 0x20) return 0.32
  if (c < 0x0080) return 0.56
  if (c >= 0xff01 && c <= 0xff60) return 1.0 // 全角标点
  if (c >= 0x2e80) return 1.0
  return 0.6
}

export function measure(s) {
  let w = 0
  for (let i = 0; i < s.length; i++) w += charEm(s[i])
  return w
}

// 超长标题按宽度截断
export function ellipsis(s, maxEm) {
  s = String(s == null ? '' : s)
  if (measure(s) <= maxEm) return s
  let out = ''
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const cw = charEm(s[i])
    if (w + cw > maxEm - 0.9) break
    out += s[i]
    w += cw
  }
  return out + '…'
}

// 折行：返回行数组
// 避头标点：这些字符不另起一行，宁可让上一行略超一点（正文左右各留了余量）
const NO_LINE_START = '，。！？、；：）】》」』”’…—·,.!?;:)]}'
// 用散列表代替 indexOf：整章折行时每个字都要查一次，字符串查找是热点
const NO_START_SET = {}
for (let i = 0; i < NO_LINE_START.length; i++) NO_START_SET[NO_LINE_START.charAt(i)] = 1

// 单字符宽度（单位：字号 em），按码位取，避免为每个字创建临时字符串
export function cwAt(s, i) {
  const c = s.charCodeAt(i)
  if (c === 9) return 1.0
  if (c < 0x0020) return 0
  if (c === 0x20) return 0.32
  if (c < 0x0080) return 0.56
  if (c >= 0xff01 && c <= 0xff60) return 1.0 // 全角标点
  if (c >= 0x2e80) return 1.0
  return 0.6
}

export function wrap(text, maxEm) {
  const lines = []
  const s = String(text == null ? '' : text)
  let start = 0
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const cw = cwAt(s, i)
    // 切片代替逐字拼接：整章折行时 cur += ch 会产生几千个中间字符串
    if (w + cw > maxEm + 0.001 && i > start && !NO_START_SET[s.charAt(i)]) {
      lines.push(s.slice(start, i))
      start = i
      w = 0
    }
    w += cw
  }
  if (s.length > start) lines.push(s.slice(start))
  return lines
}

/**
 * 分页
 * @param {string[]} paras 段落数组
 * @param {number} maxEm 每行宽度（em）
 * @param {number} maxLines 每页行数
 * @returns {{lines:string[], start:number, end:number}[]}
 */
export function layoutLines(paras, maxEm) {
  const items = [] // {t, off}
  let off = 0
  for (let pi = 0; pi < paras.length; pi++) {
    const p = String(paras[pi] == null ? '' : paras[pi])
    if (!p || /^\s*$/.test(p)) {
      off += 1
      continue
    }
    const text = '　　' + p // 段首缩进两格
    const n = text.length
    let w = 0
    let start = 0
    let lineOff = off
    for (let i = 0; i < n; i++) {
      const cw = cwAt(text, i)
      if (w + cw > maxEm + 0.001 && i > start && !NO_START_SET[text.charAt(i)]) {
        items.push({ t: text.slice(start, i), off: lineOff })
        start = i
        w = 0
        lineOff = off + Math.max(0, i - 2)
      }
      w += cw
    }
    if (n > start) items.push({ t: text.slice(start, n), off: lineOff })
    off += p.length + 1
  }
  return { items: items, end: off }
}

// 按「字符偏移」找回所在行（滚动模式切字号时保持位置）
export function lineOfOffset(items, offset) {
  if (!items || !items.length) return 0
  for (let i = 0; i < items.length; i++) {
    if (offset < items[i].off && i > 0) return i - 1
  }
  return items.length - 1
}

export function paginateLines(items, end, maxLines) {
  const pages = []
  if (!items.length) {
    pages.push({ lines: [''], start: 0, end: 0 })
    return pages
  }
  for (let i = 0; i < items.length; i += maxLines) {
    const chunk = items.slice(i, i + maxLines)
    pages.push({
      lines: chunk.map((x) => x.t),
      start: chunk[0].off,
      end: i + maxLines < items.length ? items[i + maxLines].off : end
    })
  }
  return pages
}

export function paginate(paras, maxEm, maxLines) {
  const laid = layoutLines(paras, maxEm)
  return paginateLines(laid.items, laid.end, maxLines)
}

// 按「字符偏移」找回所在页（切字号时保持阅读位置）
export function pageOfOffset(pages, offset) {
  for (let i = 0; i < pages.length; i++) {
    if (offset < pages[i].end || i === pages.length - 1) return i
  }
  return 0
}

// 进度百分比（0-100）
export function percent(a, b) {
  if (!b) return 0
  const v = Math.round((a / b) * 100)
  return v < 0 ? 0 : v > 100 ? 100 : v
}
