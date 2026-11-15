// CDN 多线路真实测试：真跑 curl，记录 HTTP 码 / 耗时 / 内容校验 / 故障切换
// 注意：本机 shell 里有 http_proxy=127.0.0.1:1518，会伪造 502/403 假失败，
// 所以国内站点必须加 --noproxy '*'（这里所有请求都直连）。
// 运行：node test/live/run_cdn.mjs
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { defaultLines, buildUrl, validatePayload, fetchWithFailover, testLine, fnv1a } from '../../src/lib/cdn.js'

const pexec = promisify(execFile)

const TARGET = { owner: 'XIU2', repo: 'Yuedu', ref: 'master', path: 'shuyuan', expect: { kind: 'legado', minCount: 5 } }

async function curl(url, timeoutMs) {
  const t0 = Date.now()
  const args = ['-k', '-s', '--noproxy', '*', '-L', '--max-redirs', '4', '--compressed', '-m', String(Math.ceil(timeoutMs / 1000) + 2),
    '--connect-timeout', '6', '-A', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    '-w', '\n__META__%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{size_download}', url]
  let out = ''
  let err = ''
  try {
    const r = await pexec('curl', args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs + 4000 })
    out = r.stdout
  } catch (e) {
    out = e.stdout || ''
    err = String(e.stderr || e.message || '').split('\n')[0]
  }
  const ms = Date.now() - t0
  const m = String(out).match(/__META__(\d+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)/)
  const text = String(out).replace(/\n?__META__[\s\S]*$/, '')
  if (!m) return { ok: false, error: err || '无响应', ms: ms, code: 0, text: '', phases: null }
  return {
    ok: true,
    code: parseInt(m[1], 10),
    phases: { dns: +m[2], tcp: +m[3], tls: +m[4], ttfb: +m[5], total: +m[6] },
    size: parseInt(m[7], 10),
    ms: ms,
    text: text,
    error: ''
  }
}

const lines = defaultLines()
console.log('== 线路逐条测试（目标：XIU2/Yuedu master shuyuan（163KB，22 个源））')
const rows = []
for (const l of lines) {
  const url = buildUrl(l, TARGET)
  const r = await curl(url, 15000)
  const check = r.ok && r.code === 200 ? validatePayload(r.text, TARGET.expect) : { ok: false, reason: r.error || ('HTTP ' + r.code) }
  rows.push({
    id: l.id,
    name: l.name,
    url: url,
    code: r.code,
    ms: r.ms,
    phases: r.phases,
    bytes: r.text ? r.text.length : 0,
    ok: !!check.ok,
    count: check.count || 0,
    reason: check.reason || '',
    sha: check.ok ? fnv1a(r.text) : ''
  })
  console.log(
    String(l.name).padEnd(12),
    'HTTP ' + String(r.code).padEnd(4),
    String(r.ms + 'ms').padEnd(8),
    (check.ok ? '成功 ' + check.count + ' 条' : '失败：' + (check.reason || 'HTTP ' + r.code)) +
      (r.phases ? '  [dns ' + Math.round(r.phases.dns * 1000) + ' tcp ' + Math.round(r.phases.tcp * 1000) + ' tls ' + Math.round(r.phases.tls * 1000) + ' ttfb ' + Math.round(r.phases.ttfb * 1000) + 'ms]' : '')
  )
}

// 内容一致性：所有成功线路必须拿到同一份文件（fnv1a 相同）
const okRows = rows.filter((r) => r.ok)
const shas = [...new Set(okRows.map((r) => r.sha))]
console.log('\n成功线路 ' + okRows.length + ' 条，文件指纹去重后 ' + shas.length + ' 个' + (shas.length === 1 ? '（全部一致）' : '（不一致，需排查）'))

// 故障切换：故意把首选线路的 ref 改错，验证会自动切到下一条且内容一致
console.log('\n== 故障切换验证（首选线路 ref 故意写错）')
// 用一条"仓库名写错"的线路模拟首选故障，其余线路保持真实地址
const broken = defaultLines().map((l) => Object.assign({}, l))
broken[0] = Object.assign({}, broken[0], { template: 'https://cdn.jsdelivr.net/gh/XIU2/NoSuchRepo-xyz@master/shuyuan' })
const brokenTarget = TARGET
const fetchOne = async (url) => {
  const r = await curl(url, 15000)
  if (!r.ok || r.code !== 200) return { ok: false, error: r.error || ('HTTP ' + r.code), ms: r.ms }
  return { ok: true, text: r.text, ms: r.ms }
}
const fo = await fetchWithFailover(broken, brokenTarget, fetchOne, { timeout: 15000 })
console.log('结果：' + (fo.ok ? '切换到 ' + fo.lineName + '（' + fo.ms + 'ms）' : '全部失败'))
console.log('过程：' + fo.tries.map((t) => t.name + (t.ok ? ' 成功' : ' 失败(' + t.error + ')')).join(' → '))
if (fo.ok) {
  const same = okRows.some((r) => r.sha === fnv1a(fo.text))
  console.log('内容校验：' + (validatePayload(fo.text, TARGET.expect).ok ? '是合法书源文件' : '内容不合法'))
  console.log('与正常线路文件是否同源同版本：' + (same ? '一致（切换没有拿到错版本）' : '不一致（ref 不同，属预期）'))
}

// 输出给报告用
const report = { at: new Date().toISOString(), target: TARGET, rows: rows.map((r) => ({ ...r, phases: r.phases })), failover: { ok: fo.ok, line: fo.line, tries: fo.tries } }
await import('node:fs').then((fs) => fs.writeFileSync('out/cdn-test.json', JSON.stringify(report, null, 2)))
console.log('\n明细已写入 out/cdn-test.json')
