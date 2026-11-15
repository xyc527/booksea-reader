// 纯函数：把「设备逻辑尺寸」换算成各容器的像素高度
//
// 背景：这套界面是按 936×280 的设计稿写死的，而 PStore 上架到全设备后，
// 同一个应用会跑在逻辑分辨率不同的机型上（官方 review 提到 960×266 这一档）。
// 高度少 14px 就足以把底部按钮顶出屏幕，所以所有「吃掉剩余空间」的容器
// 都不能再写死，必须按真实高度算。
//
// 这里只做一件事：算一个纵向余量 dh = 实际高 - 280，然后把主容器各平移 dh。
// 行高、字号、按钮高度不动 —— 那些是「内容尺寸」，跟着缩会让字变小、可读性变差。

export const DESIGN_W = 936
export const DESIGN_H = 280

// 顶栏 32 + 1px 分隔线；阅读页底栏 30
export const CHROME = { header: 33, footer: 30 }

// 设计稿下各主容器的高度（与 index.vue 的样式一一对应）
export const BASE = {
  body: 217,   // .bd  —— 33 顶栏 + 217 + 30 底栏 = 280
  readCut: 211, // 阅读裁切窗 = body - padT(4) - padB(2)
  setView: 171, // 设置页滚动视口 = body - 16(padding) - 30(pager)
  list: 139,    // 书源/CDN/来源列表 = 26(lbar) + 3 + 139 + 30(pager) 落在可用高度内
  homeRow: 224, // 首页三卡那一行
  empty: 150    // 空结果占位
}

// 兜底下限：再小的屏也留出可点的空间，宁可溢出一点也不要压成负数
const MIN = { body: 120, readCut: 90, setView: 80, list: 70, homeRow: 120, empty: 60 }

function num(v) {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

// 设备可能把宽高报成竖屏（280×936），一律归一成横屏：大的一边当宽。
// 荒谬值（0、1×1、UI 还没初始化完）回退到设计稿，避免算出负高度把界面压塌。
export function normScreen(w, h) {
  let a = Math.round(num(w))
  let b = Math.round(num(h))
  if (a > 0 && b > 0 && b > a) {
    const t = a
    a = b
    b = t
  }
  if (!(a >= 320 && b >= 120)) return { w: DESIGN_W, h: DESIGN_H, fallback: true }
  return { w: a, h: b, fallback: false }
}

export function metrics(w, h) {
  const s = normScreen(w, h)
  let dh = s.h - DESIGN_H
  // 上限也不放开：真遇到奇怪的超大高度，也只是让列表更长，不能让阅读区无限高
  if (dh < -90) dh = -90
  if (dh > 140) dh = 140
  const grow = (k) => Math.max(MIN[k], BASE[k] + dh)
  return {
    w: s.w,
    h: s.h,
    dh: dh,
    fallback: s.fallback,
    body: grow('body'),
    readCut: grow('readCut'),
    setView: grow('setView'),
    list: grow('list'),
    homeRow: grow('homeRow'),
    empty: grow('empty'),
    header: CHROME.header,
    footer: CHROME.footer,
    // 点按翻页的分界：不能写死 468（936/2），换机型就错位
    centerX: Math.round(s.w / 2),
    // 首页右侧两张小卡：高 = (行高 - 间隙) / 2
    cardSm: Math.max(50, Math.floor((grow('homeRow') - 10) / 2))
  }
}

// 纵向是否放得下：.bd 之外还有顶栏和底栏
export function fits(g) {
  return g.body + CHROME.header + CHROME.footer <= g.h
}
