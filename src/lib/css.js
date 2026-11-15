// 轻量 HTML 树 + CSS 选择器（Legado/JSoup 风味子集）
// 只依赖字符串，可在 Node 与 QuickJS 里跑；不引入第三方解析库。

const VOID = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
}
const RAW = { script: 1, style: 1, textarea: 1, title: 1 }
// 省略闭合标签时的隐式关闭（HTML5 树构建的子集，表格/列表是重灾区）
const IMPLICIT = {
  tr: { td: 1, th: 1, tr: 1 },
  td: { td: 1, th: 1 },
  th: { td: 1, th: 1 },
  li: { li: 1 },
  p: { p: 1 },
  option: { option: 1 },
  dt: { dt: 1, dd: 1 },
  dd: { dt: 1, dd: 1 },
  thead: { td: 1, th: 1, tr: 1, thead: 1, tbody: 1, tfoot: 1 },
  tbody: { td: 1, th: 1, tr: 1, thead: 1, tbody: 1, tfoot: 1 },
  tfoot: { td: 1, th: 1, tr: 1, thead: 1, tbody: 1, tfoot: 1 }
}

function decodeEnt(s) {
  return String(s == null ? '' : s)
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|ensp|emsp|middot|hellip|mdash|ldquo|rdquo|lsquo|rsquo);/g, function (m, k) {
      const t = {
        amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
        ensp: ' ', emsp: ' ', middot: '·', hellip: '…', mdash: '—',
        ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’'
      }
      return t[k] != null ? t[k] : m
    })
    .replace(/&#(\d+);/g, function (m, d) {
      const n = parseInt(d, 10)
      return n > 0 && n < 65536 ? String.fromCharCode(n) : m
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
      const n = parseInt(h, 16)
      return n > 0 && n < 65536 ? String.fromCharCode(n) : m
    })
}

// 解析开始标签里的属性
function parseAttrs(src) {
  const attrs = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let m
  while ((m = re.exec(src))) {
    if (!m[1]) continue
    let v = m[2]
    if (v == null) v = ''
    else if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
      v = v.slice(1, -1)
    }
    attrs[m[1].toLowerCase()] = decodeEnt(v)
  }
  return attrs
}

// 建树：返回根节点 { tag:'#root', kids:[...] }
// 节点形如 { tag, attrs, kids:[节点或文本串], parent }
export function buildTree(html) {
  const root = { tag: '#root', attrs: {}, kids: [], parent: null }
  let cur = root
  const src = String(html == null ? '' : html)
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    if (m.index > last) {
      const text = src.slice(last, m.index)
      if (text) cur.kids.push(decodeEnt(text))
    }
    last = re.lastIndex
    if (!m[2]) continue // 注释 / doctype
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (closing) {
      // 向上找到同名节点再闭合（容错未闭合标签）
      let p = cur
      while (p && p.tag !== tag) p = p.parent
      if (p && p.parent) cur = p.parent
      continue
    }
    // 隐式关闭：<tr> 直接结束上一个 <tr>，<td> 结束上一个 <td> ……
    const ic = IMPLICIT[tag]
    if (ic) {
      let p = cur
      while (p && p.tag && ic[p.tag]) p = p.parent
      cur = p || root
    }
    // JSoup（阅读的解析器）会为 <table><tr> 补出隐式 <tbody>，这里照做，
    // 否则 `#author@tbody@tr` 这类规则会全空
    if (tag === 'tr' && cur.tag === 'table') {
      const tb = { tag: 'tbody', attrs: {}, kids: [], parent: cur }
      cur.kids.push(tb)
      cur = tb
    }
    const node = { tag: tag, attrs: parseAttrs(m[3] || ''), kids: [], parent: cur }
    cur.kids.push(node)
    if (RAW[tag]) {
      // 原样吞到闭合标签
      const end = src.toLowerCase().indexOf('</' + tag, re.lastIndex)
      const stop = end < 0 ? src.length : end
      const body = src.slice(re.lastIndex, stop)
      if (body) node.kids.push(tag === 'textarea' || tag === 'title' ? decodeEnt(body) : body)
      const gt = src.indexOf('>', stop)
      re.lastIndex = gt < 0 ? src.length : gt + 1
      last = re.lastIndex
      continue
    }
    if (!VOID[tag]) cur = node
  }
  if (last < src.length) {
    const text = src.slice(last)
    if (text) cur.kids.push(decodeEnt(text))
  }
  return root
}

export function nodeText(n) {
  if (typeof n === 'string') return n
  let out = ''
  for (let i = 0; i < n.kids.length; i++) out += nodeText(n.kids[i])
  return out
}

