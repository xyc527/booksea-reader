// Legado（「阅读」）JSON 书源兼容层 —— 可执行子集
//
// 支持的写法：
//   URL 模板： {{key}} {{page}} {{baseUrl}} {{$.x}} {{(page-1)*10}} ,{method/body/headers}
//   选择器：  class.x / tag.a.0 / #id / .odd.1 / tag.span[0:1] / tr!0 / [attr=v]
//   取值：    @text @textNodes @html @href @src @content  以及任意属性名
//   JSON：    $.a.b  $..key  [0]  [*]  data[0].content
//   后处理：  ##正则            （删除匹配）
//             ##正则##替换      （$1 可用）
//   组合：    A&&B（拼接）  A||B（备用，取第一个非空）
//   变量：    @put:{k:path} 写入；@get:{k} 读取（跨步骤传参）
//
// 明确不支持（会被判为不兼容，并给出原因）：
//   @js: / <js> / java.xxx 任意函数 / webView / @XPath / 复杂 JS 表达式

import { selectChain, selectNodes } from './css.js'
import { jsonPath, looksJsonPath } from './jsonpath.js'

const SIMPLE_IDS = { key: 1, page: 1, baseUrl: 1, origin: 1, searchKey: 1, searchPage: 1 }

// ---------- 表达式 ----------

