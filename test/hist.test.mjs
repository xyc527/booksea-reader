// 搜索历史纯函数单测
import { pushHist, removeHist, sanitizeHist, normKw, cleanKw, HIST_MAX } from '../src/lib/hist.js'

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) pass++
  else fails.push(name + (extra ? ' → ' + extra : ''))
}
function eq(name, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  ok(name, a === b, a + ' != ' + b)
}

// ---- 归一化 ----
eq('cleanKw 折叠内部空格', cleanKw('败犬   女主'), '败犬 女主')
eq('cleanKw 去首尾空白', cleanKw('  败犬  '), '败犬')
eq('cleanKw 保留大小写', cleanKw('Abc'), 'Abc')
eq('cleanKw 全角空格当空白', cleanKw('败犬\u3000女主'), '败犬 女主')
eq('cleanKw null 安全', cleanKw(null), '')
eq('normKw 转小写', normKw('AbC'), 'abc')
eq('normKw 全角空格', normKw('a\u3000b'), 'a b')

// ---- 记录 ----
eq('空列表记一条', pushHist([], '败犬'), ['败犬'])
eq('追加到最前', pushHist(['斗罗'], '败犬'), ['败犬', '斗罗'])
eq('重复的置顶而非新增', pushHist(['斗罗', '败犬'], '败犬'), ['败犬', '斗罗'])
eq('大小写不同算同一条', pushHist(['Abc'], 'abc'), ['abc'])
eq('带空格重复也去重', pushHist(['败 犬'], '败  犬'), ['败 犬'])
eq('空关键词不入历史', pushHist(['败犬'], '   '), ['败犬'])
eq('null 关键词保持原样', pushHist(['败犬'], null), ['败犬'])
eq('非数组入参不炸', pushHist(null, '败犬'), ['败犬'])
eq('超过上限丢最旧', pushHist(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b'])
eq('上限 1 只留最新', pushHist(['a', 'b'], 'c', 1), ['c'])
eq('默认上限生效', pushHist(Array.from({ length: 30 }, (_, i) => 'k' + i), 'new').length, HIST_MAX)
eq('不修改入参', (() => {
  const src = ['a']
  pushHist(src, 'b')
  return src
})(), ['a'])

// ---- 删除 ----
eq('删掉指定项', removeHist(['a', 'b', 'c'], 'b'), ['a', 'c'])
eq('删除按归一化匹配', removeHist(['Abc', 'b'], 'abc'), ['b'])
eq('删不存在的项无变化', removeHist(['a'], 'zz'), ['a'])

// ---- 读取清洗 ----
eq('清洗掉脏值', sanitizeHist(['a', '', null, '  ', 'b']), ['a', 'b'])
eq('清洗去重', sanitizeHist(['a', 'A', 'b']), ['a', 'b'])
eq('清洗非数组', sanitizeHist('oops'), [])
eq('清洗保持顺序', sanitizeHist(['c', 'b', 'a']), ['c', 'b', 'a'])
eq('清洗截断', sanitizeHist(['a', 'b', 'c'], 2), ['a', 'b'])

// ---- 组合场景 ----
// 用户搜了 A→B→A，历史应该是 [A,B]，不是 [A,B,A]
let seq = []
seq = pushHist(seq, '葬送的芙莉莲')
seq = pushHist(seq, '无职转生')
seq = pushHist(seq, '葬送的芙莉莲')
eq('A→B→A 只留两条且 A 在前', seq, ['葬送的芙莉莲', '无职转生'])

if (fails.length) {
  console.log('FAIL ' + fails.length + ' / ' + (pass + fails.length))
  fails.forEach((f) => console.log('  ✗ ' + f))
  process.exit(1)
}
console.log('hist.test: ' + pass + ' 项全过')