// textNodes：只取直接文本子节点（Legado 的正文规则常用它，避免把 <br> 之类折进去）
export function nodeTextNodes(n) {
  if (typeof n === 'string') return n
  let out = ''
  for (let i = 0; i < n.kids.length; i++) {
    const k = n.kids[i]
    if (typeof k === 'string') out += k
  }
  return out
}

export function nodeHtml(n) {
  if (typeof n === 'string') return n
  let out = ''
  for (let i = 0; i < n.kids.length; i++) {
    const k = n.kids[i]
    if (typeof k === 'string') out += k
    else out += '<' + k.tag + attrStr(k.attrs) + '>' + nodeHtml(k) + '</' + k.tag + '>'
  }
  return out
}

function attrStr(a) {
  let s = ''
  for (const k in a) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) continue
    s += ' ' + k + '="' + String(a[k]).replace(/"/g, '&quot;') + '"'
  }
  return s
}

function walk(n, out) {
  const kids = n.kids || []
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (typeof k === 'string') continue
    out.push(k)
    walk(k, out)
  }
  return out
}

export function descendants(n) {
  return walk(n, [])
}

// ---------- 选择器 ----------

// 支持：tag / .cls / #id / tag.cls / [attr=v] / [attr*=v] / [attr^=v] / [attr$=v]
// 组合：空格（后代）与 >（子元素）
function parseSimple(sel) {
  const s = String(sel || '').trim()
  const out = { tag: '', classes: [], id: '', attrs: [] }
  let rest = s
  // 属性
  rest = rest.replace(/\[([^\]]+)\]/g, function (m, body) {
    const mm = body.match(/^([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:([*^$|~]?=)\s*(.*))?$/)
    if (mm) out.attrs.push({ k: mm[1].toLowerCase(), op: mm[2] || '', v: (mm[3] || '').replace(/^["']|["']$/g, '') })
    return ''
  })
  const idm = rest.match(/#([-a-zA-Z0-9_:.]+)/)
  if (idm) { out.id = idm[1]; rest = rest.replace(idm[0], '') }
  rest = rest.replace(/\.([-a-zA-Z0-9_:]+)/g, function (m, c) {
    out.classes.push(c)
    return ''
  })
  const tag = rest.trim()
  if (tag) out.tag = tag.toLowerCase()
  return out
}

function matchSimple(node, sel) {
  if (!node || !node.tag || node.tag === '#root') return false
  if (sel.tag && sel.tag !== '*' && node.tag !== sel.tag) return false
  if (sel.id && node.attrs.id !== sel.id) return false
  if (sel.classes.length) {
    const cls = String(node.attrs['class'] || '').split(/\s+/)
    for (let i = 0; i < sel.classes.length; i++) {
      if (cls.indexOf(sel.classes[i]) < 0) return false
    }
  }
  for (let i = 0; i < sel.attrs.length; i++) {
    const a = sel.attrs[i]
    const v = node.attrs[a.k]
    if (v == null) return false
    if (!a.op) continue
    if (a.op === '=' && v !== a.v) return false
    if (a.op === '*=' && v.indexOf(a.v) < 0) return false
    if (a.op === '^=' && v.indexOf(a.v) !== 0) return false
    if (a.op === '$=' && v.slice(-a.v.length) !== a.v) return false
    if (a.op === '~=' && String(v).split(/\s+/).indexOf(a.v) < 0) return false
    if (a.op === '|=' && v !== a.v && v.indexOf(a.v + '-') !== 0) return false
  }
  return true
}

// 单步选择：在给定的节点集合里找子孙
function selectStep(nodes, selStr, combinator) {
  const groups = String(selStr).split(/\s*>\s*/)
  let cur = nodes
  for (let g = 0; g < groups.length; g++) {
    const parts = groups[g].trim().split(/\s+/)
    for (let p = 0; p < parts.length; p++) {
      const sel = parseSimple(parts[p])
      const next = []
      for (let i = 0; i < cur.length; i++) {
        const cand = p === 0 && g === 0 && combinator === 'child' ? (cur[i].kids || []).filter(function (x) { return typeof x !== 'string' }) : descendants(cur[i])
        for (let j = 0; j < cand.length; j++) {
          if (matchSimple(cand[j], sel)) next.push(cand[j])
        }
      }
      cur = next
    }
  }
  return cur
}

// 解析一步：class.item.0 / tag.a.-1 / .odd.1 / #x / tr!0 / tag.span[0:1]
export function parseStep(raw) {
  let s = String(raw == null ? '' : raw).trim()
  const out = { sel: s, idx: null, slice: null, exclude: null }
  const ms = s.match(/\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]\s*$/)
  if (ms) {
    out.slice = [ms[1] === '' ? 0 : parseInt(ms[1], 10), ms[2] === '' ? 0 : parseInt(ms[2], 10)]
    s = s.slice(0, ms.index)
  }
  // Legado 的排除语法：!0 或 !0:1:2:3（多个用冒号/逗号分隔）。
  // 之前只认单个 !0，遇到 class.listmain@dd!0:1:2 就把整串当类名，目录直接 0 章。
  const me = s.match(/!(-?[\d:,\-]+)\s*$/)
  if (me) {
    out.excludes = String(me[1])
      .split(/[:,]/)
      .map(function (x) { return parseInt(x, 10) })
      .filter(function (n) { return !isNaN(n) })
    out.exclude = out.excludes.length ? out.excludes[0] : null
    s = s.slice(0, me.index)
  }
  const mi = s.match(/\.(-?\d+)\s*$/)
  if (mi) { out.idx = parseInt(mi[1], 10); s = s.slice(0, mi.index) }
  if (s.indexOf('class.') === 0) s = '.' + s.slice(6)
  else if (s.indexOf('tag.') === 0) s = s.slice(4)
  else if (s.indexOf('id.') === 0) s = '#' + s.slice(3)
  out.sel = s.trim()
  if (!out.sel) out.sel = '*'
  return out
}

function applyIndex(list, step) {
  let out = list
  const ex = step.excludes && step.excludes.length ? step.excludes : step.exclude != null ? [step.exclude] : []
  if (ex.length) {
    const drop = {}
    for (let k = 0; k < ex.length; k++) {
      drop[ex[k] < 0 ? out.length + ex[k] : ex[k]] = 1
    }
    out = out.filter(function (_, n) { return !drop[n] })
  }
  if (step.slice) {
    const a = step.slice[0] < 0 ? Math.max(0, out.length + step.slice[0]) : step.slice[0]
    const b = step.slice[1] <= 0 ? out.length : step.slice[1]
    out = out.slice(a, b)
  }
  if (step.idx != null) {
    const i = step.idx < 0 ? out.length + step.idx : step.idx
    out = i >= 0 && i < out.length ? [out[i]] : []
  }
  return out
}

const PROPS = { text: 1, textNodes: 1, ownText: 1, html: 1, all: 1, href: 1, src: 1, content: 1, value: 1, title: 1, alt: 1, data: 1 }

// 取属性值
export function propOf(node, prop) {
  if (typeof node === 'string') return prop === 'text' || prop === 'textNodes' || prop === 'html' ? node : ''
  if (prop === 'text') return nodeText(node)
  if (prop === 'textNodes' || prop === 'all') return nodeTextNodes(node)
  if (prop === 'html') return nodeHtml(node)
  const v = node.attrs[prop]
  return v == null ? '' : v
}

// 整条链：a@b@c  （最后一段可以是属性名）
// ctx: { root: 节点数组, join: '\n' }
export function selectChain(htmlOrNodes, chain) {
  const parts = String(chain == null ? '' : chain).split('@')
  let nodes = Array.isArray(htmlOrNodes)
    ? htmlOrNodes
    : htmlOrNodes && htmlOrNodes.tag
      ? [htmlOrNodes]
      : [buildTree(htmlOrNodes)]
  let prop = ''
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    const step = parseStep(raw)
    const isLast = i === parts.length - 1
    const bare = String(raw).trim()
    if (isLast && PROPS[bare]) { prop = bare; break }
    const before = nodes
    nodes = selectStep(nodes, step.sel, i === 0 ? 'desc' : 'desc')
    nodes = applyIndex(nodes, step)
    // 某一步落空后不再继续找（避免误命中）
    if (!nodes.length) {
      // `||` 备用链由上层处理，这里直接返回空
      return ''
    }
    if (before.length && !nodes.length) return ''
  }
  if (!prop) prop = 'text'
  const out = []
  for (let i = 0; i < nodes.length; i++) {
    const v = propOf(nodes[i], prop)
    if (v !== '' && v != null) out.push(v)
  }
  return out.join('\n')
}

// 取节点集合（给需要自己遍历的调用方）
export function selectNodes(htmlOrNodes, chain) {
  const parts = String(chain == null ? '' : chain).split('@')
  let nodes = Array.isArray(htmlOrNodes)
    ? htmlOrNodes
    : htmlOrNodes && htmlOrNodes.tag
      ? [htmlOrNodes]
      : [buildTree(htmlOrNodes)]
  for (let i = 0; i < parts.length; i++) {
    if (PROPS[String(parts[i]).trim()]) break
    const step = parseStep(parts[i])
    nodes = applyIndex(selectStep(nodes, step.sel, 'desc'), step)
  }
  return nodes
}