// 极小算术求值：数字、page、+ - * / ( )
function arith(expr, ctx) {
  const s = String(expr).replace(/\bpage\b/g, String(ctx.page || 1)).replace(/\s+/g, '')
  if (!/^[\d+\-*/().]+$/.test(s)) return null
  let i = 0
  function num() {
    let st = i
    while (i < s.length && /[\d.]/.test(s.charAt(i))) i++
    return st === i ? NaN : parseFloat(s.slice(st, i))
  }
  function factor() {
    if (s.charAt(i) === '(') { i++; const v = expr2(); if (s.charAt(i) === ')') i++; return v }
    if (s.charAt(i) === '-') { i++; return -factor() }
    return num()
  }
  function term() {
    let v = factor()
    while (i < s.length && (s.charAt(i) === '*' || s.charAt(i) === '/')) {
      const op = s.charAt(i++)
      const r = factor()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function expr2() {
    let v = term()
    while (i < s.length && (s.charAt(i) === '+' || s.charAt(i) === '-')) {
      const op = s.charAt(i++)
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const v = expr2()
  if (i !== s.length || isNaN(v)) return null
  return v
}

function varGet(ctx, name, path) {
  if (path) {
    const v = jsonPath(ctx.item, path)
    if (v.length) return v[0]
  }
  if (ctx.vars && ctx.vars[name] !== undefined) return ctx.vars[name]
  return ''
}

export function expand(str, ctx) {
  const s = String(str == null ? '' : str)
  const c = ctx || {}
  return s.replace(/\{\{([\s\S]*?)\}\}/g, function (m, raw) {
    const e = String(raw).trim()
    if (!e) return ''
    if (SIMPLE_IDS[e]) {
      if (e === 'key' || e === 'searchKey') {
        const v = c.key == null ? '' : String(c.key)
        return c.enc === 'url' ? encodeURIComponent(v) : v
      }
      if (e === 'page' || e === 'searchPage') return String(c.page || 1)
      if (e === 'baseUrl' || e === 'origin') return c.baseUrl || ''
      return ''
    }
    const jg = e.match(/^java\.(?:getString|get)\(\s*['"]([^'"]+)['"]\s*\)$/)
    if (jg) {
      const arg = jg[1]
      if (/^\$/.test(arg)) return String(varGet(c, '', arg) || '')
      return String(varGet(c, arg, '') || '')
    }
    if (looksJsonPath(e)) {
      const v = jsonPath(c.item, e)
      return v.length ? String(v[0] == null ? '' : v[0]) : ''
    }
    const n = arith(e, c)
    if (n != null) return String(n)
    return '' // 未知表达式：留空，由 classify 提前拦下
  })
}

// ---------- 后处理 ----------

export function postProcess(text, spec) {
  let s = String(text == null ? '' : text)
  if (!spec) return s
  const seg = String(spec).split('##')
  if (seg.length < 2) return s
  let i = 1
  while (i < seg.length) {
    const re = seg[i]
    const rep = i + 1 < seg.length ? seg[i + 1] : ''
    if (re) {
      try {
        s = s.replace(new RegExp(re, 'g'), rep)
      } catch (e) {
        // 正则写坏了就跳过，不影响其它字段
      }
    }
    i += 2
  }
  return s
}

function splitPost(rule) {
  const s = String(rule)
  const k = s.indexOf('##')
  if (k < 0) return { body: s, post: '' }
  return { body: s.slice(0, k), post: s.slice(k) }
}

// @put:{id:id,name:name}  取出并写入变量
function takePut(rule, ctx) {
  let s = String(rule)
  const out = []
  s = s.replace(/@put:\{([^}]*)\}/g, function (m, body) {
    body.split(',').forEach(function (pair) {
      const i = pair.indexOf(':')
      if (i < 0) return
      const k = pair.slice(0, i).trim()
      const p = pair.slice(i + 1).trim()
      out.push([k, p])
    })
    return ''
  })
  if (ctx && ctx.vars) {
    for (let i = 0; i < out.length; i++) {
      const v = jsonPath(ctx.item, out[i][1])
      if (v.length) ctx.vars[out[i][0]] = v[0]
    }
  }
  return s
}

// ---------- 单条规则求值 ----------

function evalOne(rule, data, ctx) {
  const { body, post } = splitPost(rule)
  let expr = body
  // 规则里嵌的内联 JS 片段（"封面地址<js>...</js>"）：
  // 能拿到 JS 之前那截静态部分就用它，拿不到就当这条规则为空。
  // 直接丢掉整条会让「次要字段带点 JS」的源被判死——这是上一轮的误杀来源。
  if (/<js>[\s\S]*<\/js>/.test(expr)) {
    const pre = expr.replace(/<js>[\s\S]*?<\/js>/g, '')
    expr = pre.trim() ? pre : ''
    if (!expr) return ''
  }
  if (/^@js:/.test(expr.trim())) return ''
  // @css: 前缀是 Legado 的显式声明，选择器本体还是我支持的那套语法，剥掉即可
  expr = expr.replace(/^@css:\s*/, '')
  expr = takePut(expr, ctx)
  expr = expr.replace(/@get:\{([^}]*)\}/g, function (m, k) {
    const v = ctx && ctx.vars ? ctx.vars[k] : ''
    return v == null ? '' : String(v)
  })
  if (!expr.trim()) return ''
  let val = ''
  if (expr.indexOf('{{') >= 0 && !looksJsonPath(expr) && !/^(class\.|tag\.|id\.|#|\.|\[)/.test(expr.trim())) {
    val = expand(expr, ctx)
  } else if (looksJsonPath(expr.trim())) {
    const p = expr.trim()
    if (ctx && ctx.list && p === '$') {
      val = ctx.item
    } else {
      const v = jsonPath(ctx && ctx.item !== undefined ? ctx.item : data, p)
      if (v.length === 1) val = v[0]
      else if (v.length > 1) val = v
      else val = ''
    }
  } else {
    // 逐条规则（ruleSearch.name 之类）必须从「这一行」开始找。
    // 之前这里永远从整页根节点找，导致 50 条结果全被第一行覆盖（书名/作者全一样），
    // bookUrl 也变成整页第一个 <a> 的 href（常常是空的）。
    let root = data
    const it = ctx && ctx.item
    if (it && typeof it === 'object' && !Array.isArray(it) && it.tag) root = it
    val = selectChain(root, expr.trim())
  }
  if (val == null) val = ''
  if (typeof val !== 'string') return val
  return postProcess(val, post)
}

// 带 && / || 的完整求值
export function evalRule(rule, data, ctx) {
  if (rule == null || rule === '') return ''
  const c = ctx || {}
  const ands = String(rule).split('&&')
  const outs = []
  for (let i = 0; i < ands.length; i++) {
    const ors = ands[i].split('||')
    let got = ''
    for (let j = 0; j < ors.length; j++) {
      const v = evalOne(ors[j], data, c)
      if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) { got = v; break }
    }
    if (got !== '' && got != null) outs.push(got)
  }
  if (!outs.length) return ''
  if (outs.length === 1) return outs[0]
  // && 拼接：文本类用换行，URL 类直接连
  const isUrl = outs.every(function (x) { return typeof x === 'string' && /^(https?:)?\//.test(x) })
  return outs.join(isUrl ? '' : '\n')
}

// 列表类规则：返回节点数组或 JSON 数组
export function evalList(rule, data, ctx) {
  if (!rule) return []
  const c = ctx || {}
  const parts = String(rule).split('||')
  for (let j = 0; j < parts.length; j++) {
    let body = splitPost(parts[j]).body.trim()
    if (!body) continue
    if (/^@js:|^<js>/.test(body)) continue
    body = body.replace(/<js>[\s\S]*?<\/js>/g, '').replace(/^@css:\s*/, '').trim()
    if (!body) continue
    if (looksJsonPath(body)) {
      const v = jsonPath(c.item !== undefined && c.item !== null ? c.item : data, body)
      if (v.length === 1 && Array.isArray(v[0])) return v[0]
      if (v.length) return v
    } else {
      const nodes = selectNodes(data, body)
      if (nodes.length) return nodes
    }
  }
  return []
}

// ---------- 请求构造 ----------

// 把规则里取到的地址补成绝对地址。
// 之前只处理「/ 开头」这一种，于是 `//b.faloo.com/xxx`（协议相对）会被拼成
// `https://b.faloo.com//b.faloo.com/xxx` —— 飞卢的目录就 404 在这上面。
export function absUrl(base, u) {
  const s = String(u == null ? '' : u).trim()
  if (!s) return s
  const b = String(base || '').replace(/\/+$/, '')
  const om = b.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  const proto = om ? om[1] : 'http'
  const origin = (b.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i) || [b])[0]
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (s.indexOf('//') === 0) return proto + ':' + s
  if (s.charAt(0) === '/') return origin + s
  if (/^\?/.test(s)) return b + s
  // 裸域名：b.faloo.com/1345832.html
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#)/i.test(s)) return proto + '://' + s
  return b + '/' + s
}

// URL 规则可能是： 模板 / 模板,{json} / 模板,{...多行...}
export function buildRequest(rule, ctx) {
  const raw = String(rule == null ? '' : rule)
  const k = raw.indexOf(',{')
  let urlPart = raw
  let opt = null
  if (k >= 0) {
    urlPart = raw.slice(0, k)
    const tail = raw.slice(k + 1)
    try {
      opt = JSON.parse(tail.replace(/'/g, '"'))
    } catch (e) {
      // 单引号/松散 JSON：退化为按行提取
      opt = {}
      const mm = tail.match(/method['"]?\s*:\s*['"]([^'"]+)/i)
      if (mm) opt.method = mm[1]
      const bm = tail.match(/body['"]?\s*:\s*['"]([\s\S]*?)['"]\s*\}\s*$/)
      if (bm) opt.body = bm[1]
    }
  }
  let url = expand(urlPart, Object.assign({}, ctx, { enc: 'url' })).trim()
  url = absUrl(ctx.baseUrl, url)
  const out = { url: url, method: String((opt && opt.method) || 'GET').toUpperCase(), body: '', headers: {}, charset: '' }
  if (opt && opt.body != null) {
    out.body = typeof opt.body === 'string' ? expand(opt.body, ctx) : JSON.stringify(opt.body)
    if (out.method === 'GET') out.method = 'POST'
  }
  if (opt && opt.headers) out.headers = opt.headers
  if (opt && opt.charset) out.charset = String(opt.charset).toLowerCase()
  return out
}

// ---------- 能力判定 ----------

// 判断一条源能不能用：只认「关键链路上会不会碰到 JS/XPath」
//
// 之前的写法是整份 JSON 正则扫一遍，只要出现 @js/<js> 就判死。
// 结果是大量源被误杀：它们的书名/目录/正文都是纯选择器，
// 只有封面地址或字数统计里塞了一小段 JS——那种字段缺了完全不影响阅读。
// 现在按字段分级：关键字段有 JS 才判不可用，次要字段只记备注。
const JS_RE = /@js:|<js>/
const CRITICAL_FIELDS = [
  ['搜索地址 searchUrl', function (s) { return s.searchUrl }],
  ['搜索列表 ruleSearch.bookList', function (s) { return (s.ruleSearch || {}).bookList }],
  ['书名 ruleSearch.name', function (s) { return (s.ruleSearch || {}).name }],
  ['书页地址 ruleSearch.bookUrl', function (s) { return (s.ruleSearch || {}).bookUrl }],
  ['目录列表 ruleToc.chapterList', function (s) { return (s.ruleToc || {}).chapterList }],
  ['章节名 ruleToc.chapterName', function (s) { return (s.ruleToc || {}).chapterName }],
  ['章节地址 ruleToc.chapterUrl', function (s) { return (s.ruleToc || {}).chapterUrl }],
  ['正文 ruleContent.content', function (s) { return (s.ruleContent || {}).content }]
]
const MINOR_FIELDS = [
  ['封面 ruleSearch.coverUrl', function (s) { return (s.ruleSearch || {}).coverUrl }],
  ['分类 ruleSearch.kind', function (s) { return (s.ruleSearch || {}).kind }],
  ['字数 ruleSearch.wordCount', function (s) { return (s.ruleSearch || {}).wordCount }],
  ['最新章节 ruleSearch.lastChapter', function (s) { return (s.ruleSearch || {}).lastChapter }],
  ['详情初始化 ruleBookInfo.init', function (s) { return (s.ruleBookInfo || {}).init }],
  ['简介 ruleBookInfo.intro', function (s) { return (s.ruleBookInfo || {}).intro }]
]

export function classify(def) {
  const s = def || {}
  const reasons = []
  const notes = []
  const su = String(s.searchUrl || '')
  const hasSearch = /^(https?:)?\//.test(su.trim())
  if (!hasSearch) reasons.push('没有搜索地址（仅发现源）')
  const rs = s.ruleSearch || {}
  if (hasSearch && !rs.bookList) reasons.push('搜索规则缺少 bookList')

  // 关键字段
  for (let i = 0; i < CRITICAL_FIELDS.length; i++) {
    const label = CRITICAL_FIELDS[i][0]
    const v = CRITICAL_FIELDS[i][1](s)
    if (v != null && JS_RE.test(String(v))) reasons.push(label + ' 用 @js/<js>')
    // XPath 是真跑不了（本项目的选择器只实现了 JSoup 风味的那套），必须判死
    else if (v != null && /@XPath:|^\/\//.test(String(v).trim())) reasons.push(label + ' 用 XPath')
  }
  // 次要字段
  for (let i = 0; i < MINOR_FIELDS.length; i++) {
    const v = MINOR_FIELDS[i][1](s)
    if (v != null && JS_RE.test(String(v))) notes.push(MINOR_FIELDS[i][0] + ' 用 JS，已跳过')
  }

  const text = JSON.stringify(s)
  if (/webView|startBrowser/i.test(text)) {
    // 只有出现在关键字段里才算致命
    for (let i = 0; i < CRITICAL_FIELDS.length; i++) {
      const v = CRITICAL_FIELDS[i][1](s)
      if (v != null && /webView|startBrowser/i.test(String(v))) { reasons.push(CRITICAL_FIELDS[i][0] + ' 依赖 webView'); break }
    }
    notes.push('含 webView 调用（多见于验证码兜底）')
  }
  if (/@XPath/.test(text)) notes.push('含 @XPath 规则')
  const jsf = text.match(/java\.(?!get\(|getString\()([A-Za-z]+)/g)
  if (jsf) {
    const uniq = []
    jsf.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x) })
    notes.push('含 ' + uniq.slice(0, 6).join('/') + ' 等 JS 调用')
  }
  // {{ }} 里出现无法求值的表达式（只扫关键字段，避免次要字段误杀）
  for (let i = 0; i < CRITICAL_FIELDS.length; i++) {
    const v = CRITICAL_FIELDS[i][1](s)
    if (v == null) continue
    let m
    const must = /\{\{([\s\S]*?)\}\}/g
    while ((m = must.exec(String(v)))) {
      const e = String(m[1]).trim().replace(/\\n/g, '')
      if (!e || SIMPLE_IDS[e]) continue
      if (/^\$/.test(e)) continue
      if (/^java\.(getString|get)\(/.test(e)) continue
      if (/^[\d\s+\-*/().page]+$/.test(e)) continue
      reasons.push(CRITICAL_FIELDS[i][0] + ' 模板无法求值：{{' + e.slice(0, 20) + '}}')
      break
    }
  }
  if (/目录分页|nextTocUrl/.test(text) && /\{\{/.test(String((s.ruleToc || {}).nextTocUrl || ''))) notes.push('目录有多页（nextTocUrl 需手动翻）')
  if (s.loginUrl) reasons.push('站点需要登录')
  const grp = String(s.bookSourceGroup || '')
  if (/梯子|代理|科学/.test(grp)) reasons.push('源标注需要代理')
  if (/人机|验证码/.test(grp)) reasons.push('源标注有人机验证')
  if (/搜索暂不可用/.test(grp)) reasons.push('源标注搜索不可用')

  let level = 'ok'
  // 能靠「登录」解决的（loginUrl / 代理 / 人机验证）不算不可用，
  // 归到 partial 并在界面上标「需登录」——用户登录后就能正常搜，
  // 判死会让这类源连试都试不了。
  if (reasons.some(function (r) { return /没有搜索|缺少 bookList|用 @js|用 XPath|依赖 webView|模板无法求值/.test(r) })) level = 'unsupported'
  else if (reasons.length) level = 'partial'
  return { level: level, reasons: reasons, notes: notes }
}

// 把一条 Legado 书源包装成统一适配器
export function makeAdapter(def) {
  // bookSourceUrl 里的 #xxx 是「同名不同配置」的标记，不是 URL 片段：
  // 之前直接把整串当 base，拼出来的地址变成 http://a.com#温暖满怀/xxx（永远 404）
  const base = String(def.bookSourceUrl || '')
    .split('#')[0]
    .replace(/\/+$/, '')
  const headers = def.header || ''
  return {
    kind: 'legado',
    raw: def,
    id: 'lg_' + hash(def.bookSourceUrl + '|' + def.bookSourceName),
    name: def.bookSourceName || base,
    baseUrl: base,
    headers: headers,
    request: function (rule, ctx) {
      const c = Object.assign({ baseUrl: base }, ctx || {})
      return buildRequest(rule, c)
    },
    parseSearch: function (data, ctx) {
      const c = Object.assign({ baseUrl: base }, ctx || {})
      const rs = def.ruleSearch || {}
      const list = evalList(rs.bookList, data, c)
      const out = []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const ic = Object.assign({}, c, { item: item })
        const url = String(evalRule(rs.bookUrl, data, ic) || '')
        const name = String(evalRule(rs.name, data, ic) || '')
        if (!name && !url) continue
        out.push({
          title: tidy(name),
          author: tidy(String(evalRule(rs.author, data, ic) || '')).replace(/^作者[:：]\s*/, ''),
          url: url,
          cover: String(evalRule(rs.coverUrl, data, ic) || ''),
          intro: tidy(String(evalRule(rs.intro, data, ic) || '')),
          kind: tidy(String(evalRule(rs.kind, data, ic) || '')),
          lastChapter: tidy(String(evalRule(rs.lastChapter, data, ic) || '')),
          wordCount: tidy(String(evalRule(rs.wordCount, data, ic) || '')),
          vars: Object.assign({}, c.vars)
        })
      }
      return out
    },
    parseDetail: function (data, book) {
      const c = Object.assign({ baseUrl: base, item: data, vars: (book && book.vars) || {} }, {})
      const rb = def.ruleBookInfo || {}
      const out = {}
      const fields = ['name', 'author', 'intro', 'kind', 'coverUrl', 'lastChapter', 'wordCount', 'tocUrl']
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        if (!rb[f]) continue
        const v = evalRule(rb[f], data, c)
        if (v !== '' && v != null) out[f] = tidy(String(v))
      }
      out.vars = c.vars
      return out
    },
    parseToc: function (data, book) {
      const c = Object.assign({ baseUrl: base, vars: (book && book.vars) || {} }, {})
      const rt = def.ruleToc || {}
      const list = evalList(rt.chapterList, data, c)
      const out = []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const ic = Object.assign({}, c, { item: item })
        const title = tidy(String(evalRule(rt.chapterName, data, ic) || ''))
        const url = String(evalRule(rt.chapterUrl, data, ic) || '')
        if (!title && !url) continue
        out.push({ title: title, url: url })
      }
      return out
    },
    parseChapter: function (data, book) {
      const c = Object.assign({ baseUrl: base, vars: (book && book.vars) || {} }, {})
      const rc = def.ruleContent || {}
      let text = evalRule(rc.content, data, c)
      if (Array.isArray(text)) text = text.join('\n')
      return String(text == null ? '' : text)
    }
  }
}

function tidy(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function hash(s) {
  let h = 5381
  const t = String(s == null ? '' : s)
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// 给 UI/报告用的一句话说明
export function describe(def) {
  const c = classify(def)
  const map = { ok: '兼容', partial: '部分可用', unsupported: '不兼容' }
  return { level: c.level, text: map[c.level] || c.level, reasons: c.reasons }
}

// 解析导入的 JSON：支持 Legado 数组、{bookSources:[...]}、单个对象
export function normalizeImport(json) {
  let d = json
  if (typeof d === 'string') {
    const s = String(d).trim().replace(/^\uFEFF/, '')
    d = JSON.parse(s)
  }
  if (d && !Array.isArray(d) && Array.isArray(d.bookSources)) d = d.bookSources
  if (d && !Array.isArray(d) && Array.isArray(d.data)) d = d.data
  const list = Array.isArray(d) ? d : [d]
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    if (!s || typeof s !== 'object') continue
    if (!s.bookSourceUrl) continue
    out.push(s)
  }
  return out
}
