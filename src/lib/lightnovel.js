// 轻小说专用书源适配器
//
// 为什么单独一个文件：
//   日轻站点的书源几乎全是「@js 拼 POST JSON 打站点私有 API」的写法（见 lk-new-api.json），
//   本项目的 Legado 兼容层是纯选择器解释器、没有 JS 引擎，一条也跑不了。
//   这些 API 的请求体和返回结构其实都是固定的，与其做 JS 解释器，不如把每个站点
//   的接口写成一小段声明式代码——这就是本文件的定位。
//
// 约定：
//   - 每个站点导出 { id, name, base, api, login, note, need: {...}, build: {...} }
//     build.search(kw,page) -> req        返回 { method,url,body,headers }
//     build.detail(bookId)  -> req
//     build.toc(bookId,page) -> req
//     build.chapter(bookId,chapterId) -> req
//     parse.search(text)      -> Book[]
//     parse.detail(text)      -> Book
//     parse.toc(text)         -> { list, hasNext }
//     parse.chapter(text)     -> string
//   - 所有 parse 都是纯函数，不碰网络，方便单测与真机复用。
//   - 书籍地址统一用「自解释 URL」（/book/123、/book/123/chapter/456），
//     这样目录缓存落盘后重启不用额外 vars 也能重建请求。

import { stripTags, tidy } from './parse.js'

// ---------- HTML → 纯文本（正文用） ----------
// 关键点：不能整篇 tidy()——tidy 会把 \s+ 压成空格，段落全糊成一行
// （轻之国度第一章 25080 字实测被压成 2 行）。必须逐块提取再 \n 连接。
export function htmlToText(html) {
  let s = String(html == null ? '' : html)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  // 轻小说正文大量用 <ruby>漢字<rt>かんじ</rt></ruby> 注音：rt/rp 是读音，不能混进正文
  s = s.replace(/<rt[\s\S]*?<\/rt>/gi, '')
  s = s.replace(/<rp[\s\S]*?<\/rp>/gi, '')
  // 插图：当前设备只能显示文字，用标记占位，至少让读者知道这里原本有图
  s = s.replace(/<img[^>]*>/gi, '[插图]')

  const paras = []
  const re = /<(p|div|h[1-6]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(s))) {
    const inner = m[2]
    // 块里套块（div>p）时只取最内层文本，避免重复；
    // 块内的 <br> 自己就是换行，必须先切开再逐段 tidy，
    // 否则 tidy 的 \s+ → 空格会把「一<br>二」压成一行。
    const parts = inner.split(/<br\s*\/?>/i)
    for (let k = 0; k < parts.length; k++) {
      const t = tidy(parts[k])
      if (t) paras.push(t)
    }
  }
  if (!paras.length) {
    // 没有块级标签的站点：按 <br> 切
    const parts = s.split(/<br\s*\/?>/i)
    for (let i = 0; i < parts.length; i++) {
      const t = tidy(parts[i])
      if (t) paras.push(t)
    }
  }
  return paras.join('\n')
}

function jparse(text) {
  try {
    return JSON.parse(String(text == null ? '' : text))
  } catch (e) {
    return null
  }
}

// 简介清洗。
// 真机实测（书 ID 1339「同为败犬…」）：站点把 summary 截到 100 字符，
// 常常切在 HTML 标签中间，于是简介里混进「[font=webfont, 微软雅黑, "Microso」这种残片，
// 在设备上会当成正文显示出来。这段不是内容，砍掉。
// 只匹配以 CSS 属性名开头的残片，避免误伤简介里正常的方括号。
export function cleanIntro(s) {
  let t = String(s == null ? '' : s)
  t = t.replace(/<[^>]*$/, '') // 结尾处未闭合的标签
  t = t.replace(/\[(?:font|color|size|style|text|background|line)[^\]]*\]?[\s\S]*$/i, '')
  t = t.replace(/[;\s]*(?:font-family|font-size|line-height|font-weight|color)\s*[:=][\s\S]*$/i, '')
  return tidy(t)
}

