// 纯函数：格式化与导航换算

export const TOC_PAGE_SIZE = 100 // 书海阁目录：每页 100 章
export const TOC_ROWS = 8 // 目录屏每屏 8 行
export const SHELF_ROWS = 5 // 书架每屏 5 本（多了底部按钮会被裁）
export const RESULT_ROWS = 3 // 搜索结果每屏 3 条

export function clamp(v, lo, hi) {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

export function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

export function kb(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

// 章节下标（0 基）→ 目录页号（1 基）
export function tocPageOf(index, per) {
  const n = per || TOC_PAGE_SIZE
  return Math.floor(Math.max(0, index) / n) + 1
}

// 目录页号 + 页内位置（0 基）→ 章节下标
export function indexOfToc(pageNo, pos, per) {
  const n = per || TOC_PAGE_SIZE
  return (Math.max(1, pageNo) - 1) * n + Math.max(0, pos)
}

// 目录屏窗口：[from, to)
export function windowOf(cursor, total, rows) {
  const n = rows || TOC_ROWS
  const from = clamp(cursor, 0, Math.max(0, total - 1))
  const to = Math.min(total, from + n)
  return { from: from, to: to }
}

// 翻页后的新光标（保持"一屏 8 行"的节奏）
export function moveCursor(cursor, delta, total, rows) {
  const n = rows || TOC_ROWS
  const next = cursor + delta * n
  return clamp(next, 0, Math.max(0, total - 1))
}

// 阅读页脚状态文案
export function readStatus(chapterIndex, chapterCount, pageIndex, pageCount) {
  return (
    (chapterIndex + 1) +
    '/' + chapterCount +
    ' · ' + (pageIndex + 1) + '/' + pageCount
  )
}
