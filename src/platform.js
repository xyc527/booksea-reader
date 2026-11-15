// 平台层：shell / fs / curl / 缓存 / 状态
// 唯一允许接触原生 API 的模块，页面与纯函数都不直接 import 原生模块

import g from 'global'
import fs from 'fs'

export const APPID = '8001792304816621'
export const SITE = 'https://book.washai.net'
export const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'

let G = null
let dataDir = ''
let ready = false
// 书存放在 <data>/books（旧版是 <data>/cache，见 normalizeDataSub）
let dataSub = 'books'
// 书的真正落盘根目录。优先用包目录之外的稳定路径：
// 实测词典笔在安装/升级时会把整个 <pkg>/<appid> 目录删掉再重建（老根 /userdisk 上的
// 数据会随目录一起消失），所以用户下载的正文绝不能只存在包目录里。
let booksRoot = ''
export const STABLE_BOOKS = '/userdisk/BookSea/' + APPID

export function dataRoot() {
  return dataDir
}

// ---------- 性能采样 ----------
// 卡顿的根源只可能是「JS 线程被同步调用占住」：fs 调用和 execShell 在这个平台上
// 都是阻塞的，一次几十到几千毫秒。这里按通道分别记账（次数/总耗时/最长一次），
// 由调试指令 staton / statend 开关，平时完全不计时。
export const STAT = { on: false, n: {}, ms: {}, max: {}, t0: 0 }

function rec(k, t) {
  if (!STAT.on || !t) return
  const d = Date.now() - t
  STAT.n[k] = (STAT.n[k] || 0) + 1
  STAT.ms[k] = (STAT.ms[k] || 0) + d
  if (d > (STAT.max[k] || 0)) STAT.max[k] = d
}

export function statStart() {
  STAT.on = true
  STAT.n = {}
  STAT.ms = {}
  STAT.max = {}
  STAT.t0 = Date.now()
}

export function statStop() {
  STAT.on = false
  return { n: STAT.n, ms: STAT.ms, max: STAT.max, span: Date.now() - STAT.t0 }
}

function call(fn, args, tag) {
  const t = STAT.on ? Date.now() : 0
  const k = tag || 'fs'
  try {
    const r = fn.apply(fs, args || [])
    if (r && typeof r.then === 'function') {
      // fs 的异步接口在文件不存在时是 reject，不是同步 throw，必须接住
      return r.then(
        function (v) {
          rec(k, t)
          return v
        },
        function () {
          rec(k, t)
          return null
        }
      )
    }
    rec(k, t)
    return Promise.resolve(r)
  } catch (e) {
    rec(k, t)
    return Promise.resolve(null)
  }
}

export async function exists(p) {
  const r = await call(fs.exists, [p], 'exists')
  return !!r
}

export async function readFile(p) {
  const r = await call(fs.readFile, [p], 'read')
  if (r == null) return null
  if (typeof r === 'string') return r
  if (typeof r === 'object' && typeof r.data === 'string') return r.data
  return String(r)
}

// 路径归一化：$dataDir 在部分固件上带双斜杠（<appid>//data），
// 不归一化的话 a//b 与 a/b 会被当成两个目录，前缀判断与缓存 key 全错。
export function normPath(p) {
  let s = String(p == null ? '' : p)
  if (!s) return ''
  const lead = s.charAt(0) === '/'
  s = s.replace(/\/{2,}/g, '/')
  if (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1)
  return lead && s.charAt(0) !== '/' ? '/' + s : s
}

export function parentOf(p) {
  const s = normPath(p)
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

// 建过的目录记一笔：每次写盘都 stat 一遍所有层级太慢
const dirsEnsured = {}

// readdir 的严格版：失败返回 null（用于判断目录是否真的存在）
export async function readdirRaw(p) {
  const r = await call(fs.readdir, [normPath(p)])
  return Array.isArray(r) ? r : null
}

// 逐级建目录。本机 fs.mkdir 只建最后一级，父目录缺失时抛 ENOENT，
// 而 writeFile 又不报错——于是首次启动连日志都静默丢失。
// shell 的 mkdir -p 在这个平台是同步可靠的，作为兜底。
export async function mkPath(p) {
  const dir = normPath(p)
  if (!dir) return false
  if (dirsEnsured[dir]) return true
  const parts = dir.split('/')
  let cur = ''
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (!seg) continue
    cur = cur + '/' + seg
    if (dirsEnsured[cur]) continue
    try {
      const r = fs.mkdir(cur)
      if (r && typeof r.then === 'function') await r
    } catch (e) {
      // 已存在（errno 17 / EEXIST）不是错误，其余也先不判死，下面统一确认
    }
  }
  if (await readdirRaw(dir)) {
    dirsEnsured[dir] = 1
    return true
  }
  // 兜底：走 shell（同步，不依赖 fs 的 mkdir 语义）
  sh("mkdir -p '" + dir + "' 2>/dev/null")
  if (await readdirRaw(dir)) {
    dirsEnsured[dir] = 1
    return true
  }
  return false
}

// ---------- 写通道（fs / shell 双路）----------
// 实测一台 4.x 固件（MEB0800009008260）上 fs.writeFile **直接抛异常**，而 fs.mkdir 正常：
// 目录建得出来、文件一个也落不下 —— 现象就是「下载走完、重进是空的、连 app.log 都没有」。
// 所以写文件做双通道：fs 优先，一旦抛错就把整个会话切到 shell（base64 → /bin/base64 -d），
// 由调用方读回校验。校验是必须的，平台的「成功」从来不等于落盘。
let fsWriteErr = ''
let shellWriteOnly = false
let shWriteFail = 0

export function writeDiag() {
  return { fsErr: fsWriteErr, channel: shellWriteOnly ? 'shell' : 'fs', shFail: shWriteFail }
}