// ============================================================
// 轻之国度（www.lightnovel.fun）
// 来源依据：Fusn126/lk-book-source 的 lk-new-api.json（新版 API）
// 实测（2026-11-10，直连、无 Cookie）：
//   搜索 200 / 10 条、详情 200、卷目录 200 / 13 卷、章节 200 / 7 章、正文 200 / 25126 字
//   返回字段里有 access_type / locked / coin_price，可据此识别付费与未解锁章节。
// ============================================================
const LK = {
  id: 'lk',
  name: '轻之国度',
  base: 'https://www.lightnovel.fun',
  login: false, // 实测：公开章节不登录也能读；登录后可读到更多锁定章节
  loginNote: '公开章节免登录；锁定/付费章节需要站点登录（Cookie lk_security_key）',
  need: { js: false, cookie: false, webview: false, xpath: false },
  build: {
    search(key, page) {
      const body = {
        q: String(key || ''),
        scope: '',
        source: '',
        primary_tag: '',
        channel_code: '',
        work_type: '',
        preset: '',
        source_type: '',
        filters: {},
        word_count_bucket: '',
        status_bucket: '',
        // 站点页码从 0 开始（实测 page=0 才有结果，page=1 是第二页）
        page: Math.max(0, Number(page || 1) - 1),
        pageSize: 20,
        sort: 'relevance'
      }
      return LK.post('/api/pc-proxy/api/bff/apk-search-result-v1', body)
    },
    detail(bookId, extra) { return LK.post('/api/pc-proxy/api/new-content-read/get-book-detail', { book_id: String(bookId), with_volumes: 0, security_key: (extra && extra.securityKey) || '' }) },
    toc(bookId, page) { return LK.post('/api/pc-proxy/api/new-content-read/get-book-volumes', { book_id: Number(bookId), page: Number(page || 1), pageSize: 50, page_size: 50 }) },
    chapters(bookId, volumeId, page) {
      return LK.post('/api/pc-proxy/api/new-content-read/get-volume-chapters', {
        book_id: Number(bookId),
        volume_id: Number(volumeId),
        page: Number(page || 1),
        pageSize: 50,
        page_size: 50
      })
    },
    chapter(bookId, chapterId, extra) {
      return LK.post('/api/pc-proxy/api/new-content-read/get-chapter-detail', {
        book_id: String(bookId),
        chapter_id: String(chapterId),
        security_key: (extra && extra.securityKey) || ''
      })
    }
  },
  post(path, body) {
    return {
      method: 'POST',
      url: LK.base + path,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Referer: LK.base + '/',
        Origin: LK.base,
        Accept: 'application/json, text/plain, */*'
      }
    }
  },
  parse: {
    search(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data || !d.data.list) return []
      return d.data.list.map(function (x) {
        const tags = Array.isArray(x.visible_tags) ? x.visible_tags.map(function (t) { return t.tag_name || t.name || t }).filter(Boolean) : []
        return {
          title: x.title || '',
          author: x.author_name || '',
          url: LK.base + '/book/' + x.book_id,
          bid: String(x.book_id),
          intro: cleanIntro(x.summary_short || x.summary || ''),
          cover: x.cover_url || '',
          kind: (x.meta_json && x.meta_json.type) || x.work_type || '轻小说',
          wordCount: x.word_count || 0,
          lastChapter: '',
          updateTime: x.updated_at || '',
          tags: tags,
          sourceId: LK.id
        }
      })
    },
    detail(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data) return null
      const x = d.data
      return {
        name: x.title || '',
        author: x.author_name || '',
        intro: cleanIntro(x.summary || x.summary_short || ''),
        cover: x.cover_url || '',
        tocUrl: LK.base + '/book/' + x.book_id,
        wordCount: x.word_count || 0,
        updateTime: x.updated_at || '',
        // 站点自带 EPUB 字段（实测搜索列表里 epub_ready 均为 0，即当前没有成品文件）
        epubReady: !!x.epub_ready,
        epubUrl: x.epub_download_url || ''
      }
    },
    // 卷列表：返回 { list:[{volumeId,title,chapterCount}], hasNext }
    toc(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data) return { list: [], hasNext: false }
      const list = (d.data.list || []).map(function (v) {
        return {
          volumeId: v.volume_id,
          bookId: v.book_id,
          title: v.title || v.origin_title || '未命名卷',
          chapterCount: v.chapter_count || 0,
          locked: !!v.is_locked
        }
      })
      const pi = d.data.page_info || {}
      return { list: list, hasNext: pi.has_next === 1 || pi.has_next === true, count: pi.count || list.length }
    },
    // 卷内章节
    chapters(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data) return { list: [], hasNext: false }
      const list = (d.data.list || []).map(function (c) {
        return {
          chapterId: c.chapter_id,
          volumeId: c.volume_id,
          bookId: c.book_id,
          title: c.title || '',
          wordCount: c.word_count || 0,
          updateTime: c.updated_at || '',
          // access_type=public 表示公开；coin_price>0 / locked=1 表示要买或要登录
          accessType: c.access_type || '',
          locked: c.locked === 1 || c.unlocked === 0,
          price: c.coin_price || 0
        }
      })
      const pi = d.data.page_info || {}
      return { list: list, hasNext: pi.has_next === 1 || pi.has_next === true }
    },
    chapter(text) {
      const d = jparse(text)
      if (!d) return ''
      if (d.code !== 0 || !d.data) {
        return ''
      }
      const snap = d.data.body_snapshot || {}
      const raw = snap.body_html || snap.body_text || d.data.body_html || d.data.body_text || ''
      return htmlToText(raw)
    },
    // 从正文响应里判断是"要登录/要付费"还是"真的没内容"
    chapterStatus(text) {
      const d = jparse(text)
      if (!d) return { ok: false, reason: '返回不是 JSON（可能被拦截或需要 Cookie）' }
      if (d.code !== 0) return { ok: false, reason: 'code=' + d.code + (d.message ? '，' + d.message : '') }
      const x = d.data || {}
      if (x.locked === 1 || (x.access_type && x.access_type !== 'public')) {
        return { ok: false, needLogin: true, reason: '章节 access_type=' + x.access_type + ' locked=' + x.locked + ' 价 ' + (x.coin_price || 0) }
      }
      const snap = x.body_snapshot || {}
      if (!(snap.body_html || snap.body_text)) return { ok: false, reason: '接口成功但正文为空' }
      return { ok: true }
    }
  }
}

