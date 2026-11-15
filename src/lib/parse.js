// 纯函数：书海阁页面解析
// 只处理字符串，不碰网络与文件

const ENT = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

export function decode(s) {
  let out = String(s == null ? '' : s)
  out = out.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENT[m] || m)
  out = out.replace(/&#(\d+);/g, (m, d) => {
    const n = parseInt(d, 10)
    return n > 0 && n < 65536 ? String.fromCharCode(n) : m
  })
  return out
}

export function stripTags(s) {
  return decode(String(s == null ? '' : s).replace(/<[^>]*>/g, ''))
}

export function tidy(s) {
  return stripTags(s)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- 搜索 ----------

export function parseSearch(html) {
  const out = []
  const src = String(html || '')
  const re = /<article[^>]*class="[^"]*classBookCard[^"]*"[^>]*>([\s\S]*?)<\/article>/g
  let m
  const seen = {}
  while ((m = re.exec(src))) {
    const card = m[1]
    const cover = card.match(
      /class="classBookCoverLink"[^>]*href="\/book\/(\d+)\.html"[^>]*title="([^"]*)"/
    ) || card.match(/href="\/book\/(\d+)\.html"[^>]*title="([^"]*)"/)
    if (!cover) continue
    const bid = cover[1]
    if (seen[bid]) continue
    seen[bid] = 1
    const titleM = card.match(/class="classBookTitle"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)
    const authorM = card.match(/class="classBookAuthor"[^>]*>([\s\S]*?)<\/p>/)
    const metaM = card.match(/class="classBookMeta"[^>]*>([\s\S]*?)<\/p>/)
    const descM = card.match(/class="classBookDesc"[^>]*>([\s\S]*?)<\/p>/)
    const lastM = card.match(/class="classBookChapter"[^>]*>([\s\S]*?)<\/p>/)
    let author = tidy(authorM ? authorM[1] : '').replace(/^作者[:：]\s*/, '')
    out.push({
      bid: bid,
      title: tidy(titleM ? titleM[1] : cover[2]) || tidy(cover[2]),
      author: author,
      meta: tidy(metaM ? metaM[1] : ''),
      desc: tidy(descM ? descM[1] : ''),
      last: tidy(lastM ? lastM[1] : '')
    })
    if (out.length >= 60) break
  }
  return out
}

// ---------- 目录 ----------