// 纯 JS base64：QuickJS 里不一定有 btoa，也不保证 TextEncoder，自己编最稳
const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function b64enc(str) {
  const s = str == null ? '' : String(str)
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else {
      const c2 = s.charCodeAt(++i)
      const cp = 0x10000 + ((c - 0xd800) << 10) + ((c2 || 0) - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1
    out += B64C.charAt(b0 >> 2)
    out += B64C.charAt(((b0 & 3) << 4) | ((b1 < 0 ? 0 : b1) >> 4))
    out += b1 < 0 ? '=' : B64C.charAt(((b1 & 15) << 2) | ((b2 < 0 ? 0 : b2) >> 6))
    out += b2 < 0 ? '=' : B64C.charAt(b2 & 63)
  }
  return out
}

// 走 shell 落盘。base64 每段 6000 字符（是 4 的倍数，保证段边界落在 3 字节边界上），
// 避免单条命令过长被 execShell 截断。
export function shWriteFile(p, s) {
  const path = normPath(p)
  const body = s == null ? '' : String(s)
  const par = parentOf(path)
  // 每次写都 mkdir 一次就多一次同步 execShell；建过的目录记过账就跳过
  if (par && !dirsEnsured[par]) {
    sh("mkdir -p '" + par + "' 2>/dev/null")
    dirsEnsured[par] = 1
  }
  const b = b64enc(body)
  if (!b.length) {
    const r0 = sh(": > '" + path + "' 2>/dev/null")
    if (!r0) shWriteFail++
    return r0
  }
  const CH = 6000
  let okAll = true
  // 第一段直接重定向覆盖（省掉一次 `: >` 截断），后续段追加
  for (let i = 0; i < b.length; i += CH) {
    const seg = b.slice(i, i + CH)
    const redir = i === 0 ? '>' : '>>'
    const r = sh("printf '%s' '" + seg + "' | base64 -d " + redir + " '" + path + "' 2>/dev/null")
    if (!r) okAll = false
  }
  if (!okAll) shWriteFail++
  return okAll
}

export async function writeFile(p, s) {
  const path = normPath(p)
  const body = s == null ? '' : String(s)
  const t = STAT.on ? Date.now() : 0
  try {
    // 父目录不存在时，部分固件 writeFile 返回正常却不落盘 —— 先确保目录在
    const par = parentOf(path)
    if (par && !dirsEnsured[par]) await mkPath(par)
    if (!shellWriteOnly) {
      const r = fs.writeFile(path, body)
      if (r && typeof r.then === 'function') await r
      rec('write', t)
      return true
    }
  } catch (e) {
    if (!fsWriteErr) fsWriteErr = String((e && (e.message || e)) || e).slice(0, 160)
    shellWriteOnly = true
  }
  const ok = shWriteFile(path, body)
  rec('writeSh', t)
  return ok
}

// 写后读回校验：返回 {ok, why, got}。
// 平台的 writeFile 报成功不等于落盘（目录被换成文件、目标无权限都会静默失败），
// 缓存正文与设置这种「丢了就白下」的数据必须走这条。
export async function writeFileV(p, s, opts) {
  const want = s == null ? '' : String(s)
  const path = normPath(p)
  const w = await writeFile(path, want)
  if (!w) return { ok: false, why: '写入报错' }
  const got = shellWriteOnly ? await readFileRetry(path, 3, 150) : await readFile(path)
  if (got == null) return { ok: false, why: '写后读不到' }
  if (String(got) === want) return { ok: true, why: '', got: String(got), bytes: String(got).length }
  if (!(opts && opts.lenient)) {
    return { ok: false, why: '读回不一致(' + String(got).length + '/' + want.length + 'B)', got: String(got) }
  }
  return { ok: true, why: '长度差但可用', got: String(got), bytes: String(got).length }
}

// 冷启动第一次 readFile 经常失败（文件系统还没就绪）：关键读给几次重试
export async function readFileRetry(p, tries, gap) {
  const n = tries || 5
  const wait = gap || 400
  for (let i = 0; i < n; i++) {
    const s = await readFile(p)
    if (s != null) return s
    if (i < n - 1) await sleep(wait)
  }
  return null
}

export async function mkdir(p) {
  try {
    const r = fs.mkdir(normPath(p))
    if (r && typeof r.then === 'function') await r
    return true
  } catch (e) {
    return false
  }
}

export async function rm(p) {
  const t = STAT.on ? Date.now() : 0
  try {
    const r = fs.rm(p)
    if (r && typeof r.then === 'function') await r
    rec('rm', t)
    return true
  } catch (e) {
    rec('rm', t)
    return false
  }
}

export async function readdir(p) {
  const r = await call(fs.readdir, [p], 'readdir')
  return Array.isArray(r) ? r : []
}

// ---------- 键值存储（第二条通道）----------
// 平台事实：`import storage from 'storage'` 这条模块通道在部分固件上 Promise 永不
// resolve（静默挂起），能用的只有 $falcon.jsapi.storage，参数必须是对象。
// 文件通道在另一部分固件上会「报成功但不落盘」，两条通道互为兜底：
//   关键数据 = 文件（adb 可看可导出，读优先）+ storage 镜像（真会落盘）
// 读取顺序：文件 → 内容为空/坏掉 → storage 镜像。
function jsapiStorage() {
  try {
    if (typeof $falcon === 'undefined' || !$falcon || !$falcon.jsapi) return null
    const s = $falcon.jsapi.storage
    return s || null
  } catch (e) {
    return null
  }
}

export function storageAvailable() {
  return !!jsapiStorage()
}

export async function storageSet(key, val) {
  const s = jsapiStorage()
  if (!s) return false
  try {
    const r = s.setStorage({ key: String(key), data: typeof val === 'string' ? val : JSON.stringify(val) })
    // 有的固件返回 Promise，有的直接返回对象
    if (r && typeof r.then === 'function') await r
    return true
  } catch (e) {
    return false
  }
}

export async function storageGet(key) {
  const s = jsapiStorage()
  if (!s) return null
  try {
    let r = s.getStorage({ key: String(key) })
    if (r && typeof r.then === 'function') r = await r
    if (!r) return null
    if (r.error) return null
    if (typeof r.data === 'string') return r.data
    if (r.data != null) return JSON.stringify(r.data)
    return null
  } catch (e) {
    return null
  }
}

export async function storageInfo() {
  const s = jsapiStorage()
  if (!s) return null
  try {
    let r = s.getStorageInfo({})
    if (r && typeof r.then === 'function') r = await r
    return r || null
  } catch (e) {
    return null
  }
}

// 双通道保存：文件为主（可读可导出），storage 仅做镜像
// 翻页会频繁保存阅读位置，镜像限流到 1.5s 一次；文件写失败时立刻镜像（这正是它的用处）
let lastMirrorAt = 0
export async function saveBoth(key, path, text) {
  const w = await writeFileV(path, text)
  let st = false
  const now = Date.now()
  if (String(text).length <= 60000 && (now - lastMirrorAt > 1500 || !w.ok)) {
    st = await storageSet(key, text)
    if (st) lastMirrorAt = now
  }
  return { file: w.ok, storage: st, why: w.why }
}

// 双通道读取：文件优先，坏/空 → storage。
// 注意重试次数：冷启动时文件系统就绪慢，只重试 2 次（240ms）经常还是读不到，
// 就会退回 storage 镜像——而镜像可能是旧的，用户的表现就是「重启后阅读进度倒退」。
export async function loadBoth(key, path) {
  const s = await readFileRetry(path, 6, 250)
  if (s != null && String(s).length) return { value: String(s), from: 'file' }
  const v = await storageGet(key)
  if (v != null && String(v).length) return { value: String(v), from: 'storage' }
  return { value: null, from: 'none' }
}

function globalInst() {
  if (!G) G = new g.Global()
  return G
}

export function sh(cmd, tag) {
  const t = STAT.on ? Date.now() : 0
  try {
    const r = !!globalInst().execShell(cmd)
    rec(tag || 'sh', t)
    return r
  } catch (e) {
    rec(tag || 'sh', t)
    return false
  }
}

// ---------- 系统输入法 ----------
// 文档来源：haasui-falcon-app / references/falcon-runtime.md「系统输入法状态机」
//   startTextEdit(JSON) -> uuid；textEditFinished.on(handler)；closeTextEdit(uuid)
// 输入法是独立的系统 mini-app，不是普通控件，所以这里只做会话封装，
// 页面拿回调结果自行决定业务动作。

let kb = { inited: false, handler: null, uuid: '', cb: null, lastRaw: '' }

// 把回调载荷归一化。固件差异较大：可能是 JSON 字符串，也可能是对象，
// 文本字段可能是 text / value / {value}，确认标记可能是 editConfirmed / confirm。
export function parseEditPayload(raw) {
  let o = raw
  let fromString = false
  if (typeof raw === 'string') {
    fromString = true
    const s = raw.trim()
    if (!s) return null
    try {
      o = JSON.parse(s)
    } catch (e) {
      return { uuid: '', confirmed: false, text: s, cancelled: false, rawKeys: '', fromString: true }
    }
  }
  if (!o || typeof o !== 'object') return null
  const uuid = o.uuid || o.id || o.sessionId || ''
  const text = firstString(o)
  const cancelled = o.cancel === true || o.cancelled === true || o.action === 'cancel' || o.action === 'close' || o.editCancelled === true
  // 显式确认标记
  let hasFlag = false
  let flag = false
  const flags = ['editConfirmed', 'confirm', 'confirmed', 'isConfirm', 'enterKey', 'enter']
  for (let i = 0; i < flags.length; i++) {
    if (Object.prototype.hasOwnProperty.call(o, flags[i])) {
      hasFlag = true
      if (o[flags[i]] === true) flag = true
    }
  }
  // 没有任何显式标记时，有文本就视为确认（否则键盘永远无法回传）
  const confirmed = cancelled ? false : hasFlag ? flag : !!text
  let keys = ''
  try {
    keys = Object.keys(o).join(',')
  } catch (e) {}
  return { uuid: String(uuid || ''), confirmed: confirmed, text: text, cancelled: cancelled, rawKeys: keys, fromString: fromString }
}

function firstString(o) {
  if (typeof o.text === 'string') return o.text
  if (typeof o.value === 'string') return o.value
  if (o.text && typeof o.text.value === 'string') return o.text.value
  if (o.data && typeof o.data.text === 'string') return o.data.text
  if (o.data && typeof o.data.value === 'string') return o.data.value
  if (o.editResult && typeof o.editResult.text === 'string') return o.editResult.text
  return ''
}

export function textEditSupported() {
  try {
    const inst = globalInst()
    const ev = inst.textEditFinished
    return typeof inst.startTextEdit === 'function' && !!ev && typeof ev.on === 'function'
  } catch (e) {
    return false
  }
}

// 注册全局回调（只注册一次）。cb 收到 { confirmed, text, uuid }
export function initTextEdit(cb) {
  kb.cb = cb
  if (kb.inited) return true
  try {
    const inst = globalInst()
    const ev = inst.textEditFinished
    if (!ev || typeof ev.on !== 'function') return false
    // 固件回调是 (uuid, jsonData) 双参数；但也要兼容只传一个 JSON 串的实现
    kb.handler = function (a, b) {
      let uuid = ''
      let raw = b
      if (b !== undefined) {
        uuid = typeof a === 'string' ? a : ''
      } else {
        raw = a
        const s = typeof a === 'string' ? a.trim() : ''
        // 单参数且形如 uuid（纯十六进制）时，说明本次只通知会话结束，没有文本
        if (s && /^[0-9a-f]{8,}$/i.test(s)) {
          uuid = s
          raw = ''
        }
      }
      let rawStr = ''
      try {
        rawStr = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : ''
      } catch (e) {
        rawStr = String(raw)
      }
      kb.lastRaw = String(rawStr || '').slice(0, 400) + (uuid ? '  <uuid=' + uuid + '>' : '')
      let p = null
      try {
        p = parseEditPayload(raw)
      } catch (e) {
        p = null
      }
      if (p && !p.uuid && uuid) p.uuid = uuid
      // 只处理当前会话：带 uuid 且与当前不一致的回报一律忽略
      if (p && p.uuid && kb.uuid && p.uuid !== kb.uuid) return
      const cur = kb.uuid
      if (kb.cb) kb.cb({ confirmed: !!(p && p.confirmed), text: (p && p.text) || '', uuid: cur })
    }
    ev.on(kb.handler)
    kb.inited = true
    return true
  } catch (e) {
    return false
  }
}

export function textEditLastRaw() {
  return kb.lastRaw || ''
}

export function openTextEdit(text, opt) {
  try {
    const inst = globalInst()
    if (typeof inst.startTextEdit !== 'function') return ''
    // 打开前先关掉残留会话，避免两个 uuid 打架
    if (kb.uuid) {
      try {
        inst.closeTextEdit(kb.uuid)
      } catch (e) {}
      kb.uuid = ''
    }
    const o = opt || {}
    const cfg = {
      text: String(text || ''),
      placeholder: String(o.placeholder || ''),
      maxlength: o.maxlength || 24,
      inputType: o.inputType || 'EnUSPreferred',
      autofocus: true,
      showCursor: true,
      multiLinesEditVisible: false,
      enterButtonText: String(o.enterButtonText || '确定')
    }
    const r = inst.startTextEdit(JSON.stringify(cfg))
    let uuid = ''
    if (typeof r === 'string') uuid = r
    else if (r && typeof r === 'object') uuid = String(r.uuid || r.id || '')
    kb.uuid = uuid
    return uuid
  } catch (e) {
    return ''
  }
}

export function closeTextEdit() {
  const u = kb.uuid
  kb.uuid = ''
  if (!u) return false
  try {
    globalInst().closeTextEdit(u)
    return true
  } catch (e) {
    return false
  }
}

export function textEditOpen() {
  return !!kb.uuid
}


// ---------- 初始化 ----------

export async function init() {
  if (ready) return dataDir
  try {
    if (!G) G = new g.Global()
  } catch (e) {
    G = null
  }
  const cands = []
  try {
    if (typeof $dataDir !== 'undefined' && $dataDir) cands.push(String($dataDir))
  } catch (e) {}
  cands.push('/userdisk/secondary/miniapp/data/mini_app/pkg/' + APPID + '/data')
  cands.push('/userdisk/secondary/miniapp/data/mini_app/pkg/' + APPID)
  cands.push('/userdata/miniapp/data/mini_app/pkg/' + APPID + '/data')

  const probeInfo = []
  const writable = []
  // 书已经放在包目录外的稳定路径时，各候选目录里「有几本书」就不再影响选择，
  // 只要哪个目录有上次的 state.json 就是上次在用的那个 —— 探到它就可以收工，
  // 剩下 2~3 个候选不用再各写一次探测文件（冷启动能省几百毫秒）。
  const stableN = nameCount(await readdir(STABLE_BOOKS))
  let early = null
  for (let i = 0; i < cands.length; i++) {
    const p = cands[i].replace(/\/+$/, '')
    // 这个平台的 fs.writeFile 会**顺手把父目录建出来**。无脑探测会凭空造出
    // /userdisk/.../pkg/<appid>/data 这种空壳目录，下次启动又会被当成候选。
    // 所以只有父目录真实存在时才探写。
    const parent = p.replace(/\/[^/]+$/, '')
    const hasParent = (await exists(p)) || (await exists(parent))
    if (!hasParent) {
      writable.push({ p: p, ok: false, n: 0 })
      probeInfo.push(i + ':' + p + ' w=0 (no parent) b=0')
      continue
    }
    const probe = p + '/.wtest'
    let ok = false
    if (await writeFile(probe, '1')) ok = await exists(probe)
    await rm(probe)
    const n = await countBooksIn(p)
    writable.push({ p: p, ok: ok, n: n })
    probeInfo.push(i + ':' + p + ' w=' + (ok ? 1 : 0) + ' b=' + n)
    if (!early && ok && stableN > 0 && (await exists(p + '/state.json'))) early = { p: p, n: n }
  }

  // 选目录：**优先已经有书的那个**，其次才取第一个可写的。
  // 旧逻辑「第一个可写就选」在固件/机型差异下会出事：$dataDir 一旦换了位置，
  // 本次启动就落在一个全新的空目录上 —— 用户看到的就是「刚下完，退出再进书架空了」，
  // 书其实还躺在旧目录里。这类问题在开发者机器上几乎复现不了。
  let pick = early ? early.p : null
  let bestN = early ? early.n : 0
  for (let i = 0; pick === null && i < writable.length; i++) {
    const w = writable[i]
    if (!w.ok) continue
    if (w.n > bestN) {
      bestN = w.n
      pick = w.p
    }
  }
  if (!pick) {
    for (let i = 0; i < writable.length; i++) {
      if (writable[i].ok) {
        pick = writable[i].p
        break
      }
    }
  }
  if (!pick) {
    // 全新设备上哪个父目录都还不存在：退回第一个候选，靠 writeFile 自己建目录
    const first = cands[0].replace(/\/+$/, '')
    await writeFile(first + '/.wtest', '1')
    await rm(first + '/.wtest')
    pick = first
    probeInfo.push('fallback=' + first)
  }
  dataDir = normPath(pick)
  await mkPath(dataDir)
  await normalizeDataSub()
  await chooseBooksRoot(cands)
  await mkPath(cacheRoot())
  // POST 请求体临时文件（.rq_<hash>）：curl 用 --data-binary @file 必须先落盘，
  // 但用完没人删，整本下载 92 章就留 92 个，长期堆在数据目录里。
  // 启动时扫一遍（此时没有在途请求，删了安全）。
  try {
    const _ls = await readdir(dataDir)
    for (let i = 0; i < _ls.length; i++) {
      const d = _ls[i]
      const nm = typeof d === 'string' ? d : d && (d.name || d.path)
      const base = String(nm || '').replace(/\/+$/, '')
      if (base.lastIndexOf('.rq_', 0) === 0) await rm(dataDir + '/' + base)
    }
  } catch (e) {}
  let migrated = false
  try {
    migrated = await migrateDrift(dataDir, cands)
  } catch (e) {}
  ready = true
  return dataDir
}

// 存储目录从 cache 改名为 books。
// 系统清理工具、储存管理、以及部分固件的「清理应用缓存」会无差别删掉名字叫 cache 的目录，
// 用户辛苦下的整本书不该放在这种名字下面。旧数据一次性 mv 过来，失败则继续用旧名。
async function normalizeDataSub() {
  const oldP = dataDir + '/cache'
  const newP = dataDir + '/books'
  const hasNew = (await readdir(newP)).length > 0
  const oldList = await readdir(oldP)
  if (!hasNew && oldList.length) {
    sh("mv '" + oldP + "' '" + newP + "' 2>/dev/null")
    const moved = (await readdir(newP)).length > 0
    dataSub = moved ? 'books' : 'cache'
    await mkPath(newP)
  } else if (hasNew && oldList.length) {
    // 两个都在：以 books 为准，把旧目录里缺的书补过去（不删旧的，宁可多占一点）
    dataSub = 'books'
    sh("cp -a '" + oldP + "/.' '" + newP + "/' 2>/dev/null")
  } else if (!hasNew && !oldList.length) {
    dataSub = 'books'
  }
}

// 决定「书存在哪」：优先 /userdisk/BookSea/<appid>（包目录之外，升级不会被动到），
// 写不进去才退回 <data>/books。选好后如果新位置是空的，就把旧位置的书搬过来。
async function chooseBooksRoot(cands) {
  const stable = STABLE_BOOKS
  // 目录可能还不存在；先用 shell 建出来（fs.mkdir 不递归）
  sh("mkdir -p '" + stable + "' 2>/dev/null")
  const probe = stable + '/.wtest'
  let ok = false
  if (await writeFile(probe, 'x')) ok = await exists(probe)
  await rm(probe)
  booksRoot = ok ? stable : dataDir + '/books'
  await mkPath(booksRoot)
  const n0 = nameCount(await readdir(booksRoot))
  if (n0 > 0) return
  // 新位置是空的：把旧位置（data/books、data/cache、其它候选包目录）的书搬过来。
  // 复制而不是移动：万一新位置不可靠，旧的那份还在，最多多占一次空间。
  const srcs = [dataDir + '/books', dataDir + '/cache', dataDir + '/' + dataSub]
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i].replace(/\/+$/, '')
    if (!c) continue
    srcs.push(c + '/books')
    srcs.push(c + '/cache')
  }
  const done = {}
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i]
    if (!src || src === booksRoot || done[src]) continue
    done[src] = 1
    const n = nameCount(await readdir(src))
    if (!n) continue
    sh("cp -a '" + src + "/.' '" + booksRoot + "/' 2>/dev/null")
    const got = nameCount(await readdir(booksRoot))
    if (got) return
  }
}

