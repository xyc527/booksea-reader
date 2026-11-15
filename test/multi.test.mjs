// 多源 / 去重 / CDN / 调度 的离线测试（不联网，全部走注入的假 fetcher）
// 运行：node test/multi.test.mjs
import { groupResults, rank, sameBook, normTitle, similarity } from '../src/lib/dedupe.js'
import { searchAll, createCache, cacheKey } from '../src/lib/search.js'
import {
  defaultLines,
  buildUrl,
  validatePayload,
  fetchWithFailover,
  testLine,
  sortByPriority,
  primaryLine,
  fnv1a,
  sha256
} from '../src/lib/cdn.js'
import { classify } from '../src/lib/legado.js'
import { recordFromLegado, mergeRecords, importLegadoJson, statusText, statsOf, adapterOf, makeNative } from '../src/lib/sources.js'
import { absUrl } from '../src/lib/legado.js'

let pass = 0
let fail = 0
const fails = []

function ok(name, cond, extra) {
  if (cond) {
    pass++
  } else {
    fail++
    fails.push(name + (extra ? ' → ' + extra : ''))
  }
}

function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' != ' + JSON.stringify(b))
}

// ---------- 1. 去重 ----------
function item(o) {
  return Object.assign(
    { sourceId: 's1', sourceName: '源A', priority: 10, status: 'ok', title: '', author: '', url: '', bid: '', intro: '', lastChapter: '' },
    o
  )
}

// 三个源各自搜到同一本书 → 合并成一条、三个来源
{
  const items = [
    item({ sourceId: 'a', sourceName: 'A书源', title: '诡秘之主', author: '爱潜水的乌贼', url: 'http://a/1', bid: '1' }),
    item({ sourceId: 'b', sourceName: 'B书源', title: '诡秘之主', author: '爱潜水的乌贼', url: 'http://b/2', bid: '2' }),
    item({ sourceId: 'c', sourceName: 'C书源', title: '诡秘之主', author: '爱潜水的乌贼', url: 'http://c/3', bid: '3' })
  ]
  const g = groupResults(items, { dedupe: true })
  ok('三源同书合并为一条', g.length === 1, '得到 ' + g.length)
  ok('合并后保留 3 个来源', g[0].sources.length === 3, String(g[0].sources.length))
  ok('best 是可用且优先级最高的源', g[0].best.sourceId === 'a', g[0].best.sourceId)
}

// 同名不同作者 → 不合并
{
  const items = [
    item({ sourceId: 'a', title: '长生', author: '甲' }),
    item({ sourceId: 'b', title: '长生', author: '乙' })
  ]
  const g = groupResults(items, { dedupe: true })
  ok('同名不同作者不合并', g.length === 2, String(g.length))
  eq('不确定时保留独立', g.map((x) => x.sources.length), [1, 1])
}

// 同作者不同作品 → 不合并
{
  const items = [
    item({ sourceId: 'a', title: '诡秘之主', author: '乌贼' }),
    item({ sourceId: 'a', title: '宿命之环', author: '乌贼' })
  ]
  const g = groupResults(items, { dedupe: true })
  ok('同作者不同作品不合并', g.length === 2, String(g.length))
}

// 简繁差异 → 合并
{
  const items = [
    item({ sourceId: 'a', title: '鬥破蒼穹', author: '天蠶土豆' }),
    item({ sourceId: 'b', title: '斗破苍穹', author: '天蚕土豆' })
  ]
  const g = groupResults(items, { dedupe: true })
  ok('简繁差异合并', g.length === 1, String(g.length))
  ok('简繁归一后的书名一致', normTitle('鬥破蒼穹') === normTitle('斗破苍穹'))
}

// 空格 / 特殊符号差异 → 合并
{
  const items = [
    item({ sourceId: 'a', title: '遮  天', author: '辰东' }),
    item({ sourceId: 'b', title: '《遮天》', author: '辰东' })
  ]
  const g = groupResults(items, { dedupe: true })
  ok('空格与书名号差异合并', g.length === 1, String(g.length))
}

// 标题略有差异（多一个「最新章节」后缀）→ 合并，但只算低置信
{
  const r = sameBook(
    { title: '完美世界', author: '辰东' },
    { title: '完美世界最新章节', author: '辰东' }
  )
  ok('标题带后缀仍判同书', r.same, JSON.stringify(r))
}