export function parseToc(html, bid) {
  const src = String(html || '')
  const totalM = src.match(/共\s*(\d+)\s*章/)
  const total = totalM ? parseInt(totalM[1], 10) : 0

  // 书名：<meta name="keywords" content="书海阁,我不是戏神,章节目录,最新章节">
  let title = ''
  const tm = src.match(/<meta\s+name="keywords"\s+content="书海阁,([^,]+),章节目录/)
  if (tm) title = tidy(tm[1])

  const chapters = []
  const seen = {}
  const re = new RegExp('href="/book/' + bid + '/(\\d+)\\.html"[^>]*>([\\s\\S]*?)<\\/a>', 'g')
  let m
  while ((m = re.exec(src))) {
    const cid = m[1]
    if (seen[cid]) continue
    // 去掉 <i>[免费]</i> 这类角标，只留章节名
    const title = tidy(String(m[2]).replace(/<i[^>]*>[\s\S]*?<\/i>/g, ''))
    if (!title) continue
    seen[cid] = 1
    chapters.push({ cid: cid, title: title })
    if (chapters.length >= 500) break
  }
  return { total: total, chapters: chapters, title: title }
}

export function parseTocPageNo(html) {
  const m = String(html || '').match(/\/book\/indexList\/\d+\/(\d+)\.html/)
  return m ? parseInt(m[1], 10) : 1
}

// 目录页压缩存储：整页 HTML 124KB，压成「cid|章节名」每章一行只有 4KB 左右
// 首行 T|总章数|书名，其余行 cid|title
// 第三方书源（Legado）的章节地址不是由 bid+cid 拼出来的，必须跟着目录一起存：
// 第三段是 url（可为空，原生源三端一致就不写）
export function tocToText(parsed) {
  const p = parsed || {}
  const lines = ['T|' + (p.total || 0) + '|' + String(p.title || '').replace(/[|\r\n]/g, ' ')]
  const chs = p.chapters || []
  for (let i = 0; i < chs.length; i++) {
    let ln = chs[i].cid + '|' + String(chs[i].title || '').replace(/[|\r\n]/g, ' ')
    if (chs[i].url) ln += '|' + String(chs[i].url).replace(/[|\r\n]/g, '')
    lines.push(ln)
  }
  return lines.join('\n')
}

export function tocFromText(text) {
  const src = String(text || '')
  const out = { total: 0, title: '', chapters: [] }
  if (!src) return out
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (!ln) continue
    if (ln.charAt(0) === 'T' && ln.charAt(1) === '|') {
      const p = ln.split('|')
      out.total = parseInt(p[1], 10) || 0
      out.title = p[2] || ''
      continue
    }
    const k = ln.indexOf('|')
    if (k <= 0) continue
    const cid = ln.slice(0, k)
    if (!/^\d+$/.test(cid)) continue
    const rest = ln.slice(k + 1)
    const k2 = rest.indexOf('|')
    if (k2 >= 0) out.chapters.push({ cid: cid, title: rest.slice(0, k2), url: rest.slice(k2 + 1) })
    else out.chapters.push({ cid: cid, title: rest })
  }
  return out
}

// ---------- 正文 ----------

const JUNK = [
  '请记住本站',
  '最新网址',
  '手机用户请',
  '本章未完',
  '加入书签',
  '章节错误',
  '举报',
  'app下载',
  'APP下载',
  '笔趣阁',
  '书海阁小说网',
  '一秒记住',
  '无弹窗',
  '全文阅读尽在',
  '请收藏本站'
]

function isJunk(s) {
  for (let i = 0; i < JUNK.length; i++) if (s.indexOf(JUNK[i]) >= 0) return true
  if (s.length <= 2 && /^[-—=*·.。，、\s]+$/.test(s)) return true
  return false
}

export function parseChapter(html, fallbackTitle) {
  const src = String(html || '')
  let title = ''
  const t1 = src.match(/id="indexName"[^>]*>([\s\S]*?)<\/span>/)
  if (t1) title = tidy(t1[1])
  if (!title) {
    const t2 = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
    if (t2) title = tidy(t2[1])
  }
  if (!title) title = tidy(fallbackTitle || '')

  let body = ''
  const bi = src.indexOf('readChapterAppendBody')
  if (bi >= 0) {
    const gt = src.indexOf('>', bi)
    let end = src.indexOf('</section>', gt)
    if (end < 0) end = Math.min(src.length, gt + 400000)
    body = src.slice(gt + 1, end)
  } else {
    body = src
  }

  const paras = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g
  let m
  while ((m = re.exec(body))) {
    const t = tidy(m[1])
    if (!t) continue
    if (isJunk(t)) continue
    paras.push(t)
  }

  // 去掉与标题重复的开头段（"第1章" / "戏鬼回家"）
  const norm = title.replace(/\s/g, '')
  let guard = 0
  while (paras.length && guard < 3) {
    const q = paras[0].replace(/\s/g, '')
    if (q && norm && norm.indexOf(q) >= 0 && q.length >= norm.length * 0.3) {
      paras.shift()
      guard++
    } else break
  }

  const text = paras.join('\n')
  return { title: title, paras: paras, chars: text.length }
}

// 昵称式截断：目录里显示用
export function shortChapterTitle(t, maxLen) {
  const s = String(t || '')
  const n = maxLen || 14
  return s.length > n ? s.slice(0, n) + '…' : s
}