function nameCount(list) {
  let n = 0
  for (let i = 0; i < (list || []).length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const s = String(name).replace(/\/+$/, '')
    const base = s.slice(s.lastIndexOf('/') + 1)
    if (!base || base.charAt(0) === '.') continue
    n++
  }
  return n
}

async function countBooksIn(p) {
  const a = await readdir(p + '/books')
  if (a && a.length) return nameCount(a)
  const b = await readdir(p + '/cache')
  return nameCount(b)
}

// 数据目录漂移后把旧目录里的书搬回来（只在当前目录为空时做）
async function migrateDrift(chosen, cands) {
  const cur = await readdir(cacheRoot())
  if (cur && cur.length) return false
  // 注意：chosen 自己的 books 目录也要算来源。cache→books 改名之后，
  // 旧代码只看 chosen/cache，结果「书就在旁边却搬不过来」，书架一片空白。
  const srcs = [chosen + '/books', chosen + '/cache', chosen + '/' + dataSub]
  const seen = {}
  for (let i = 0; i < cands.length; i++) {
    const p = cands[i].replace(/\/+$/, '')
    if (!p) continue
    srcs.push(p + '/books')
    srcs.push(p + '/cache')
  }
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i]
    if (!src || src === cacheRoot() || seen[src]) continue
    seen[src] = 1
    const list = await readdir(src)
    if (!list || !list.length) continue
    sh("cp -a '" + src + "/.' '" + cacheRoot() + "/' 2>/dev/null")
    const n = (await readdir(cacheRoot())).length
    if (!n) {
      continue
    }
    const base = src.replace(/\/(books|cache)$/, '')
    if (!(await readFile(chosen + '/state.json'))) {
      const st = await readFile(base + '/state.json')
      if (st) await writeFile(chosen + '/state.json', st)
    }
    return true
  }
  return false
}

