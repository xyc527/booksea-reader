// 跨书源去重与合并（纯函数）
// 目标：同一本书在多个源出现时只展示一条，但保留全部来源可切换。
// 原则：宁可不合并，也不要把两本不同的书合成一本。

// 常见繁体 → 简体（覆盖书名里高频字，不求全）
const T2S = {
  龍: '龙', 書: '书', 劍: '剑', 愛: '爱', 夢: '梦', 戰: '战', 錄: '录', 傳: '传', 貓: '猫',
  這: '这', 個: '个', 們: '们', 時: '时', 間: '间', 國: '国', 語: '语', 靈: '灵', 異: '异',
  術: '术', 師: '师', 學: '学', 會: '会', 動: '动', 開: '开', 關: '关', 無: '无', 與: '与',
  為: '为', 來: '来', 說: '说', 對: '对', 過: '过', 還: '还', 進: '进', 樣: '样', 種: '种',
  現: '现', 實: '实', 點: '点', 麼: '么', 覺: '觉', 讓: '让', 聽: '听', 寫: '写', 讀: '读',
  兒: '儿', 頭: '头', 氣: '气', 風: '风', 雲: '云', 電: '电', 聲: '声', 東: '东', 車: '车',
  馬: '马', 鳥: '鸟', 魚: '鱼', 獸: '兽', 島: '岛', 鄉: '乡', 縣: '县', 鎮: '镇', 莊: '庄',
  場: '场', 廣: '广', 廠: '厂', 營: '营', 業: '业', 產: '产', 權: '权', 錢: '钱', 銀: '银',
  鐵: '铁', 銅: '铜', 軍: '军', 隊: '队', 員: '员', 長: '长', 門: '门', 陽: '阳', 陰: '阴',
  階: '阶', 際: '际', 險: '险', 難: '难', 雙: '双', 隻: '只', 幾: '几', 萬: '万', 億: '亿',
  歲: '岁', 數: '数', 邊: '边', 遠: '远', 近: '近', 達: '达', 運: '运', 連: '连', 續: '续',
  終: '终', 結: '结', 緣: '缘', 繪: '绘', 給: '给', 絕: '绝', 統: '统', 經: '经', 歷: '历',
  戀: '恋', 憂: '忧', 懼: '惧', 願: '愿', 歡: '欢', 樂: '乐', 慘: '惨', 憐: '怜', 淚: '泪',
  滿: '满', 漢: '汉', 潔: '洁', 澤: '泽', 濕: '湿', 災: '灾', 為: '为', 烏: '乌', 熱: '热',
  燈: '灯', 燦: '灿', 爛: '烂', 爭: '争', 牆: '墙', 獨: '独', 獄: '狱', 獎: '奖', 現: '现',
  瑪: '玛', 環: '环', 畫: '画', 當: '当', 瘋: '疯', 發: '发', 盤: '盘', 眾: '众', 睜: '睁',
  禮: '礼', 祕: '秘', 禍: '祸', 離: '离', 稱: '称', 穩: '稳', 窮: '穷', 競: '竞', 筆: '笔',
  節: '节', 範: '范', 築: '筑', 簽: '签', 簡: '简', 籃: '篮', 類: '类', 糧: '粮', 紅: '红',
  純: '纯', 紙: '纸', 級: '级', 納: '纳', 細: '细', 終: '终', 組: '组', 絆: '绊', 絲: '丝',
  綠: '绿', 網: '网', 緊: '紧', 線: '线', 練: '练', 縮: '缩', 總: '总', 織: '织', 繩: '绳',
  繫: '系', 繼: '继', 罷: '罢', 聖: '圣', 聞: '闻', 聯: '联', 職: '职', 聽: '听', 腦: '脑',
  腳: '脚', 臉: '脸', 臨: '临', 舉: '举', 舊: '旧', 艙: '舱', 蘇: '苏', 虛: '虚', 蟲: '虫',
  衝: '冲', 補: '补', 裝: '装', 覺: '觉', 觀: '观', 規: '规', 視: '视', 親: '亲', 計: '计',
  討: '讨', 訓: '训', 記: '记', 設: '设', 許: '许', 訪: '访', 詞: '词', 試: '试', 詩: '诗',
  話: '话', 該: '该', 詳: '详', 認: '认', 誓: '誓', 諾: '诺', 謀: '谋', 講: '讲', 謝: '谢',
  證: '证', 識: '识', 護: '护', 變: '变', 讓: '让', 讚: '赞', 豐: '丰', 貝: '贝', 負: '负',
  財: '财', 貢: '贡', 貨: '货', 販: '贩', 貪: '贪', 責: '责', 貴: '贵', 買: '买', 貸: '贷',
  費: '费', 貼: '贴', 資: '资', 賞: '赏', 賜: '赐', 賣: '卖', 質: '质', 購: '购', 賽: '赛',
  贊: '赞', 趕: '赶', 趨: '趋', 躍: '跃', 車: '车', 輪: '轮', 軟: '软', 輕: '轻', 載: '载',
  遊: '游', 遞: '递', 適: '适', 選: '选', 遷: '迁', 遺: '遗', 遼: '辽', 醫: '医', 釋: '释',
  裡: '里', 裡: '里', 鍊: '炼', 鏡: '镜', 鐘: '钟', 閒: '闲', 閱: '阅', 闆: '板', 陣: '阵',
  陳: '陈', 陸: '陆', 隨: '随', 隱: '隐', 雖: '虽', 雞: '鸡', 霧: '雾', 靜: '静', 韓: '韩',
  頂: '顶', 項: '项', 順: '顺', 須: '须', 領: '领', 頭: '头', 題: '题', 額: '额', 顏: '颜',
  願: '愿', 類: '类', 顯: '显', 飯: '饭', 飲: '饮', 餓: '饿', 館: '馆', 駐: '驻', 驗: '验',
  體: '体', 髮: '发', 鬥: '斗', 魔: '魔', 鳳: '凤', 鴻: '鸿', 鵝: '鹅', 麗: '丽', 麥: '麦',
  黃: '黄', 點: '点', 黨: '党', 鼓: '鼓', 鼠: '鼠', 齊: '齐', 齒: '齿', 龜: '龟'
}

