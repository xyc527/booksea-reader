// 搜索历史（纯函数，Node 里可断言）
//
// 为什么单独抽出来：历史的边界条件比看起来多——大小写重复、全角空格、
// 重复搜同一本书要置顶而不是新增、超过上限要丢最旧的。这些在页面里
// 只能靠手点验证，写成纯函数就能一次断言完。

export const HIST_MAX = 12

// 比较用的归一化：折叠连续空白 + 转小写 + 去首尾。
// 中文关键词大小写不敏感是好事（「Abc」和「abc」算同一条）；
// 不折叠空白的话，键盘多敲一个空格就会变成两条历史。
export function normKw(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// 显示用：只折叠空白，保留用户原来的大小写
export function cleanKw(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
}

// 记一条历史：置顶 → 去重 → 截断到 max。
// 返回新数组（页面直接整体替换，避免 Vue 观察不到数组原地修改）。
export function pushHist(list, kw, max) {
  const cap = max || HIST_MAX
  const w = cleanKw(kw)
  const src = Array.isArray(list) ? list : []
  if (!w) return src.slice()
  const key = normKw(w)
  const out = [w]
  for (let i = 0; i < src.length; i++) {
    const x = cleanKw(src[i])
    if (!x) continue
    if (normKw(x) === key) continue
    if (out.length >= cap) break
    out.push(x)
  }
  return out.slice(0, cap)
}

// 删一条（暂只在测试与后续「长按删除」用）
export function removeHist(list, kw) {
  const key = normKw(kw)
  const src = Array.isArray(list) ? list : []
  const out = []
  for (let i = 0; i < src.length; i++) {
    const x = cleanKw(src[i])
    if (!x) continue
    if (normKw(x) === key) continue
    out.push(x)
  }
  return out
}

// 读取时清洗：兼容旧数据/手改文件里的脏值（非数组、非字符串、空串、重复、超长）。
// 顺序保持文件里的先后（已经是「最近的在前」）。
export function sanitizeHist(list, max) {
  const cap = max || HIST_MAX
  const src = Array.isArray(list) ? list : []
  const out = []
  const seen = {}
  for (let i = 0; i < src.length; i++) {
    const x = cleanKw(src[i])
    if (!x) continue
    const k = normKw(x)
    if (seen[k]) continue
    seen[k] = 1
    if (out.length >= cap) break
    out.push(x)
  }
  return out
}