// ---------- 应用日志：已移除 ----------
// 日志用「读整份 → 拼一行 → 整份写回」实现，单次就是一次 O(N) 写盘；
// 在只支持 shell 写盘的机型上还要拆成多条 base64 shell 命令，每条都是
// 同步 execShell —— 阅读翻页、打开章节、书架刷新都会被它卡住几百毫秒。
// 现在彻底去掉落盘日志：自检（selfCheck）不依赖它，异常在界面上直接给出。

// 书架快照：上次启动时书架上有几本。用来识别「非用户操作的空书架」
export async function saveShelfSnap(o) {
  if (!dataDir) return false
  return writeFile(dataDir + '/shelf.snap', JSON.stringify(o))
}

export async function readShelfSnap() {
  if (!dataDir) return null
  const s = await readFile(dataDir + '/shelf.snap')
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch (e) {
    return null
  }
}

// 在所有候选目录里找「还有书的那个」，返回 [{p, n}]
export async function findBooksElsewhere() {
  const out = []
  const cands = [dataDir, STABLE_BOOKS]
  cands.push('/userdisk/secondary/miniapp/data/mini_app/pkg/' + APPID + '/data')
  cands.push('/userdisk/secondary/miniapp/data/mini_app/pkg/' + APPID)
  cands.push('/userdata/miniapp/data/mini_app/pkg/' + APPID + '/data')
  const seen = {}
  for (let i = 0; i < cands.length; i++) {
    const p = cands[i].replace(/\/+$/, '')
    if (!p || seen[p]) continue
    seen[p] = 1
    const subs = p === STABLE_BOOKS ? [''] : ['/books', '/cache']
    for (let j = 0; j < subs.length; j++) {
      const src = p + subs[j]
      if (src === cacheRoot()) continue
      const n = nameCount(await readdir(src))
      if (n > 0) {
        out.push({ p: src, n: n })
        break
      }
    }
  }
  out.sort(function (a, b) {
    return b.n - a.n
  })
  return out
}

// 把找到的书搬回当前目录（不删源，避免二次事故）
export async function restoreBooks(src) {
  if (!src) return 0
  const dest = cacheRoot()
  await mkPath(dest)
  sh("cp -a '" + src + "/.' '" + dest + "/' 2>/dev/null")
  const n = nameCount(await readdir(dest))
  return n
}

// ---------- 网络 ----------

export function urlSearch(kw) {
  return SITE + '/book/bookclass.html?k=' + encodeURIComponent(kw)
}

export function urlToc(bid, pageNo) {
  if (!pageNo || pageNo <= 1) return SITE + '/book/indexList-' + bid + '.html'
  return SITE + '/book/indexList/' + bid + '/' + pageNo + '.html'
}

export function urlChapter(bid, cid) {
  return SITE + '/book/' + bid + '/' + cid + '.html'
}

// --compressed：站点支持 br/gzip（实测 content-encoding: br），
// 不带上这个开关等于每次都在下未压缩的 154KB 首页 / 100KB 章节页
function curlBase(url, out, timeout) {
  return (
    "curl -k -s --compressed -m " + timeout + " -A '" + UA + "' -o '" + out + "' '" + url + "'"
  )
}

// 同步抓（阻塞，用于降级模式）
export async function fetchSync(url, out, timeout) {
  const t = timeout || 20
  sh(curlBase(url, out, t))
  return readFile(out)
}

// ---------- 连通性 ----------
// 断网时每次抓取都要等后台 34s + 同步 30s，体验很差。先探一次站点：
// 探不通就直接判离线，页面立刻给出「未下载」提示，不再空等。
//
// v1.1.27 起三点改动（原来断网重连后仍报离线）：
//   1) 负结果只缓存 1.5 秒（原来 20 秒）——重连后立刻能重新探测；
//   2) 探测改 HEAD（原来直接 GET 首页，每次白下 154KB、耗时 1.8s）；
//   3) 三态返回：true 通 / false 断 / null 探测不了（调用方当"通"处理）。
// 判定依据看 curl 自己是否失败（连不上），而不是 HTTP 码：
//   5xx 说明 DNS/TCP/TLS 都通，属于站点故障，不该把整机判成离线。
const NET_TTL_UP = 30000
const NET_TTL_DOWN = 1500
let netState = 0 // 0 未知 / 1 通 / -1 断
let netAt = 0
// 后台进程能力（probeBackground 测出来），netUp 据此决定探测是否要阻塞
let bgCap = null

export async function netUp(force) {
  const now = Date.now()
  const ttl = netState > 0 ? NET_TTL_UP : NET_TTL_DOWN
  if (!force && netState !== 0 && now - netAt < ttl) return netState > 0
  // 站点 TTFB 实测 1.78s，原来 -m 2 卡在临界点上，网络一抖就超时；
  // 而超时被当成「断网」正是「明明有网却显示离线」的来源。
  // 现在把 curl 自己的退出码一起写回来，区分三态：
  //   RC=0 有响应      -> 在线
  //   RC=28 超时 / 56 -> 未知（不下结论，按通放行）
  //   RC=6/7 等连不上  -> 离线
  //
  // v1.1.79：探测改后台进程 + 轮询落地文件。
  // execShell 是同步的，前台跑 curl -m 4 最坏会把 JS 线程按住 4 秒
  // ——启动 600ms 后探一次、离线时每 2.7 秒再探一次，用户感觉就是"进去就卡住"。
  const f = dataDir + '/.net'
  const done = dataDir + '/.net.ok'
  const probe = function (flag) {
    const cmd =
      "curl -s --compressed " + flag + " -m 4 -o /dev/null -w '%{http_code}' '" + SITE +
      "/' > '" + f + "' 2>/dev/null; echo ' RC='$? >> '" + f + "'"
    if (bgCap === false) {
      sh(cmd, 'net-probe-sync')
      return true
    }
    sh("rm -f '" + done + "'; (" + cmd + "; touch '" + done + "') >/dev/null 2>&1 &", 'net-probe-bg')
    return false
  }
  const runProbe = async function (flag) {
    await rm(f)
    const sync = probe(flag)
    if (sync) return readFile(f)
    // 后台：最多等 5 秒落地（curl 自己 -m 4 会先结束）
    await waitFile(done, 5000)
    const s = await readFile(f)
    await rm(done)
    return s
  }
  // HEAD 优先；站点若不支持 HEAD 会返回 405/501，再回落成只取 1 字节
  let s = await runProbe('-I')
  let code = parseInt(String(s || '').trim(), 10)
  if (!code) {
    s = await runProbe('-r 0-0')
    code = parseInt(String(s || '').trim(), 10)
  }
  await rm(f)
  const raw = String(s == null ? '' : s)
  const m = raw.match(/RC=(\d+)/)
  const rc = m ? parseInt(m[1], 10) : -1
  if (code >= 100) {
    // 有 HTTP 码说明 DNS/TCP/TLS 全通，哪怕 5xx 也是在线的（站点故障不等于断网）
    netState = 1
    netAt = Date.now()
    return true
  }
  if (rc === 28 || rc === 56 || rc === -1) {
    // 超时或结果没落地：给不出结论，别把用户误判成离线
    netState = 0
    return null
  }
  netState = -1
  netAt = Date.now()
  return false
}