// 补充表：紧凑成对字符串，覆盖书名/作者里高频但上面没列到的繁体字。
// 不追求"完整繁简转换"，只保证同一个书名在两岸站点写法不同时能归一到一起。
const T2S_EXTRA =
  '蒼苍蠶蚕蕭萧驕骄驚惊駛驶厲厉顆颗嶽岳巔巅鋒锋俠侠偽伪傑杰僅仅償偿儲储兇凶凱凯劉刘勁劲捨舍搖摇擺摆敵敌暢畅曉晓殺杀決决沖冲淒凄淺浅涼凉湧涌滾滚滄沧滅灭滯滞漲涨潛潜潤润澀涩濁浊濃浓濟济濤涛瀟潇灘滩牽牵猶犹狹狭獅狮瑣琐疊叠盜盗睜睁碩硕礎础禪禅禦御竊窃竅窍箏筝縱纵纏缠纖纤翹翘聳耸脅胁脈脉臟脏艷艳艱艰蘊蕴虜虏蝕蚀蠻蛮襖袄覓觅觸触諷讽謎谜譏讥豈岂豬猪賀贺賊贼贈赠趙赵軀躯轟轰辯辩遷迁醜丑釀酿釣钓鈴铃鋪铺鍋锅鍵键闊阔闖闯韻韵頌颂頓顿頗颇飄飘饑饥駁驳駕驾騙骗驟骤鬱郁魯鲁鮮鲜鳴鸣鴉鸦鵑鹃鵬鹏鶴鹤鷹鹰鹽盐齋斋龐庞煉炼麼么麽么捲卷儘尽凍冻冊册兌兑壺壶傢家遜逊睏困倖幸遊游鍊炼裡里爲为僞伪冑胄'
for (let i = 0; i + 1 < T2S_EXTRA.length; i += 2) {
  const k = T2S_EXTRA.charAt(i)
  if (!T2S[k]) T2S[k] = T2S_EXTRA.charAt(i + 1)
}

// 书名里不影响"是否同一本书"的噪声
const NOISE = [
  /[\[\]【】()（）「」『』<>《》]/g,
  /\s+/g,
  /[:：·•丨|｜\-—_,，.。!！?？'"“”‘’]/g,
  /(最新章节|全文阅读|免费阅读|无弹窗|手打|txt下载|全集|完结版|完整版|精校版|校对版|未删减|在线阅读)/gi,
  /(小说|笔趣阁|小说网|文学网|中文网)$/g
]

export function toSimplified(s) {
  let out = ''
  const t = String(s == null ? '' : s)
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i)
    out += T2S[c] || c
  }
  return out
}
export function normTitle(s) {
  let t = toSimplified(s)
  for (let i = 0; i < NOISE.length; i++) t = t.replace(NOISE[i], '')
  return t.trim().toLowerCase()
}

