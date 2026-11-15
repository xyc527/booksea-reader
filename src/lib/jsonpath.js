// JSONPath 子集：$.a.b / $..key / [0] / [*] / data[0].content
// 只做取值，不实现过滤器表达式。返回数组（可能为空）。

function tokenize(path) {
  let s = String(path == null ? '' : path).trim()
  if (s.indexOf('$.') === 0) s = s.slice(2)
  else if (s === '$') s = ''
  else if (s.charAt(0) === '$') s = s.slice(1)
  if (s.charAt(0) === '.') s = s.slice(1)
  const toks = []
  let i = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (c === '.') {
      if (s.charAt(i + 1) === '.') { toks.push({ t: 'deep' }); i += 2 } else { i += 1 }
      continue
    }
    if (c === '[') {
      const end = s.indexOf(']', i)
      if (end < 0) break
      const body = s.slice(i + 1, end).trim()
      if (body === '*') toks.push({ t: 'wild' })
      else if (/^-?\d+$/.test(body)) toks.push({ t: 'idx', i: parseInt(body, 10) })
      else if (/^['"].*['"]$/.test(body)) toks.push({ t: 'key', k: body.slice(1, -1) })
      i = end + 1
      continue
    }
    // 读到下一个 . 或 [
    let j = i
    while (j < s.length && s.charAt(j) !== '.' && s.charAt(j) !== '[') j++
    const key = s.slice(i, j)
    if (key) toks.push({ t: 'key', k: key })
    i = j
  }
  return toks
}

function collectDeep(v, key, out) {
  if (v == null) return
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) collectDeep(v[i], key, out)
    return
  }
  if (typeof v !== 'object') return
  for (const k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue
    if (k === key) out.push(v[k])
    collectDeep(v[k], key, out)
  }
}

// 返回值数组；标量字段由调用方取 [0]
export function jsonPath(data, path) {
  const toks = tokenize(path)
  let cur = [data]
  for (let n = 0; n < toks.length; n++) {
    const tk = toks[n]
    const next = []
    for (let i = 0; i < cur.length; i++) {
      const v = cur[i]
      if (tk.t === 'key') {
        if (v && typeof v === 'object' && !Array.isArray(v) && v[tk.k] !== undefined) next.push(v[tk.k])
        else if (Array.isArray(v)) {
          for (let a = 0; a < v.length; a++) {
            const it = v[a]
            if (it && typeof it === 'object' && !Array.isArray(it) && it[tk.k] !== undefined) next.push(it[tk.k])
          }
        }
      } else if (tk.t === 'idx') {
        if (Array.isArray(v)) {
          const idx = tk.i < 0 ? v.length + tk.i : tk.i
          if (idx >= 0 && idx < v.length) next.push(v[idx])
        }
      } else if (tk.t === 'wild') {
        if (Array.isArray(v)) for (let a = 0; a < v.length; a++) next.push(v[a])
      } else if (tk.t === 'deep') {
        const key = toks[n + 1] && toks[n + 1].t === 'key' ? toks[n + 1].k : null
        if (key) {
          collectDeep(v, key, next)
          n += 1
        }
      }
    }
    cur = next
  }
  return cur
}

export function looksJsonPath(s) {
  const t = String(s == null ? '' : s).trim()
  if (!t) return false
  // 带 @ 的一定是 HTML 选择器链（a.0@href / tag.td.0@text）。
  // 之前这里只按「标识符 + 点」判断，把 a.0@href 当成 JSONPath，
  // 结果所有「取第一列链接」的源都解析成空地址——笔趣阁系源几乎全军覆没就是这个原因。
  if (t.indexOf('@') >= 0) return false
  if (/^\$/.test(t)) return true
  if (/^data(\[|\.)/.test(t)) return true
  return false
}