// 只有探测能改全局网络状态。请求失败只说明那个 URL 失败，不能推断整机离线
export function markNet() {
  return false
}

// 后台抓：立刻返回，靠 .ok 标记轮询。
// 同时把 HTTP 码落进 <out>.code：站点会返回 429「请求过于频繁」，
// 之前只判断文件大小/能否解析，把限流当成"章节内容坏了"，整本直接判死。
export function fetchBg(url, out, timeout) {
  const t = timeout || 25
  const part = out + '.part'
  const ok = out + '.ok'
  const code = out + '.code'
  sh(
    "rm -f '" + ok + "' '" + part + "' '" + code + "'; (" +
      "curl -k -s --compressed -m " + t + " -A '" + UA + "' -o '" + part +
      "' -w '%{http_code}' '" + url + "' > '" + code + "' 2>/dev/null; " +
      "[ -f '" + part + "' ] && mv '" + part + "' '" + out + "'; touch '" + ok +
      "') >/dev/null 2>&1 &"
  )
}

// 批量抓：一个 curl 进程按 -K 配置顺序取多章，复用同一条 TLS 连接。
// 实测（设备 MEB0700009006978）单章：独立进程 4.5s（conn 每次新建，TLS 0.5~1.5s）
// vs 同进程顺序 2.2s（第二年起 conn=0）。整本 1900 章光这一项就差 1 小时以上。
export function fetchBatch(cfg, log, ok, timeout) {
  const t = timeout || 45
  sh(
    "rm -f '" + ok + "' '" + log + "'; (" +
      "curl -k -s --compressed -m " + t + " -A '" + UA + "' -K '" + cfg +
      "' > '" + log + "' 2>/dev/null; touch '" + ok +
      "') >/dev/null 2>&1 &"
  )
}

export async function waitFile(p, ms) {
  // 100ms 轮询：原来 220ms，一章白等 0.1~0.2s，整本 1000 章就是几分钟
  const step = 100
  let waited = 0
  while (waited <= ms) {
    if (await exists(p)) return true
    await sleep(step)
    waited += step
  }
  return false
}

export function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

// 探测「后台进程是否能在 shell 退出后存活」
export async function probeBackground() {
  const mark = dataDir + '/.bgprobe'
  const marks = dataDir + '/.bgprobe2'
  const log = []
  await rm(mark)
  await rm(marks)
  const t0 = Date.now()
  const r1 = sh("(sleep 2; touch '" + mark + "') >/dev/null 2>&1 &")
  log.push('bg sh=' + r1 + ' return@' + (Date.now() - t0) + 'ms')
  const ok1 = await waitFile(mark, 5000)
  log.push('bg touch=' + ok1 + ' @' + (Date.now() - t0) + 'ms')

  const t1 = Date.now()
  const r2 = sh("touch '" + marks + "' &")
  log.push('direct sh=' + r2 + ' return@' + (Date.now() - t1) + 'ms')
  const ok2 = await waitFile(marks, 1500)
  log.push('direct touch=' + ok2 + ' @' + (Date.now() - t1) + 'ms')

  await rm(mark)
  await rm(marks)
  bgCap = !!ok1
  return ok1
}

function guessCwd() {
  try {
    const tmp = dataDir + '/.cwd'
    sh("pwd > '" + tmp + "'")
    return String(tmp)
  } catch (e) {
    return 'n/a'
  }
}

// ---------- 缓存 ----------

// 应用版本：说明页原来写死 "v1.1.27"，改一次忘一次。这里直接读安装目录里的
// manifest.json（A/B 两个槽都可能），读不到就返回空串，页面上就不显示版本。
let appVer = ''
export async function appVersion() {
  if (appVer) return appVer
  try {
    const base = dataDir.replace(/\/+$/, '').replace(/\/data$/, '')
    const slots = [base + '/a/manifest.json', base + '/b/manifest.json']
    for (let i = 0; i < slots.length; i++) {
      const s = await readFile(slots[i])
      if (!s) continue
      const j = JSON.parse(s)
      if (j && j.version) {
        appVer = String(j.version)
        return appVer
      }
    }
  } catch (e) {}
  return ''
}

export function cacheRoot() {
  return booksRoot || dataDir + '/' + dataSub
}

export function bookDir(bid) {
  return cacheRoot() + '/' + bid
}

export function cachePath(bid, cid) {
  return bookDir(bid) + '/' + cid + '.txt'
}

export function tocPath(bid) {
  return dataDir + '/cache/' + bid + '/toc.json'
}

// 目录块：放在 toc/ 子目录里，避免被 cachedCids 当成章节，也方便单独统计体积
export function tocDir(bid) {
  return bookDir(bid) + '/toc'
}

export function tocTxtPath(bid, pageNo) {
  return tocDir(bid) + '/' + pageNo + '.txt'
}

// 旧版把整页 HTML 存在书目录下，迁移后要删掉
export function tocHtmlPath(bid, pageNo) {
  return bookDir(bid) + '/toc_' + pageNo + '.html'
}

export async function readTocTxt(bid, pageNo) {
  return readFile(tocTxtPath(bid, pageNo))
}

export async function writeTocTxt(bid, pageNo, text) {
  await mkPath(tocDir(bid))
  const r = await writeFileV(tocTxtPath(bid, pageNo), text, { lenient: true })
  return r.ok
}

export async function clearTocTxt(bid) {
  sh("rm -rf '" + tocDir(bid) + "' 2>/dev/null")
  return true
}

// 抓取用的临时文件（search.html / ch_xxx.html / toc_N.html）用完即删：
// 早期版本把它们当缓存留着，一个目录页 124KB，全站目录能吃掉几 MB
export function scratchPath(name) {
  return dataDir + '/' + name
}

// 数据根目录下的抓取残留一律清掉。
// 早期只删 *.html，实测漏了 3 个 ch_*.html.part 共 296KB；
// 现在把 .part/.ok/.cwd/.net/.du.tmp/.scan.tmp 一起收。
const SCRATCH_RE = /(\.html(\.(part|ok|code))?|\.txt(\.(part|ok))?|\.code)$/
// 批量抓的配置/日志/标记（b<ts>_<rnd>.cfg|log|ok）。别用通配的 *.log，
// 根目录下的 dlfail.log / refresh.log / cmd.txt 是有用的诊断文件
const BATCH_RE = /^b\d+_\d+\.(cfg|log|ok|hdr)$/
// 这些是应用自己的记录文件，任何情况下都不清
// 只保护真正需要跨启动留存的：指令通道、阅读状态、书架快照。
// 其余按需导出的诊断结果（snapshot/selfcheck/touch/bench 等）下次启动一并清掉，
// 不在数据目录里攒文件。
const KEEP_RE = /^(cmd\.txt|state\.json|shelf\.snap)$/
// 按需导出的一次性诊断结果（调试指令写的），启动时顺手清掉
const DIAG_OUT_RE = /^(selfcheck|snapshot|touch|bench)\.json$|^\.(bench_a|bench_b)$/

export async function cleanScratch() {
  const list = await readdir(dataDir)
  let n = 0
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const s = String(name)
    // 只删数据根目录下的调试/抓取残留，绝不碰 cache/ 子目录
    if (s.indexOf('/') >= 0) continue
    if (s.charAt(0) === '.') {
      // 点开头的只清这几类临时标记，state.json 之类不受影响
      if (!/^\.(cwd|net|du\.tmp|scan\.tmp|wtest|bgprobe2?)$/.test(s)) continue
    } else if (KEEP_RE.test(s)) continue
    else if (!DIAG_OUT_RE.test(s) && !SCRATCH_RE.test(s) && !BATCH_RE.test(s)) continue
    await rm(scratchPath(s))
    n++
  }
  return n
}

export async function readCache(bid, cid) {
  return readFile(cachePath(bid, cid))
}

// 正文落盘。返回 boolean —— 调用方必须尊重这个返回值：
// 原来 writeFile 一条路直接 return true，在「报成功但不落盘」的固件上会把章节
// 当成已缓存（cachedSet 置 1、进度 +1），重进却是空的，表现就是「缓存不成功」。
export async function writeCache(bid, cid, text) {
  const body = text == null ? '' : String(text)
  if (body.length < 1) return false
  const r = await writeFileV(cachePath(bid, cid), body)
  if (r.ok) {
    markCacheDirty()
    return true
  }
  // 重试一次：先删掉可能残留的坏文件（目标被换成目录时能稳定复现读回不一致）
  await rm(cachePath(bid, cid))
  const r2 = await writeFileV(cachePath(bid, cid), body)
  if (r2.ok) markCacheDirty()
  return !!r2.ok
}

export async function cachedCids(bid) {
  const list = await readdir(bookDir(bid))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const m = String(name).match(/(\d+)\.txt$/)
    if (m) out.push(m[1])
  }
  return out
}