// 完全不相干的书不合并
{
  const r = sameBook({ title: '斗破苍穹', author: '天蚕土豆' }, { title: '凡人修仙传', author: '忘语' })
  ok('不同书不合并', !r.same, JSON.stringify(r))
  ok('相似度低于阈值', similarity('斗破苍穹', '凡人修仙传') < 0.86)
}

// 关闭去重 → 每个来源各一条
{
  const items = [
    item({ sourceId: 'a', title: '诡秘之主', author: '乌贼' }),
    item({ sourceId: 'b', title: '诡秘之主', author: '乌贼' })
  ]
  const g = groupResults(items, { dedupe: false })
  ok('关闭去重后不合并', g.length === 2, String(g.length))
}

// 排序：完全匹配优先，不看响应速度
{
  const groups = groupResults(
    [
      item({ sourceId: 'slow', priority: 1, title: '诡秘之主外传', author: '别人' }),
      item({ sourceId: 'exact', priority: 90, title: '诡秘之主', author: '乌贼' })
    ],
    { dedupe: true }
  )
  const r = rank(groups, '诡秘之主', {})
  ok('完全匹配排在优先源前面', r[0].best.sourceId === 'exact', r[0].best.title)
}

// ---------- 2. 搜索调度 ----------
function makeSrc(id, fn, priority) {
  return { id: id, name: '源' + id, priority: priority || 10, enabled: true, status: 'ok', searchOne: fn }
}

{
  // 一个快、一个慢（超时）、一个报错：快的结果必须出来，不能整体失败
  const cache = createCache(60000)
  const h = searchAll({
    kw: '测试',
    sources: [
      makeSrc('fast', async () => [item({ sourceId: 'fast', title: '测试书', author: '甲' })]),
      makeSrc('slow', () => new Promise((r) => setTimeout(() => r([item({ sourceId: 'slow', title: '晚到的书' })]), 3000))),
      makeSrc('boom', async () => {
        throw new Error('HTTP 503')
      })
    ],
    concurrency: 3,
    timeout: 400,
    retry: 0,
    cache: cache,
    overallTimeout: 3000
  })
  const res = await h.promise
  ok('单源超时不影响其它源', res.items.some((x) => x.title === '测试书'), JSON.stringify(res.items.map((x) => x.title)))
  ok('失败源被统计', res.stats.fail >= 1 && res.stats.errors.length === 2, JSON.stringify(res.stats))
  ok('超时源被统计', res.stats.timeout >= 1, JSON.stringify(res.stats))
}

{
  // 缓存：第二次同样请求不再发网络
  const cache = createCache(60000)
  let calls = 0
  const mk = () => searchAll({
    kw: '缓存',
    sources: [makeSrc('a', async () => { calls++; return [item({ sourceId: 'a', title: '缓存书' })] })],
    cache: cache,
    concurrency: 1,
    timeout: 1000
  })
  await mk().promise
  const r2 = await mk().promise
  ok('第二次命中缓存', calls === 1, '实际请求 ' + calls + ' 次')
  ok('统计里记了缓存命中', r2.stats.cached === 1, JSON.stringify(r2.stats))
  // refresh=true 强制重发
  await searchAll({
    kw: '缓存',
    sources: [makeSrc('a', async () => { calls++; return [] })],
    cache: cache,
    refresh: true,
    concurrency: 1,
    timeout: 1000
  }).promise
  ok('主动刷新会重发请求', calls === 2, '实际请求 ' + calls + ' 次')
}

{
  // 同源同词并发：同一个 Promise，只发一次
  const cache = createCache(60000)
  const key = cacheKey('a', '并发', 1)
  let n = 0
  const p1 = cache.once(key, async () => { n++; await new Promise((r) => setTimeout(r, 100)); return 1 })
  const p2 = cache.once(key, async () => { n++; return 2 })
  const v = await Promise.all([p1, p2])
  ok('进行中的相同请求只发一次', n === 1, '发 ' + n + ' 次')
  ok('两个调用拿到同一结果', v[0] === v[1] && v[0] === 1, JSON.stringify(v))
}