// ============================================================
// 鲸云轻小说（jyapi.jyacg.com）—— 来自 ZWolken 合集的「鲸云轻小说」源
// 原规则同样用 @js 拼请求（lastChapter 里还套了 java.ajax），
// 但它暴露的接口其实很规整，实测（2026-11-10 直连、无 Cookie）：
//   搜索 /web/search?name=&page=&type=1 → data[] 7 条
//   详情 /web/books/detail?id=392       → 书名/作者/简介/总章数
//   目录 /web/books/directory?books_id= → data[].directory[] 扁平章节（带 page/words/is_pay）
//   正文 /web/books/read?page=N&books_id= → content（<p> 段落）+ is_pay/coins
// 章节用 page 号定位（不是 chapter_id），所以 URL 里存的是 page。
// ============================================================
const JY = {
  id: 'jy',
  name: '鲸云轻小说',
  base: 'https://jyapi.jyacg.com',
  login: false,
  loginNote: '免登录可读；is_pay=1 的章节需要站点账号购买，本项目不绕过',
  need: { js: false, cookie: false, webview: false, xpath: false },
  build: {
    search(key, page) {
      return { url: JY.base + '/web/search?name=' + encodeURIComponent(String(key || '')) + '&page=' + (page || 1) + '&type=1', method: 'GET', headers: { Accept: 'application/json' } }
    },
    detail(bookId) {
      return { url: JY.base + '/web/books/detail?id=' + encodeURIComponent(bookId), method: 'GET', headers: { Accept: 'application/json' } }
    },
    toc(bookId) {
      return { url: JY.base + '/web/books/directory?books_id=' + encodeURIComponent(bookId), method: 'GET', headers: { Accept: 'application/json' } }
    },
    chapter(bookId, pageNo) {
      return { url: JY.base + '/web/books/read?page=' + encodeURIComponent(pageNo) + '&books_id=' + encodeURIComponent(bookId), method: 'GET', headers: { Accept: 'application/json' } }
    }
  },
  parse: {
    search(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !Array.isArray(d.data)) return []
      return d.data.map(function (x) {
        return {
          title: x.name || x.title || '',
          author: x.author || '',
          url: JY.base + '/book/' + x.id,
          bid: String(x.id),
          intro: x.intro || '',
          cover: x.cover_image || x.image || '',
          kind: x.serial_status || '轻小说',
          wordCount: x.total_words || 0,
          lastChapter: '',
          updateTime: x.top_time || '',
          sourceId: JY.id
        }
      })
    },
    detail(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data) return null
      const x = d.data
      return {
        name: x.name || x.title || '',
        author: x.author || '',
        intro: x.intro || '',
        cover: x.cover_image || x.image || '',
        tocUrl: JY.base + '/book/' + x.id,
        wordCount: x.total_words || 0,
        updateTime: x.top_time || '',
        lastChapter: x.new_section || '',
        totalChapters: x.total_section_num || 0
      }
    },
    // 扁平章节：一卷到底的站，直接把所有 directory 展开
    toc(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !Array.isArray(d.data)) return { list: [], hasNext: false }
      const out = []
      for (let i = 0; i < d.data.length; i++) {
        const grp = d.data[i]
        const arr = grp.directory || []
        for (let j = 0; j < arr.length; j++) {
          const c = arr[j]
          out.push({ page: c.page, title: c.title || '', words: c.words || 0, pay: c.is_pay === 1, coins: c.section_coins || 0 })
        }
      }
      return { list: out, hasNext: false }
    },
    chapter(text) {
      const d = jparse(text)
      if (!d || d.code !== 0 || !d.data) return ''
      return htmlToText(d.data.content || '')
    },
    chapterStatus(text) {
      const d = jparse(text)
      if (!d) return { ok: false, reason: '返回不是 JSON（可能被拦截）' }
      if (d.code !== 0) return { ok: false, reason: 'code=' + d.code + (d.msg ? '，' + d.msg : '') }
      const x = d.data || {}
      if (x.is_pay === 1 || (x.coins && x.coins > 0)) {
        // 付费章节：站点可能仍返回试读内容，不能当成完整正文
        return { ok: false, needPay: true, reason: '章节付费（' + (x.coins || 0) + ' 币），本项目不绕过' }
      }
      if (!x.content) return { ok: false, reason: '接口成功但正文为空' }
      return { ok: true }
    }
  },
  // 目录一次请求拿全，不需要卷翻页
  async tocAll(bookId, fetchReq) {
    const raw = await fetchReq(JY.build.toc(bookId))
    if (!raw) return []
    const r = JY.parse.toc(raw)
    return r.list.map(function (c) {
      return { cid: String(c.page), title: c.title, url: JY.base + '/book/' + bookId + '/chapter/' + c.page }
    })
  }
}