export async function countCached(bid) {
  return (await cachedCids(bid)).length
}

export async function listBookDirs() {
  const list = await readdir(cacheRoot())
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const s = String(name)
    if (s.charAt(0) === '.' || s.indexOf('/') >= 0) continue
    out.push(s)
  }
  return out
}

// 旧版遗留在书目录下的 toc_<页>.html
export async function legacyTocPages(bid) {
  const list = await readdir(bookDir(bid))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const m = String(name).match(/^toc_(\d+)\.html$/)
    if (m) out.push(parseInt(m[1], 10))
  }
  return out
}

// du -sk 取目录体积（KB），失败返回 0
export async function dirKB(p) {
  const tmp = dataDir + '/.du.tmp'
  await rm(tmp)
  sh("du -sk '" + p + "' 2>/dev/null | cut -f1 > '" + tmp + "'")
  const s = await readFile(tmp)
  await rm(tmp)
  const n = parseInt(String(s || '0').trim(), 10)
  return isNaN(n) ? 0 : n
}

// 一次 shell 扫完整个书库。
// 老实现每本书跑 3 条命令（du 整本、ls|wc 数正文、du toc），20 本书就是 60 次 fork，
// 书架一刷就是几秒；现在固定 1 条命令、3 个 fork，结果在 JS 里汇总。
async function scanCache() {
  const f = dataDir + '/.scan.tmp'
  await rm(f)
  const root = cacheRoot()
  sh(
    "cd '" + root + "' && { " +
      "du -sb */ 2>/dev/null | sed 's/^/B /'; " +
      "du -sb */toc 2>/dev/null | sed 's/^/T /'; " +
      "find . -mindepth 2 -maxdepth 2 -name '*.txt' 2>/dev/null | sed 's/^/F /'; " +
      "} > '" + f + "' 2>/dev/null"
  )
  const s = await readFile(f)
  await rm(f)
  const map = {}
  const get = function (bid) {
    if (!map[bid]) map[bid] = { bytes: 0, tocBytes: 0, count: 0 }
    return map[bid]
  }
  const lines = String(s || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].replace(/\s+$/, '')
    if (ln.length < 3) continue
    const tag = ln.charAt(0)
    const rest = ln.slice(1).replace(/^\s+/, '')
    if (tag === 'F') {
      const seg = rest.split('/')
      if (seg.length < 3) continue
      const bid = seg[seg.length - 2]
      if (!bid || bid.charAt(0) === '.') continue
      get(bid).count++
      continue
    }
    if (tag !== 'B' && tag !== 'T') continue
    const m = rest.match(/^(\d+)\s+(.*)$/)
    if (!m) continue
    const num = parseInt(m[1], 10)
    const path = m[2].replace(/\/+$/, '')
    const seg = path.split('/')
    const bid = tag === 'T' ? seg[seg.length - 2] : seg[seg.length - 1]
    if (!bid || bid.charAt(0) === '.') continue
    if (tag === 'B') get(bid).bytes = isNaN(num) ? 0 : num
    else get(bid).tocBytes = isNaN(num) ? 0 : num
  }
  return map
}

// 从本地目录缓存反推总章数：目录文本首行是 T|总章数|书名。
// openShelfBook 不能再无条件相信 meta.total——抓目录失败时它会被写成 0 并永久卡死。
export async function tocMeta(bid) {
  const pages = await tocPages(bid)
  let total = 0
  let title = ''
  for (let i = 0; i < pages.length; i++) {
    const t = await readTocTxt(bid, pages[i])
    if (!t) continue
    const first = String(t).split('\n')[0] || ''
    if (first.charAt(0) === 'T' && first.charAt(1) === '|') {
      const p = first.split('|')
      const n = parseInt(p[1], 10) || 0
      if (n > total) total = n
      if (!title && p[2]) title = p[2]
    }
  }
  return { total: total, pages: pages.length, title: title }
}

export async function tocPages(bid) {
  const list = await readdir(tocDir(bid))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const name = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!name) continue
    const m = String(name).match(/(\d+)\.txt$/)
    if (m) out.push(parseInt(m[1], 10))
  }
  out.sort(function (a, b) {
    return a - b
  })
  return out
}

// 书架统计的缓存：一次扫描要 fork shell，反复进出书架没必要每次都扫。
// 章节写入 / 删书 / 清空会 markCacheDirty()，保证数字不会骗人。
let sumCache = null
let cacheGen = 0

export function markCacheDirty() {
  cacheGen++
}

export async function cacheSummary(force) {
  const now0 = Date.now()
  if (!force && sumCache && sumCache.gen === cacheGen && now0 - sumCache.at < 45000) return sumCache.value
  const value = await buildSummary()
  sumCache = { at: Date.now(), gen: cacheGen, value: value }
  return value
}

async function buildSummary() {
  const scanned = await scanCache()
  const books = await readdir(cacheRoot())
  let chapters = 0
  let bookCount = 0
  let tocKB = 0
  let bodyKB = 0
  let totalBytes = 0
  const items = []
  for (let i = 0; i < books.length; i++) {
    const d = books[i]
    // 老代码只认 d.name，某些固件 readdir 返回的是 {path:...}，书就整本消失
    const bid = typeof d === 'string' ? d : d && (d.name || d.path)
    if (!bid) continue
    const s = String(bid).replace(/\/+$/, '')
    const slash = s.lastIndexOf('/')
    const name = slash >= 0 ? s.slice(slash + 1) : s
    if (!name || name.charAt(0) === '.') continue
    const sc = scanned[name] || { bytes: 0, tocBytes: 0, count: 0 }
    let count = sc.count
    if (!count) count = (await cachedCids(name)).length
    const bytes = sc.bytes || 0
    const tbytes = Math.min(bytes, sc.tocBytes || 0)
    const bbytes = Math.max(0, bytes - tbytes)
    tocKB += Math.round(tbytes / 1024)
    bodyKB += Math.round(bbytes / 1024)
    totalBytes += bytes
    let title = name
    let author = ''
    let total = 0
    const meta = await readFile(bookDir(name) + '/meta.json')
    if (meta) {
      try {
        const m = JSON.parse(meta)
        title = m.title || name
        author = m.author || ''
        total = m.total || 0
      } catch (e) {}
    }
    // 只有目录没有正文的书也要列出来：
    // 用户点了「缓存」就应该看得到结果，藏起来只会让人以为缓存没生效
    bookCount++
    if (count > 0) chapters += count
    items.push({
      bid: name,
      title: title,
      author: author,
      total: total,
      count: count,
      kb: Math.round(bbytes / 1024),
      bytes: bbytes,
      tocKB: Math.round(tbytes / 1024),
      onlyToc: count === 0
    })
  }
  // 已下载章节多的排前面；章节数相同的按体积降序，避免顺序随机跳动
  items.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count
    return b.bytes - a.bytes
  })
  return {
    books: bookCount,
    chapters: chapters,
    kb: Math.round(totalBytes / 1024),
    bytes: totalBytes,
    tocKB: tocKB,
    bodyKB: bodyKB,
    items: items
  }
}

// /userdisk 剩余空间（KB）。书架要告诉用户「还能存多少」，否则只会一直下到写不进去
let freeCacheAt = 0
let freeCacheVal = 0

export async function freeKB() {
  // 一个 shell fork 只为了读一行数字，8 秒内重复刷新书架直接复用
  if (freeCacheAt && Date.now() - freeCacheAt < 8000) return freeCacheVal
  const tmp = dataDir + '/.df.tmp'
  await rm(tmp)
  sh("df -k /userdisk 2>/dev/null | tail -1 | awk '{print $4}' > '" + tmp + "'")
  const s = await readFile(tmp)
  await rm(tmp)
  const n = parseInt(String(s || '0').trim(), 10)
  freeCacheVal = isNaN(n) ? 0 : n
  freeCacheAt = Date.now()
  return freeCacheVal
}

// 按需诊断：把「这条路径能不能建目录 / 能不能 shell 写」逐条问出来。
// 只在调试指令里调用，平时不跑。
export async function pathProbe(dir) {
  const d = normPath(dir)
  const out = { dir: d }
  try {
    out.mkPath = await mkPath(d)
    out.exists = await exists(d)
    out.t1 = !!sh(": > '" + d + "/.p1' 2>/dev/null")
    out.t2 = !!sh("printf '%s' 'eA==' | base64 -d > '" + d + "/.p2' 2>/dev/null")
    out.t2size = await exists(d + '/.p2')
    out.mk = !!sh("mkdir -p '" + d + "/.pp' 2>/dev/null")
    out.mkSeen = await exists(d + '/.pp')
    out.w = await writeFileV(d + '/.pp/t.txt', 'probe-ok')
    out.shFail = writeDiag().shFail
    out.channel = writeDiag().channel
    sh("rm -f '" + d + "/.p1' '" + d + "/.p2' 2>/dev/null")
    sh("rm -rf '" + d + "/.pp' 2>/dev/null")
  } catch (e) {
    out.err = String((e && e.message) || e)
  }
  return out
}