{
  // 增量回调：先回来的源先展示
  const partials = []
  const h = searchAll({
    kw: '增量',
    sources: [
      makeSrc('a', async () => [item({ sourceId: 'a', title: '增量书' })]),
      makeSrc('b', () => new Promise((r) => setTimeout(() => r([]), 250)))
    ],
    concurrency: 2,
    timeout: 2000,
    cache: createCache(1000),
    onPartial: (groups, stats) => partials.push({ n: groups.length, done: stats.done })
  })
  await h.promise
  ok('onPartial 有多次回调', partials.length >= 2, JSON.stringify(partials))
  ok('第一次回调就带出了结果', partials[0].n >= 1, JSON.stringify(partials[0]))
}

// ---------- 3. CDN ----------
{
  const lines = defaultLines()
  ok('默认 5 条线路', lines.length === 5, String(lines.length))
  ok('默认全部启用', lines.every((l) => l.enabled))
  ok('默认首选是优先级最高的', primaryLine(lines).id === 'jsdelivr', primaryLine(lines).id)
  const t = { owner: 'XIU2', repo: 'Yuedu', ref: 'master', path: 'shuyuan/all.json' }
  eq('jsdelivr URL 拼装', buildUrl(lines[0], t), 'https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan/all.json')
  eq('raw URL 拼装', buildUrl(lines[4], t), 'https://raw.githubusercontent.com/XIU2/Yuedu/master/shuyuan/all.json')
}

{
  // 内容校验：HTTP 200 不等于成功
  const html = '<!DOCTYPE html><html><body>blocked</body></html>'
  ok('HTML 页面判失败', !validatePayload(html, { kind: 'legado' }).ok)
  ok('空响应判失败', !validatePayload('', { kind: 'legado' }).ok)
  ok('限流文案判失败', !validatePayload('{"error":"rate limit exceeded"}', { kind: 'legado' }).ok)
  ok('缺 bookSourceUrl 判失败', !validatePayload('[{"a":1}]', { kind: 'legado' }).ok)
  ok('数量不足判失败', !validatePayload('[{"bookSourceUrl":"http://a"}]', { kind: 'legado', minCount: 50 }).ok)
  const good = JSON.stringify([{ bookSourceUrl: 'http://a', bookSourceName: 'A' }])
  const v = validatePayload(good, { kind: 'legado' })
  ok('正常书源判成功', v.ok && v.count === 1, JSON.stringify(v))
}

{
  // 故障切换：首选失败 → 备用成功，且拿到的是同一个文件
  const lines = defaultLines()
  const body = JSON.stringify([{ bookSourceUrl: 'http://x', bookSourceName: 'X' }])
  const calls = []
  const fetchOne = async (url) => {
    calls.push(url)
    if (url.indexOf('jsdelivr') >= 0) return { ok: false, error: 'HTTP 503', ms: 90 }
    if (url.indexOf('statically') >= 0) return { ok: false, error: '超时', ms: 3000 }
    return { ok: true, text: body, ms: 210 }
  }
  const r = await fetchWithFailover(lines, { owner: 'o', repo: 'r', ref: 'v1', path: 'p.json', expect: { kind: 'legado' } }, fetchOne, { timeout: 5000 })
  ok('首选失败后切到可用线路', r.ok && r.line === 'githack', r.line + ' / ' + JSON.stringify(r.tries))
  ok('切换过程中记录了两条失败', r.tries.length === 3 && r.tries[0].ok === false, JSON.stringify(r.tries))
  ok('拿到的是同一个文件内容', r.text === body)
  ok('失败线路状态被写回', lines[0].ok === false && lines[2].ok === true, JSON.stringify(lines.map((l) => l.ok)))
  ok('失败线路不会被永久禁用', lines[0].enabled === true)
}

{
  // 全部失败：返回错误汇总，不抛异常
  const lines = defaultLines()
  const r = await fetchWithFailover(lines, { owner: 'o', repo: 'r', ref: 'v', path: 'p' }, async () => ({ ok: false, error: 'DNS 失败', ms: 10 }), {})
  ok('全线路失败不算成功', !r.ok)
  ok('错误汇总含每条线路', r.errors.length === lines.length, JSON.stringify(r.errors))
}