export function normAuthor(s) {
  let t = toSimplified(s)
  t = t.replace(/^(作者|作\s*者)\s*[:：]\s*/, '').replace(/[（(](著|连载|完结)[）)]/g, '')
  t = t.replace(/[\s·•丨|｜\-—_.,，。'"“”‘’]/g, '')
  return t.trim().toLowerCase()
}

// 编辑距离（只用于长度接近的短标题，代价可控）
function lev(a, b) {
  const n = a.length
  const m = b.length
  if (!n) return m
  if (!m) return n
  let prev = new Array(m + 1)
  let cur = new Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[m]
}

export function similarity(a, b) {
  const x = normTitle(a)
  const y = normTitle(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const max = Math.max(x.length, y.length)
  if (max > 60) return 0
  return 1 - lev(x, y) / max
}

const TITLE_SIM = 0.86

// 判断两条结果是否同一本书
// 返回 { same:boolean, conf:'high'|'low'|'none', why:string }
export function sameBook(a, b) {
  const ta = normTitle(a.title)
  const tb = normTitle(b.title)
  const aa = normAuthor(a.author)
  const ab = normAuthor(b.author)
  if (!ta || !tb) return { same: false, conf: 'none', why: '标题为空' }
  if (ta === tb) {
    if (aa && ab) {
      if (aa === ab) return { same: true, conf: 'high', why: '书名+作者一致' }
      return { same: false, conf: 'none', why: '同名不同作者' }
    }
    return { same: true, conf: 'low', why: '书名一致，作者缺失' }
  }
  if (aa && ab && aa === ab) {
    const sim = similarity(ta, tb)
    if (sim >= TITLE_SIM) return { same: true, conf: 'high', why: '作者一致且书名相近(' + sim.toFixed(2) + ')' }
  }
  return { same: false, conf: 'none', why: '标题差异过大' }
}

// 合并：输入扁平结果数组，输出分组
// item: { sourceId, sourceName, priority, title, author, url, cover, intro, kind, lastChapter, wordCount, status }
export function groupResults(items, opts) {
  const opt = opts || {}
  const auto = opt.dedupe !== false
  const groups = []
  const list = Array.isArray(items) ? items : []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    if (!it || !it.title) continue
    let hit = null
    if (auto) {
      for (let g = 0; g < groups.length; g++) {
        const r = sameBook(groups[g], it)
        if (r.same) {
          // 低置信只允许"有作者的一侧"吸收"无作者"的一侧，不反向吞并
          if (r.conf === 'low' && groups[g].sources.length > 1) continue
          hit = groups[g]
          break
        }
      }
    }
    if (!hit) {
      groups.push({
        id: 'g' + groups.length,
        title: it.title,
        author: it.author || '',
        cover: it.cover || '',
        intro: it.intro || '',
        kind: it.kind || '',
        sources: [it],
        conf: 'high'
      })
    } else {
      hit.sources.push(it)
      if (!hit.cover && it.cover) hit.cover = it.cover
      if (!hit.intro && it.intro) hit.intro = it.intro
      if (!hit.author && it.author) hit.author = it.author
      if (!hit.kind && it.kind) hit.kind = it.kind
    }
  }
  for (let i = 0; i < groups.length; i++) {
    groups[i].sourceCount = groups[i].sources.length
    groups[i].best = pickBest(groups[i].sources)
  }
  return groups
}

// 默认来源：可用 > 优先级高 > 有目录 > 更新新
const STATUS_RANK = { ok: 0, partial: 1, untested: 2, login: 3, fail: 4, bad: 5 }

export function pickBest(sources) {
  const list = sources.slice()
  list.sort(function (a, b) {
    const sa = STATUS_RANK[a.status] != null ? STATUS_RANK[a.status] : 2
    const sb = STATUS_RANK[b.status] != null ? STATUS_RANK[b.status] : 2
    if (sa !== sb) return sa - sb
    const pa = a.priority == null ? 99 : a.priority
    const pb = b.priority == null ? 99 : b.priority
    if (pa !== pb) return pa - pb
    return 0
  })
  return list[0] || null
}

// 结果排序：书名匹配 > 作者匹配 > 来源可用 > 优先级 > 来源数
export function scoreGroup(g, kw, opts) {
  const opt = opts || {}
  const q = normTitle(kw)
  const t = normTitle(g.title)
  let s = 0
  if (q && t === q) s += 100
  else if (q && t.indexOf(q) === 0) s += 60
  else if (q && t.indexOf(q) >= 0) s += 40
  else if (q && similarity(q, t) >= 0.8) s += 20
  const qa = normAuthor(kw)
  if (qa && normAuthor(g.author) && normAuthor(g.author) === qa) s += 40
  if (g.sources.length > 1) s += 8
  const best = g.best || {}
  if (best.status === 'ok') s += 10
  else if (best.status === 'partial') s += 4
  else if (best.status === 'fail' || best.status === 'bad') s -= 30
  const pri = best.priority == null ? 99 : best.priority
  s += Math.max(0, 20 - pri) * 0.5
  if (opt.preferComplete && best.chapterCount) s += 3
  return s
}

export function rank(groups, kw, opts) {
  const list = groups.slice()
  const scored = list.map(function (g) { return { g: g, s: scoreGroup(g, kw, opts) } })
  scored.sort(function (a, b) { return b.s - a.s })
  return scored.map(function (x) { return x.g })
}