// ---------- 读写自检 ----------
// 设置页「自检」用它：这台设备到底能不能落盘、哪一层断了，直接给用户看。
// 每条都真写真读，不看返回值——平台的写接口报成功不等于落盘。
export async function selfCheck() {
  const rows = []
  const push = function (k, ok, v) {
    rows.push({ k: k, ok: !!ok, v: String(v) })
  }

  // 1) 数据目录：写 → 读回比对（失败重试一次：启动瞬间的 shell 抖动不该算故障）
  try {
    const p = dataDir + '/.selftest'
    const want = 'ok-' + Date.now()
    let r = await writeFileV(p, want)
    if (!r.ok) r = await writeFileV(p, want + '-r')
    push('数据目录', r.ok, r.ok ? '写入并读回正常' : r.why)
    await rm(p)
  } catch (e) {
    push('数据目录', false, '异常 ' + ((e && e.message) || e))
  }

  // 2) 书库根目录：逐级建 + 写 + 读回（下载正文就落这里）
  try {
    const dir = cacheRoot() + '/.probe/a/b'
    let made = await mkPath(dir)
    if (!made) made = await mkPath(dir)
    const p = dir + '/t.txt'
    const want = 'probe-' + Date.now()
    let r = made ? await writeFileV(p, want) : { ok: false, why: '目录建不出来' }
    if (made && !r.ok) r = await writeFileV(p, want + '-r')
    push('书库目录', r.ok, r.ok ? '可读写' : r.why + ' · ' + cacheRoot())
    sh("rm -rf '" + cacheRoot() + "/.probe' 2>/dev/null")
  } catch (e) {
    push('书库目录', false, '异常 ' + ((e && e.message) || e))
  }

  // 3) 逐级建目录（父目录不存在时 writeFile 会静默不落盘）
  try {
    const deep = cacheRoot() + '/.probe2/x/y'
    let made = await mkPath(deep)
    if (!made) made = await mkPath(deep)
    const list = await readdirRaw(deep)
    push('逐级建目录', made && !!list, made && list ? '三层目录可建' : '建不出来')
    sh("rm -rf '" + cacheRoot() + "/.probe2' 2>/dev/null")
  } catch (e) {
    push('逐级建目录', false, '异常')
  }

  // 4) 键值通道（$falcon.jsapi.storage）：设置文件的第二条通道
  if (!storageAvailable()) {
    push('键值通道', false, '不可用（只靠文件通道）')
  } else {
    const k = 'booksea_probe'
    const want = 'kv-' + Date.now()
    const w = await storageSet(k, want)
    const g = await storageGet(k)
    const info = await storageInfo()
    const good = w && String(g || '') === want
    let extra = ''
    if (info && info.keys) extra = ' · 键数 ' + (info.keys.length || 0)
    push('键值通道', good, good ? '可读写' + extra : '写入' + (w ? '成功' : '失败') + ' · 读回' + (g ? '不一致' : '为空'))
  }

  // 5) 缓存正文抽查：挑一本真有正文的书读一章。
  // 只有目录的书（还没下正文）跳过；整库都没正文不算失败——那不是坏了，是还没下。
  try {
    const books = await readdir(cacheRoot())
    let checked = ''
    let ok = true
    for (let i = 0; i < books.length && !checked; i++) {
      const b = books[i]
      const name = typeof b === 'string' ? b : b && (b.name || b.path)
      if (!name) continue
      const bid = String(name).replace(/\/+$/, '').split('/').pop()
      if (!bid || bid.charAt(0) === '.') continue
      const cids = await cachedCids(bid)
      if (!cids.length) continue
      const txt = await readCache(bid, cids[0])
      ok = !!(txt && String(txt).length > 80)
      checked = bid + ' 抽查 1 章 ' + (txt ? String(txt).length + 'B' : '读不到')
    }
    push('缓存正文', ok, checked || '暂无正文可抽查（下载后自动校验）')
  } catch (e) {
    push('缓存正文', false, '异常')
  }

  // 6) 剩余空间
  try {
    const kb = await freeKB()
    const mb = Math.round(kb / 1024)
    push('剩余空间', kb > 1024 * 50, mb + ' MB')
  } catch (e) {
    push('剩余空间', false, '读不到')
  }

  // 7) 写通道：说明这次写在走哪条路（fs 直写 / fs 不可用时的 shell 通道）。
  //    真正「能不能落盘」由第 1、2 项读写比对决定，所以这里只在 shell 也失败时才算异常。
  try {
    const d = writeDiag()
    const bad = !!d.fsErr && d.shFail > 0
    let v = ''
    if (!d.fsErr) v = 'fs 直写'
    else v = 'shell 通道（本机 fs 无 writeFile）' + (d.shFail ? ' · 失败 ' + d.shFail : '')
    push('写通道', !bad, v)
  } catch (e) {
    push('写通道', false, '未知')
  }

  let pass = 0
  for (let i = 0; i < rows.length; i++) if (rows[i].ok) pass++
  return { rows: rows, pass: pass, total: rows.length, dataDir: dataDir, booksRoot: cacheRoot() }
}

export async function removeBook(bid) {
  await rm(bookDir(bid))
  markCacheDirty()
  return true
}

export async function clearCache() {
  const n = nameCount(await readdir(cacheRoot()))
  await rm(cacheRoot())
  await mkPath(cacheRoot())
  markCacheDirty()
}

// ---------- 状态 ----------

export function statePath() {
  return dataDir + '/state.json'
}

// 状态（字号/阅读位置/待续下载）走双通道：文件优先，坏了回退 storage 镜像。
// 冷启动首次读盘常常失败，这里给重试，否则用户会觉得「设置自己变回去了」。
export async function loadState() {
  const r = await loadBoth('booksea_state', statePath())
  if (!r.value) return null
  try {
    const o = JSON.parse(r.value)
    if (o && typeof o === 'object') {
      o.__from = r.from
      return o
    }
    return null
  } catch (e) {
    return null
  }
}

export async function saveState(obj) {
  const txt = JSON.stringify(obj)
  const r = await saveBoth('booksea_state', statePath(), txt)
  return r.file
}

// ---------- 多书源抓取（v1.2）----------
// 与 fetchBg/fetchSync 的区别：请求是「对象」（可能是 POST + body + 自定义头），
// 书源站点大量用 POST 搜索（帝国CMS/杰奇/自建 API），GET 拿不到结果。
// 仍然走 curl：设备没有 fetch/XHR，execShell + curl 是唯一可靠通道。

function shQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'"
}

// 请求对象 → curl 参数串
// ---------- Cookie（登录态持久化） ----------
// 为什么要自己做：设备上没有浏览器内核，拿不到站点的 Cookie 罐，
// 只能让用户把站点登录后的 Cookie 字符串粘进来，存成本地配置，
// 再按域名自动附加到该站的每个请求上（搜索/详情/目录/正文都要带，
// 少带一个就会出现「搜索能出、正文要登录」的怪现象）。
// 注意：Cookie 属于账号凭据，只落本地 conf/cookies.json，绝不写进书源文件。
let COOKIE_MAP = null

async function ensureCookies() {
  if (COOKIE_MAP) return COOKIE_MAP
  COOKIE_MAP = {}
  try {
    const o = await loadJsonConf('cookies.json')
    if (o && o.map && typeof o.map === 'object') COOKIE_MAP = o.map
  } catch (e) {}
  return COOKIE_MAP
}

function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/:?#]+)/i)
  return m ? m[1].toLowerCase() : ''
}

// 域名匹配：精确 + 父域（www.a.com 能用 a.com 的 Cookie）
function cookieForUrl(url) {
  if (!COOKIE_MAP) return ''
  const h = hostOf(url)
  if (!h) return ''
  let hit = COOKIE_MAP[h]
  if (hit && hit.cookie) return hit.cookie
  const parts = h.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts.slice(i).join('.')
    const v = COOKIE_MAP[p]
    if (v && v.cookie) return v.cookie
  }
  return ''
}