{
  // testLine 真实记录耗时/状态
  const l = defaultLines()[0]
  const r = await testLine(l, { owner: 'o', repo: 'r', ref: 'v', path: 'p.json', expect: { kind: 'legado' } }, async () => ({
    ok: true,
    text: JSON.stringify([{ bookSourceUrl: 'http://a' }]),
    ms: 123
  }), 1000)
  ok('testLine 记录成功', r.ok === true && r.count === 1, JSON.stringify(r))
  ok('写回了 lastTestAt', l.lastTestAt > 0)
  ok('写回了 sha', String(l.sha).length === 8, l.sha)
}

ok('fnv1a 稳定', fnv1a('abc') === fnv1a('abc') && fnv1a('abc') !== fnv1a('abd'))
ok('sha256 与已知值一致', sha256('abc').indexOf('ba7816bf8f01cfea') === 0, sha256('abc'))

// ---------- 4. Legado 兼容性判定 ----------
{
  const pure = {
    bookSourceName: '纯规则源',
    bookSourceUrl: 'http://a.com',
    searchUrl: 'http://a.com/s?q={{key}}',
    ruleSearch: { bookList: 'class.list@tag.li', name: 'tag.a@text', author: 'class.au@text', bookUrl: 'tag.a@href' },
    ruleToc: { chapterList: 'class.ch@tag.a', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'id.content@html' }
  }
  eq('纯选择器源判可用', classify(pure).level, 'ok')

  const js = JSON.parse(JSON.stringify(pure))
  js.ruleSearch.bookList = '@js:result.split("\\n")'
  ok('@js 源判不兼容', classify(js).level === 'unsupported')
  ok('给出原因是 JS', classify(js).reasons.join(';').indexOf('@js') >= 0, classify(js).reasons.join(';'))

  const webview = JSON.parse(JSON.stringify(pure))
  webview.searchUrl = 'http://a.com/s?q={{key}},{"webView":true}'
  ok('webView 源判不兼容', classify(webview).level === 'unsupported')

  const xpath = JSON.parse(JSON.stringify(pure))
  xpath.ruleSearch.bookList = '@XPath://div[@class="list"]'
  ok('XPath 源判不兼容', classify(xpath).level === 'unsupported')

  const login = JSON.parse(JSON.stringify(pure))
  login.bookSourceComment = '需要登录后使用'
  login.loginUrl = 'http://a.com/login'
  ok('需要登录的源判部分可用', classify(login).level === 'partial', classify(login).level)
}

// ---------- 5. 书源记录与导入合并 ----------
{
  const defA = { bookSourceName: 'A源', bookSourceUrl: 'http://a.com', searchUrl: 'http://a.com/s?q={{key}}', ruleSearch: { bookList: 'class.l', name: 'a@text' } }
  const r1 = recordFromLegado(defA, 51)
  ok('导入即可解析的源默认启用', r1.enabled === true)
  // 不兼容的（关键字段用 @js）不该默认启用：选了也搜不出来
  const defJs = {
    bookSourceName: 'JS源',
    bookSourceUrl: 'http://js.com',
    searchUrl: 'http://js.com/s?q={{key}}',
    ruleSearch: { bookList: 'class.l', name: '@js:result', bookUrl: 'a@href' }
  }
  ok('导入不兼容的源默认停用', recordFromLegado(defJs, 52).enabled === false)
  ok('未测试状态是 untested', r1.status === 'untested', r1.status)
  ok('状态文案可用', statusText('untested') === '待测试', statusText('untested'))

  const old = [Object.assign({}, r1, { enabled: true, status: 'ok', lastMs: 800 })]
  const merged = mergeRecords(old, [recordFromLegado(defA, 51)])
  ok('重新导入保留启用状态', merged.list[0].enabled === true)
  ok('重新导入保留测试结果', merged.list[0].status === 'ok', merged.list[0].status)
  ok('重新导入不重复添加', merged.list.length === 1 && merged.added === 0, JSON.stringify(merged.added))

  const imp = importLegadoJson(JSON.stringify([defA, { bookSourceName: 'B源', bookSourceUrl: 'http://b.com', searchUrl: 'http://b.com/s', ruleSearch: { bookList: 'class.l', name: 'a@text' } }]), [])
  ok('批量导入解析两条', imp.list.length === 2, String(imp.list.length))
  ok('导入统计正确', imp.added === 2)

  const st = statsOf([{ enabled: true, status: 'ok' }, { enabled: false, status: 'bad' }, { enabled: true, status: 'untested' }])
  ok('统计总数/启用数', st.total === 3 && st.enabled === 2, JSON.stringify(st))
}