// ============================================================
// 站点注册表
// 新增站点时只加一项；页面/测试脚本都从这里取。
// ============================================================
export const LN_SITES = [LK, JY]

export function siteOf(id) {
  for (let i = 0; i < LN_SITES.length; i++) if (LN_SITES[i].id === id) return LN_SITES[i]
  return null
}

// 从书籍/章节 URL 反解 id（缓存落盘后重启要用）
export function parseBookUrl(url) {
  const t = String(url || '')
  const m = t.match(/\/book\/(\d+)(?:\/chapter\/(\d+))?/)
  if (!m) return null
  return { bookId: m[1], chapterId: m[2] || '' }
}

// ============================================================
// 统一适配器：给页面与测试脚本同一套方法
// 入参 fetch(req) -> Promise<string|null> 由调用方注入（设备走 curl 后台、PC 走同步 curl）
// ============================================================
export function lnAdapter(id, fetch) {
  const s = siteOf(id)
  if (!s) return null
  const f = fetch
  return {
    id: s.id,
    name: s.name,
    base: s.base,
    kind: 'ln',
    login: s.login,
    need: s.need,

    async search(key, page) {
      const r = await f(s.build.search(key, page || 1))
      if (r == null) return { list: [], error: '网络无响应' }
      const list = s.parse.search(r)
      return { list: list, error: list.length ? '' : '接口有响应但解析 0 条' }
    },

    async detail(book) {
      const ids = book && book.bid ? { bookId: book.bid } : parseBookUrl(book && book.url)
      if (!ids) return null
      const r = await f(s.build.detail(ids.bookId, book))
      if (r == null) return null
      return s.parse.detail(r)
    },

    // 全量目录：先翻页拿卷，再逐卷翻页拿章节。返回扁平 chapter 列表（不含卷标题）。
    async toc(book, onProgress) {
      const ids = book && book.bid ? { bookId: book.bid } : parseBookUrl(book && book.url)
      if (!ids) return { list: [], error: '无法识别书籍 ID' }
      // 站点自带「一次拿全」的目录接口（鲸云是卷内嵌章节），不必走两层翻页
      if (s.tocAll) {
        const flat = await s.tocAll(ids.bookId, f)
        return { list: flat || [], volumes: 1 }
      }
      const out = []
      let page = 1
      let guard = 0
      let volumes = 0
      while (guard++ < 40) {
        const rt = await f(s.build.toc(ids.bookId, page))
        if (rt == null) return { list: out, error: '卷列表网络无响应' }
        const pv = s.parse.toc(rt)
        volumes += pv.list.length
        for (let i = 0; i < pv.list.length; i++) {
          const v = pv.list[i]
          let cp = 1
          let cg = 0
          while (cg++ < 60) {
            const rc = await f(s.build.chapters(ids.bookId, v.volumeId, cp))
            if (rc == null) break
            const pc = s.parse.chapters(rc)
            for (let j = 0; j < pc.list.length; j++) {
              const c = pc.list[j]
              out.push({
                cid: String(c.chapterId),
                title: c.title,
                // 章节地址自解释：/book/{bookId}/chapter/{chapterId}
                url: s.base + '/book/' + c.bookId + '/chapter/' + c.chapterId,
                volume: v.title,
                locked: c.locked,
                price: c.price,
                wordCount: c.wordCount
              })
            }
            if (onProgress) onProgress(out.length, volumes)
            if (!pc.hasNext) break
            cp++
          }
        }
        if (!pv.hasNext) break
        page++
      }
      return { list: out, volumes: volumes }
    },

    async chapter(ch, book) {
      const ids = parseBookUrl(ch && ch.url)
      const bookId = (book && book.bid) || (ids && ids.bookId)
      const chapterId = (ids && ids.chapterId) || (ch && ch.cid)
      if (!bookId || !chapterId) return { text: '', error: '章节地址里没有 id' }
      const r = await f(s.build.chapter(bookId, chapterId, book))
      if (r == null) return { text: '', error: '网络无响应' }
      const st = s.parse.chapterStatus(r)
      const text = s.parse.chapter(r)
      return { text: text, error: st.ok ? (text ? '' : '正文为空') : st.reason, needLogin: !!st.needLogin }
    }
  }
}