export async function saveCookie(host, cookie, note) {
  await ensureCookies()
  const h = String(host || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  if (!h) return false
  if (!cookie) delete COOKIE_MAP[h]
  else COOKIE_MAP[h] = { cookie: String(cookie), note: String(note || ''), savedAt: Date.now() }
  try {
    await saveJsonConf('cookies.json', { map: COOKIE_MAP })
    return true
  } catch (e) {
    return false
  }
}

export async function cookieOf(host) {
  const m = await ensureCookies()
  const h = String(host || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  return m[h] ? m[h].cookie : ''
}

export async function cookieList() {
  const m = await ensureCookies()
  const out = []
  for (const k in m) out.push({ host: k, len: String(m[k].cookie || '').length, savedAt: m[k].savedAt || 0, note: m[k].note || '' })
  return out
}

// 请求体哈希（FNV-1a 32 位）：给临时文件起唯一名字，避免并发写同一个 .reqbody
function fnv(str) {
  let h = 0x811c9dc5
  const t = String(str == null ? '' : str)
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16)
}

function curlOfReq(req, out, timeout) {
  const t = timeout || 20
  const a = ['curl -k -s --compressed', '-m ' + t, "-A " + shQuote(req.ua || UA)]
  const hs0 = req.headers || {}
  const hasCT = Object.keys(hs0).some(function (k) { return /^content-type$/i.test(k) })
  if (req.method && String(req.method).toUpperCase() === 'POST') {
    a.push('-X POST')
    if (req.body) {
      // 用内容哈希做文件名：并发抓多个章节时固定 .reqbody 会互相覆盖，
      // 表现是"偶发拿到别人的正文"（离线整本下载会串章）
      const bf = dataDir + '/.rq_' + fnv(req.body)
      shWriteFile(bf, req.body)
      a.push('--data-binary @' + shQuote(bf))
    }
    // 有 JSON 接口的书源（轻之国度新 API 等）自己带 Content-Type，
    // 这里再补一个 form-urlencoded 会把请求变成两份 Content-Type → 站点直接 400
    if (!hasCT) a.push("-H 'Content-Type: application/x-www-form-urlencoded'")
  } else {
    // GET 跟随跳转：书源站点大量 http→https→www 两级跳，
    // 不跟随会把 301 的空响应当成"站点没内容"（CDN 镜像也有 301 的）
    a.push('-L')
    a.push('--max-redirs 4')
  }
  const hs = req.headers || {}
  let hasCookie = false
  for (const k in hs) {
    if (!Object.prototype.hasOwnProperty.call(hs, k)) continue
    if (hs[k] == null) continue
    if (/^cookie$/i.test(k)) hasCookie = true
    a.push('-H ' + shQuote(k + ': ' + hs[k]))
  }
  if (!hasCookie) {
    const ck = cookieForUrl(req.url)
    if (ck) a.push('-H ' + shQuote('Cookie: ' + ck))
  }
  if (req.referer) a.push('-e ' + shQuote(req.referer))
  a.push('-o ' + shQuote(out))
  a.push(shQuote(req.url))
  return a.join(' ')
}

// 同步抓一个请求对象
export async function fetchReqSync(req, out, timeout) {
  await ensureCookies()
  sh(curlOfReq(req, out, timeout))
  let s = await readFile(out)
  if (s == null) return null
  if (req && /gbk|gb2312|gb18030/i.test(String(req.charset || ''))) {
    const u = out + '.u8'
    sh("iconv -f gbk -t utf-8 " + shQuote(out) + " > " + shQuote(u) + " 2>/dev/null")
    const u8 = await readFile(u)
    await rm(u)
    if (u8) s = u8
  }
  return s
}

// 后台抓 + 等落地（与页面里的 fetchUrl 同语义，但支持 POST）
export async function fetchReq(req, out, timeout) {
  await ensureCookies()
  const t = timeout || 20
  const ok = out + '.rok'
  await rm(ok)
  await rm(out)
  sh("(" + curlOfReq(req, out, t) + "; touch " + shQuote(ok) + ") >/dev/null 2>&1 &")
  const done = await waitFile(ok, t * 1000 + 3000)
  await rm(ok)
  if (!done) return null
  let s = await readFile(out)
  if (s == null) return null
  if (req && /gbk|gb2312|gb18030/i.test(String(req.charset || ''))) {
    const u = out + '.u8'
    sh("iconv -f gbk -t utf-8 " + shQuote(out) + " > " + shQuote(u) + " 2>/dev/null")
    const u8 = await readFile(u)
    await rm(u)
    if (u8) s = u8
  }
  return s
}

// 带状态码/耗时/字节数的抓取。
// 为什么单独开一个：CDN 测速必须拿到真实 HTTP 码与 TTFB，
// 只凭「返回了内容」会把 403/429 的拦截页当成成功。
export async function fetchReqEx(req, out, timeout) {
  await ensureCookies()
  const t = timeout || 20
  const ok = out + '.rok'
  const cf = out + '.code'
  await rm(ok)
  await rm(out)
  await rm(cf)
  sh(
    '(' +
      curlOfReq(req, out, t) +
      " -w '%{http_code} %{time_total} %{size_download}' > " +
      shQuote(cf) +
      '; touch ' +
      shQuote(ok) +
      ') >/dev/null 2>&1 &'
  )
  const done = await waitFile(ok, t * 1000 + 3000)
  await rm(ok)
  if (!done) return { text: null, code: 0, ms: 0, size: 0, error: '超时' }
  const cs = String((await readFile(cf)) || '').trim()
  await rm(cf)
  const p = cs.split(/\s+/)
  const code = parseInt(p[0], 10) || 0
  const secs = parseFloat(p[1]) || 0
  const size = parseInt(p[2], 10) || 0
  let text = await readFile(out)
  if (text == null) text = ''
  if (req && /gbk|gb2312|gb18030/i.test(String(req.charset || ''))) {
    const u = out + '.u8'
    sh('iconv -f gbk -t utf-8 ' + shQuote(out) + ' > ' + shQuote(u) + ' 2>/dev/null')
    const u8 = await readFile(u)
    await rm(u)
    if (u8) text = u8
  }
  return { text: text, code: code, ms: Math.round(secs * 1000), size: size, error: code ? '' : '连接失败' }
}

// 单站点连通性探测（多源下不能再用写死的 SITE 判断整机在线）
export async function probeUrl(url) {
  const f = dataDir + '/.net2'
  await rm(f)
  sh("curl -s -o /dev/null -w '%{http_code}' --connect-timeout 4 -m 6 -A " + shQuote(UA) + " " + shQuote(url) + " > " + shQuote(f) + " 2>/dev/null; echo ' RC='$? >> " + shQuote(f))
  const s = String((await readFile(f)) || '')
  await rm(f)
  const code = parseInt(s, 10) || 0
  const m = s.match(/RC=(\d+)/)
  const rc = m ? parseInt(m[1], 10) : -1
  if (code >= 100) return true
  if (rc === 28 || rc === 56 || rc === -1) return null
  return false
}

// ---------- 书源 / CDN 配置存取 ----------
// 这两个文件必须跨启动保留：交给 saveBoth（文件 + storage 镜像）+ 写后读回。

export function confPath(name) {
  return dataDir + '/' + name
}

export async function saveJsonConf(name, obj) {
  const txt = JSON.stringify(obj)
  const r = await saveBoth('booksea_' + name.replace(/\W/g, '_'), confPath(name), txt)
  return r.file
}

export async function loadJsonConf(name) {
  const r = await loadBoth('booksea_' + name.replace(/\W/g, '_'), confPath(name))
  if (!r.value) return null
  try {
    return JSON.parse(r.value)
  } catch (e) {
    return null
  }
}

// ---------- 屏幕尺寸 ----------
// 上架全设备后，同一份代码会跑在逻辑分辨率不同的机型上（936×280 / 960×266 …）。
// 官方文档给的是 $falcon.env.deviceWidth/deviceHeight，但有的固件把宽高报成竖屏
// 顺序（280×936），归一交给 geo.normScreen。取不到就返回 0，调用方回退设计稿。
export function screenSize() {
  let w = 0
  let h = 0
  try {
    const env = (typeof $falcon !== 'undefined' && $falcon && $falcon.env) || {}
    w = env.deviceWidth || env.width || 0
    h = env.deviceHeight || env.height || 0
  } catch (e) {}
  if (!w || !h) {
    try {
      const gg = (typeof g !== 'undefined' && g) || {}
      w = w || gg.deviceWidth || 0
      h = h || gg.deviceHeight || 0
    } catch (e) {}
  }
  return { w: Number(w) || 0, h: Number(h) || 0 }
}

// 环境自述：$falcon.env 到底给了什么、屏幕尺寸取到多少、fs 有哪些方法。
// 全设备适配就靠这份现场数据，别再靠文档猜。
export function envDump() {
  const o = { screen: screenSize(), keys: [], env: {}, falconKeys: [], fsKeys: [], fsKind: typeof fs }
  try {
    const env = (typeof $falcon !== 'undefined' && $falcon && $falcon.env) || {}
    o.keys = Object.keys(env)
    for (let i = 0; i < o.keys.length; i++) {
      const k = o.keys[i]
      try {
        const v = env[k]
        const t = typeof v
        if (t !== 'function' && t !== 'object') o.env[k] = v
        else if (t === 'object' && v && (Array.isArray(v) || Object.keys(v).length < 12)) o.env[k] = v
      } catch (e) {}
    }
    o.falconKeys = typeof $falcon !== 'undefined' && $falcon ? Object.keys($falcon) : []
  } catch (e) {
    o.envErr = String((e && e.message) || e)
  }
  try {
    o.fsKeys = fs && typeof fs === 'object' ? Object.keys(fs).slice(0, 40) : []
  } catch (e) {}
  return o
}