// ---------- 8. URL 归一化 / 目录两步取 ----------
{
  // 飞卢的 bookUrl 解出来是 //b.faloo.com/xxx，旧代码拼成
  // https://b.faloo.com//b.faloo.com/xxx → 目录 404
  ok('协议相对地址补协议', absUrl('https://b.faloo.com', '//b.faloo.com/1.html') === 'https://b.faloo.com/1.html')
  ok('根相对地址拼源站', absUrl('https://x.com', '/a/b.html') === 'https://x.com/a/b.html')
  ok('裸域名补协议', absUrl('http://m.x.com', 'x.com/1.html') === 'http://x.com/1.html')
  ok('绝对地址不动', absUrl('https://x.com', 'https://y.com/q') === 'https://y.com/q')
  ok('普通相对路径拼目录', absUrl('https://x.com/sub', 'a/b.html') === 'https://x.com/sub/a/b.html')

  // tocUrl 是「从详情页提取链接」的规则时，必须先抓详情页
  const recRule = recordFromLegado(
    {
      bookSourceName: '规则目录源',
      bookSourceUrl: 'http://r.com',
      searchUrl: 'http://r.com/s?q={{key}}',
      ruleSearch: { bookList: 'class.l', name: 'a@text', bookUrl: 'a@href' },
      ruleBookInfo: { tocUrl: 'text.点击阅读@href' },
      ruleToc: { chapterList: 'class.c@li', chapterName: 'a@text', chapterUrl: 'a@href' }
    },
    70
  )
  const adRule = adapterOf(recRule)
  const planRule = adRule.tocPlan({ url: 'http://r.com/b/1.html', vars: null })
  ok('规则式 tocUrl 要求先抓详情页', planRule.detail === true, JSON.stringify(planRule))
  ok('规则式 tocUrl 不会把规则当 URL', planRule.req.url.indexOf('点击阅读') < 0, planRule.req.url)

  // 固定目录地址：直接请求
  const recFix = recordFromLegado(
    {
      bookSourceName: '固定目录源',
      bookSourceUrl: 'http://f.com',
      searchUrl: 'http://f.com/s?q={{key}}',
      ruleSearch: { bookList: 'class.l', name: 'a@text', bookUrl: 'a@href' },
      ruleBookInfo: { tocUrl: '/list/1.html' },
      ruleToc: { chapterList: 'class.c@li', chapterName: 'a@text', chapterUrl: 'a@href' }
    },
    71
  )
  const planFix = adapterOf(recFix).tocPlan({ url: 'http://f.com/b/1.html', vars: null })
  ok('固定目录地址直接请求', planFix.detail !== true && planFix.req.url === 'http://f.com/list/1.html', planFix.req.url)
}

// ---------- 9. 原生源正文返回纯文本 ----------
{
  // 原生解析器返回 {title,paras,chars}，适配器必须转成字符串：
  // 透传会让探测把 "[object Object]" 当成 15 字正文
  const nat = makeNative('https://book.washai.net')
  const html = '<span id="indexName">第1章 测试</span><div id="readChapterAppendBody"><p>第一段正文内容。</p><p>第二段正文内容。</p></div>'
  const txt = nat.parseChapter(html)
  ok('原生正文返回字符串', typeof txt === 'string', typeof txt)
  ok('原生正文包含段落', txt.indexOf('第一段') >= 0 && txt.indexOf('第二段') >= 0, txt)
  ok('原生正文不是对象字符串', txt.indexOf('[object') < 0, txt)
}

// ---------- 汇总 ----------
if (fail) {
  console.log('\n失败项：')
  for (const f of fails) console.log(' - ' + f)
}
console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项')
if (!fail) console.log('全部通过 ✅')
process.exit(fail ? 1 : 0)
