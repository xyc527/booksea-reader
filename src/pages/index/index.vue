<!-- 书海阅读：搜索 / 目录 / 阅读 / 缓存 / 整本下载 -->
<template>
  <div class="app">
    <!-- 顶栏 -->
    <div class="hdr">
      <text class="ht">{{ hTitle }}</text>
      <text class="hm" @click="probeNet">{{ hMeta }}</text>
    </div>
    <div class="hair"></div>

    <!-- 下载进度：常驻在顶栏下方，离开目录页也能看见，不必再靠 12px 灰字猜 -->
    <div class="dlbar" v-if="view !== 'read' && dl && dl.total && (dl.running || dl.paused || (dl.failed && dl.failed.length))">
      <div class="dltrack"><div class="dlfill" :style="{ width: dlFillPx + 'px' }"></div></div>
      <text class="dlt">{{ dlText }}</text>
      <div class="dlbtn" :style="dl.running ? { backgroundColor: '#8a5b1c' } : { backgroundColor: '#2f6fd0' }" @click="toggleDownload">
        <text class="dlbt">{{ dl.running ? '⏸ 暂停' : (dl.failed && dl.failed.length ? '重试' : '▶ 继续') }}</text>
      </div>
    </div>

    <!-- ============ 首页 ============ -->
    <div :style="bdStyle" class="bd home" v-if="view === 'home'">
      <div :style="homeRowStyle" class="hrow">
        <div class="card cardMain" @click="resumeLast">
          <text class="k">{{ last ? '继续阅读' : '开始阅读' }}</text>
          <text class="t">{{ last ? last.title : '搜索一本书' }}</text>
          <text class="s">{{ last ? lastLine : '按书名关键词搜索，支持模糊匹配' }}</text>
        </div>
        <div class="hcol">
          <div :style="cardSmStyle" class="card cardSm" @click="goSearch">
            <text class="k">搜索</text>
            <text class="s">关键词找书</text>
          </div>
          <div :style="cardSmStyle" class="card cardSm" @click="goCache">
            <text class="k">书架</text>
            <text class="s">{{ cacheText }}</text>
          </div>
        </div>
        <div class="hcol">
          <div :style="cardSmStyle" class="card cardSm" @click="goSettings">
            <text class="k">设置</text>
            <text class="s">字号 {{ fontLabel }}</text>
          </div>
          <div :style="cardSmStyle" class="card cardSm" @click="showHelp">
            <text class="k">说明</text>
            <text class="s">{{ bgOK ? '支持预取' : '逐章加载' }}</text>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 搜索 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'search'">
      <div class="srow">
        <div class="fakeinp" @click="openSystemKeyboard">
          <text class="fakeText" :style="{ color: kw ? '#f0f0f4' : '#66666f' }">{{ kw || '点此输入书名关键词' }}</text>
          <text class="fakeHint">{{ kbOK ? '系统键盘' : '仅热词' }}</text>
        </div>
        <div class="btn" style="background-color:#2f6fd0" @click="doSearch"><text class="bt">搜索</text></div>
        <div class="btn" style="width:60px" @click="goHome"><text class="bt">返回</text></div>
      </div>
      <div class="histrow" v-if="hist.length">
        <text class="hotlab">历史</text>
        <div class="chip hchip" v-for="(w, i) in hist" :key="'h' + i" @click="searchHot(w)">
          <text class="chipt">{{ w }}</text>
        </div>
        <div class="chip clrchip" @click="clearHist"><text class="chipt clrt">清空</text></div>
      </div>
      <div class="hotrow">
        <text class="hotlab">热词</text>
        <div class="chip" v-for="(w, i) in hots" :key="i" @click="searchHot(w)">
          <text class="chipt">{{ w }}</text>
        </div>
      </div>
      <div class="tiprow">
        <text class="tipt">{{ searchTip }}</text>
      </div>
    </div>

    <!-- ============ 搜索结果 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'results'">
      <div class="res" v-for="(r, i) in resRows" :key="r.bid" @click="openBook(r)">
        <div class="resmain">
          <text class="rest">{{ r.title }}</text>
          <text class="ress">{{ r.author }} · {{ r.meta }}</text>
          <text class="resd">{{ r.desc }}</text>
        </div>
        <text class="resgo">读</text>
      </div>
      <div :style="emptyStyle" class="emptybox" v-if="!resRows.length">
        <text class="emptyt">{{ resEmpty }}</text>
        <text class="emptys">{{ resEmptySub }}</text>
      </div>
      <div class="pager">
        <div class="pbtn" @click="resPrev"><text class="bt">上一页</text></div>
        <text class="pg">{{ resPage + 1 }}/{{ resPages }}</text>
        <div class="pbtn" @click="resNext"><text class="bt">下一页</text></div>
        <div class="pbtn" @click="doSearch(true)"><text class="bt">重搜</text></div>
        <div class="pbtn" @click="goHome"><text class="bt">首页</text></div>
      </div>
    </div>

    <!-- ============ 目录 ============ -->
    <div :style="bdStyle" class="bd toc" v-if="view === 'toc'">
      <div class="tocrow" v-for="(c, i) in tocRows" :key="c.idx" @click="openChapter(c.idx)">
        <text class="tocidx">{{ c.idx + 1 }}</text>
        <text class="toct">{{ c.title }}</text>
        <text class="tocd" v-if="c.cached">存</text>
      </div>
      <div :style="emptyStyle" class="emptybox" v-if="!tocRows.length">
        <text class="emptyt">{{ tocLoading ? '目录加载中…' : '目录还没抓到' }}</text>
        <text class="emptys">{{ tocLoading ? '首次打开要一次网络往返，之后走本地缓存' : '点下面「缓存」或退回重进刷新目录' }}</text>
      </div>
      <div class="pager">
        <div class="pbtn" @click="tocPrev"><text class="bt">上一屏</text></div>
        <text class="pg">{{ tocRange }}</text>
        <div class="pbtn" @click="tocNext"><text class="bt">下一屏</text></div>
        <div class="pbtn" style="background-color:#7a5a1e" @click="openJump"><text class="bt">跳转</text></div>
        <div class="pbtn" v-if="bookGroup && bookGroup.sources && bookGroup.sources.length > 1" @click="openPickBook">
          <text class="bt">换源 {{ bookGroup.sources.length }}</text>
        </div>
        <div class="pbtn" @click="tapCacheBtn"><text class="bt">{{ dlLabel }}</text></div>
        <div class="pbtn" @click="goHome"><text class="bt">首页</text></div>
      </div>
    </div>

    <!-- ============ 数字键盘（跳转 / 缓存起点共用） ============ -->
    <div :style="bdStyle" class="bd jump" v-if="view === 'jump'">
      <div class="jleft">
        <text class="jlab">{{ jumpTitle }}</text>
        <div class="jbox"><text class="jnum">{{ jumpText || '—' }}</text></div>
        <text class="jhint">{{ jumpHint }}</text>
        <div class="jscope" v-if="jumpMode === 'jump'">
          <div class="btn" @click="setJumpScope('chap')" :style="jumpScope === 'chap' ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }">
            <text class="bt">按章</text>
          </div>
          <div class="btn" @click="setJumpScope('page')" :style="jumpScope === 'page' ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }">
            <text class="bt">按目录页</text>
          </div>
        </div>
        <div class="jrow">
          <div class="btn" style="background-color:#2f6fd0" @click="confirmJump"><text class="bt">{{ jumpMode === 'dlfrom' ? '开始' : (jumpScope === 'page' ? '定位' : '确定') }}</text></div>
          <div class="btn" @click="cancelJump"><text class="bt">取消</text></div>
        </div>
      </div>
      <div class="jright">
        <div class="krow" v-for="(kr, ri) in keyRows" :key="ri">
          <div class="key" v-for="k in kr" :key="k" @click="tapKey(k)">
            <text class="keyt">{{ keyLabel(k) }}</text>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 阅读 ============ -->
    <div
      :style="bdStyle"
      class="bd read"
      v-if="view === 'read'"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div class="loading" v-if="loading">
        <text class="lt">{{ loading }}</text>
      </div>
      <div class="rtap" v-if="!loading && pageMode === 'tap'">
        <text class="ln" v-for="(l, i) in lines" :key="i" :style="lineStyle">{{ l }}</text>
      </div>
      <!-- 滚动模式：只渲染视口附近十数行，靠 translateY 上移。
           原来一次渲染整章（实测一章 168 行），每帧拖动要重绘全部行，
           单帧 141ms ≈ 7fps，这就是"拖一下停半天"的来源。 -->
      <div :style="readCutStyle" class="rcut" v-if="!loading && pageMode === 'scroll'">
        <div class="rsc" :style="scrollStyle">
          <text class="ln" v-for="(l, i) in scWinLines" :key="'s' + i" :style="lineStyle">{{ l }}</text>
        </div>
      </div>
    </div>
    <div class="ftr" v-if="view === 'read'">
      <text class="fswipe" v-if="pageMode === 'scroll'">↕ 拖动</text>
      <div class="pbtn" @click="prevChapter"><text class="bt">上一章</text></div>
      <div class="pbtn" @click="nextChapter"><text class="bt">下一章</text></div>
      <div class="pbtn" @click="backToToc"><text class="bt">目录</text></div>
      <div class="pbtn" @click="cycleFont"><text class="bt">字号·{{ fontLabel }}</text></div>
      <!-- 缓存任务独立成一个按钮：原来「暂停/继续」和「刷新」共用一个键，
           标签一变用户根本不知道按下去会干什么 -->
      <div class="pbtn dlbtn2" v-if="dlBtnOn"
           :style="dlRunning ? { backgroundColor: '#8a5b1c' } : { backgroundColor: '#2f6fd0' }"
           @click="onDlBtn">
        <text class="bt bt3">{{ dlBtnText }}</text>
        <text class="bt2">{{ dlBtnSub }}</text>
      </div>
      <div class="pbtn" :style="refreshing ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }" @click="onLastBtn">
        <text class="bt">{{ readBtnLabel }}</text>
      </div>
      <text class="fstat" @click="onFootTap">{{ footStat }}</text>
    </div>

    <!-- ============ 设置 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'settings'">
      <!-- 没有 scroll-view，且框架只绘制容器初始可视区内的行（平移过去的下方行是空白），
           所以这里按「窗口」渲染：一次只画 4 行，拖动换窗口。 -->
      <div :style="setViewStyle" class="setview" @touchstart="onSetTouchStart" @touchmove="onSetTouchMove" @touchend="onSetTouchEnd">
        <div class="setinner">
          <div class="setrow" v-for="(r, i) in setWinRows" :key="r.k">
            <text class="setk">{{ r.k }}</text>
            <div class="btn" v-for="(b, j) in r.btns" :key="j" @click="tapSetting(b.act)"
                 :style="b.on ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }">
              <text class="bt">{{ b.t }}</text>
            </div>
            <text :class="r.cls || 'setd'">{{ r.note }}</text>
          </div>
        </div>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="goHome"><text class="bt">返回</text></div>
        <text class="pgrow">书海阅读 {{ appVerText ? 'v' + appVerText : '' }}</text>
        <text class="setpull">上下拖动可滚动</text>
        <div class="btn" style="width:96px" @click="pageSetWin"><text class="bt">{{ setWinBtn }}</text></div>
      </div>
    </div>

    <!-- ============ 书源管理 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'sources'">
      <div class="lbar">
        <div class="lbtn" @click="srcAll(true)"><text class="lbt">全选</text></div>
        <div class="lbtn" @click="srcAll(false)"><text class="lbt">全不选</text></div>
        <div class="lbtn" style="width:74px" @click="testAllSources"><text class="lbt">测试全部</text></div>
        <div class="lbtn" style="width:74px" @click="importPack('pobing')"><text class="lbt">导入破冰</text></div>
        <div class="lbtn" style="width:78px" @click="importPack('guaner')"><text class="lbt">导入女频</text></div>
        <text class="lmsg">{{ srcMsg }}</text>
      </div>
      <div :style="listStyle" class="lst">
        <div class="lstinner">
          <div class="lrow" v-for="(r, i) in srcRows" :key="r.id">
            <text class="lname">{{ r.name }}</text>
            <text class="lmeta" :style="{ color: r.color }">{{ r.meta }}</text>
            <div class="lbtn" :style="r.on ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }"
                 @click="tapSrc('tog:' + r.id)"><text class="lbt">{{ r.on ? '启用' : '停用' }}</text></div>
            <div class="lbtn" @click="tapSrc('test:' + r.id)"><text class="lbt">测试</text></div>
            <div class="lbtn" @click="tapSrc('ck:' + r.id)"><text class="lbt">登录</text></div>
            <div class="lbtn" @click="tapSrc('up:' + r.id)"><text class="lbt">上移</text></div>
            <div class="lbtn" @click="tapSrc('del:' + r.id)"><text class="lbt">删除</text></div>
          </div>
        </div>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="goSettings"><text class="bt">返回</text></div>
        <text class="pgrow">{{ srcPageText }}</text>
        <div class="btn" style="width:58px" @click="srcPageMove(-1)"><text class="bt">上一页</text></div>
        <div class="btn" style="width:58px" @click="srcPageMove(1)"><text class="bt">下一页</text></div>
        <div class="btn" style="width:56px" @click="goNetset"><text class="bt">搜索设置</text></div>
      </div>
    </div>

    <!-- ============ 登录 Cookie ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'cookie'">
      <div class="lmsgrow">
        <text class="ckh">{{ ckName }}</text>
        <text class="ckm">{{ ckMsg }}</text>
      </div>
      <div class="ckbox">
        <text class="cklab">域名</text>
        <text class="ckval">{{ ckHost }}</text>
      </div>
      <div class="ckbox">
        <text class="cklab">当前值</text>
        <text class="ckval">{{ ckBrief }}</text>
      </div>
      <div class="cknote">
        <text class="ckt">在浏览器里登录该站点，把 Cookie 整串复制过来。只存本机 conf/cookies.json，不会写进书源文件。</text>
      </div>
      <div class="pager">
        <div class="btn" style="width:70px" @click="goSources"><text class="bt">返回</text></div>
        <div class="btn" style="width:96px;background-color:#2f6fd0" @click="editCookie"><text class="bt">填写 Cookie</text></div>
        <div class="btn" style="width:70px" @click="clearCookie"><text class="bt">清除</text></div>
        <div class="btn" style="width:78px" @click="testCookie"><text class="bt">验证登录</text></div>
      </div>
    </div>

    <!-- ============ CDN 管理 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'cdn'">
      <div class="lbar">
        <div class="lbtn" @click="cdnAll(true)"><text class="lbt">全选</text></div>
        <div class="lbtn" @click="cdnAll(false)"><text class="lbt">全不选</text></div>
        <div class="lbtn" style="width:74px" @click="testAllCdn"><text class="lbt">测试全部</text></div>
        <div class="lbtn" style="width:74px" @click="updateSourcesFromCdn"><text class="lbt">更新书源</text></div>
        <text class="lmsg">{{ cdnMsg }}</text>
      </div>
      <div :style="listStyle" class="lst">
        <div class="lstinner">
          <div class="lrow" v-for="(r, i) in cdnRows" :key="r.id">
            <text class="lname">{{ r.name }}</text>
            <text class="lmeta" :style="{ color: r.color }">{{ r.meta }}</text>
            <div class="lbtn" :style="r.on ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }"
                 @click="tapCdn('tog:' + r.id)"><text class="lbt">{{ r.on ? '启用' : '停用' }}</text></div>
            <div class="lbtn" @click="tapCdn('test:' + r.id)"><text class="lbt">测试</text></div>
            <div class="lbtn" @click="tapCdn('up:' + r.id)"><text class="lbt">上移</text></div>
          </div>
        </div>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="goSettings"><text class="bt">返回</text></div>
        <text class="pgrow">{{ cdnPageText }}</text>
        <div class="btn" style="width:58px" @click="cdnPageMove(-1)"><text class="bt">上一页</text></div>
        <div class="btn" style="width:58px" @click="cdnPageMove(1)"><text class="bt">下一页</text></div>
      </div>
    </div>

    <!-- ============ 搜索设置 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'netset'">
      <div :style="setViewStyle" class="setview">
        <div class="setinner">
          <div class="setrow" v-for="(r, i) in netRows" :key="r.k">
            <text class="setk" style="width:86px">{{ r.k }}</text>
            <div class="btn" v-for="(b, j) in r.btns" :key="j" @click="tapNet(b.act)"
                 :style="b.on ? { backgroundColor: '#2f6fd0' } : { backgroundColor: '#1c1c24' }">
              <text class="bt">{{ b.t }}</text>
            </div>
            <text class="setd">{{ r.note }}</text>
          </div>
        </div>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="goSettings"><text class="bt">返回</text></div>
        <text class="pgrow">{{ enabledCount }} 个源参与搜索</text>
        <div class="btn" style="width:46px" @click="netPageMove(-1)"><text class="bt">上翻</text></div>
        <div class="btn" style="width:46px" @click="netPageMove(1)"><text class="bt">下翻</text></div>
        <div class="btn" style="width:66px" @click="goSources"><text class="bt">书源管理</text></div>
      </div>
    </div>

    <!-- ============ 来源选择（同一本书多来源） ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'pick'">
      <div class="pickh">
        <text class="pickt">{{ pickTitle }}</text>
        <text class="picks">{{ pickSub }}</text>
      </div>
      <div :style="listStyle" class="lst">
        <div class="lstinner">
          <div class="lrow" v-for="(r, i) in pickRows" :key="i" @click="choosePick(i)">
            <text class="lname">{{ r.name }}</text>
            <text class="lmeta" :style="{ color: r.color }">{{ r.meta }}</text>
            <text class="lgo">读</text>
          </div>
        </div>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="backFromPick"><text class="bt">返回</text></div>
        <text class="pgrow">切换来源会重新抓该站目录，章节不混用</text>
      </div>
    </div>

    <div :style="bdStyle" class="bd" v-if="view === 'diag'">
      <div class="distat" v-if="diagBusy"><text class="ditext">正在逐项检测，请稍候…</text></div>
      <div class="drow" v-for="(r, i) in diagRows" :key="i">
        <text class="dflag" :style="r.ok ? { color: '#4ec97a' } : { color: '#e0685f' }">{{ r.ok ? '通过' : '异常' }}</text>
        <text class="dk">{{ r.k }}</text>
        <text class="dv">{{ r.v }}</text>
      </div>
      <text class="dnote">检测为即时读写校验，不产生日志文件</text>
      <div class="pager">
        <div class="pbtn" @click="runSelfCheck"><text class="bt">重新检测</text></div>
        <text class="pg">{{ diagSum }}</text>
        <div class="pbtn" @click="goSettings"><text class="bt">返回</text></div>
      </div>
    </div>

    <!-- ============ 书架 / 缓存 ============ -->
    <div :style="bdStyle" class="bd" v-if="view === 'cache'">
      <div class="csum">
        <text class="cbig">{{ cacheText }}</text>
        <text class="csub">{{ cacheDetail }}</text>
      </div>
      <div class="crow" v-for="(b, i) in cacheItems" :key="b.bid" @click="tapShelfRow(b)">
        <text class="cname">{{ b.title }}</text>
        <text class="ccount">{{ b.meta }}</text>
        <text class="cgo" v-if="!shelfManage">读</text>
        <text class="cdel" v-if="shelfManage">{{ b.armed ? '确认删除' : '删除' }}</text>
      </div>
      <div :style="emptyStyle" class="emptybox" v-if="!cacheItems.length">
        <text class="emptyt">书架还是空的</text>
        <text class="emptys">搜一本书，读过的章节会自动存下来</text>
      </div>
      <div class="pager">
        <div class="pbtn" @click="shelfPrev"><text class="bt">上一屏</text></div>
        <text class="pg">{{ shelfRange }}</text>
        <div class="pbtn" @click="shelfNext"><text class="bt">下一屏</text></div>
        <div class="pbtn" @click="toggleShelfManage"><text class="bt">{{ shelfManageLabel }}</text></div>
        <div class="pbtn" style="background-color:#6d2323" @click="clearAll"><text class="bt">{{ clearLabel }}</text></div>
        <div class="pbtn" @click="goHome"><text class="bt">返回</text></div>
      </div>
    </div>

        <!-- ============ 说明 ============ -->
    <div :style="bdStyle" class="bd help2" v-if="view === 'help'">
      <div class="hrow2">
        <text class="hk2">搜索</text>
        <text class="hv2">输入书名关键词即可，支持只输入其中一部分</text>
      </div>
      <div class="hrow2">
        <text class="hk2">跳转</text>
        <text class="hv2">可输入章号，也可只跳到目录第 N 屏（不进入章节）</text>
      </div>
      <div class="hrow2">
        <text class="hk2">加载</text>
        <text class="hv2">{{ bgOK ? '先加载当前章，再后台预取后 5 章' : '后台预取不可用，已降级为逐章加载' }}</text>
      </div>
      <div class="hrow2">
        <text class="hk2">离线</text>
        <text class="hv2">首页书架 → 点书名，已下载的章断网也能读</text>
      </div>
      <div class="hrow2">
        <text class="hk2">下载</text>
        <text class="hv2">目录页「缓存」可选起始章，整本存下来，随时暂停</text>
      </div>
      <div class="hrow2">
        <text class="hk2">位置</text>
        <text class="hv2">{{ cacheDirText }}</text>
      </div>
      <div class="hrow2">
        <text class="hk2">阅读</text>
        <text class="hv2">点左右两侧翻页；设置可切滚动，并可开「自动下一章」</text>
      </div>
      <div class="pager">
        <div class="btn" style="width:60px" @click="goHome"><text class="bt">返回</text></div>
        <text class="pgrow">书海阅读 {{ appVerText ? 'v' + appVerText : '' }}</text>
      </div>
    </div>
  </div>
</template>

<script>
import * as P from '@/platform.js'
import { fontByKey, maxEmOf, maxLinesOf, paginateLines, pageOfOffset, layoutLines, lineOfOffset, ellipsis, FONTS, setScreen } from '@/lib/text.js'
import { metrics } from '@/lib/geo.js'
import { parseSearch, parseToc, parseChapter, tocToText, tocFromText } from '@/lib/parse.js'
import {
  TOC_ROWS,
  SHELF_ROWS,
  RESULT_ROWS,
  tocPageOf,
  windowOf,
  moveCursor,
  clamp,
  kb,
  pad2
} from '@/lib/fmt.js'
import {
  NATIVE_ID,
  adapterOf,
  recordFromNative,
  importLegadoJson,
  mergeRecords,
  searchSourceOf,
  statusText,
  statsOf,
  bidOf,
  ensureLNRecords
} from '@/lib/sources.js'
import { searchAll, createCache } from '@/lib/search.js'
import {
  defaultLines,
  buildUrl,
  testLine,
  fetchWithFailover,
  sortByPriority,
  primaryLine,
  validatePayload,
  fnv1a
} from '@/lib/cdn.js'
import { PACKS } from '@/lib/packs.js'
import { pushHist, cleanKw, sanitizeHist } from '@/lib/hist.js'

const HOTS = ['戏神', '斗罗', '诡秘', '都市', '修仙', '完本']

// 书源站点常见的人机验证页特征（返回 200 但内容不是搜索结果）
function isChallenge(txt) {
  const s = String(txt == null ? '' : txt).slice(0, 3000)
  return /verifying you are human|just a moment|checking your browser|cf-browser-verification|人机验证|滑动验证|安全验证|请完成下方验证|访问过于频繁/i.test(s)
}

function emsg(e) {
  return String((e && e.message) || e || '未知错误')
}

// 有些站点对无 Cookie 的请求返回 200 + 「Redirecting...」中转页：
// 表面成功、实际没有内容，必须单独识别，否则会被误判成「解析 0 条」
function isRedirectPage(txt) {
  const s = String(txt == null ? '' : txt)
  if (!s || s.length > 20000) return false
  return /<title>\s*Redirecting|window\.location|top\.location\.href|location\.replace\(|<meta[^>]+http-equiv=["']?refresh/i.test(s)
}

// 书源 / CDN / 搜索配置放在模块级：这些对象带完整 Legado 规则（几十个源、上百个字段），
// 塞进 data 会被 Vue 深度劫持，启动时白白多花几百毫秒；界面只消费「渲染行」。
const STORE = {
  srcList: [],
  cdnList: [],
  cdnTarget: null,
  net: null,
  cache: null,
  loaded: false,
  loading: null
}

const SRC_ROWS = 4
const CDN_ROWS = 4

const DEF_NET = {
  concurrency: 3,
  timeout: 8,
  retry: 1,
  dedupe: true,
  order: 'priority'
}

const CDN_TARGET = {
  owner: 'XIU2',
  repo: 'Yuedu',
  ref: 'master',
  path: 'shuyuan',
  expect: { kind: 'legado', minCount: 5 }
}

export default {
  data() {
    return {
      view: 'home',
      hTitle: '书海阅读',
      hMeta: '',
      // 书
      book: null,
      chapMap: {},
      total: 0,
      tocCursor: 0,
      tocRows: [],
      tocLoading: false,
      tocRange: '',
      chunkLoaded: {},
      chunkLoading: {},
      // 阅读
      chapterIndex: -1,
      pages: [],
      pageIndex: 0,
      lines: [],
      loading: '',
      footStat: '',
      // 搜索
      kw: '',
      results: [],
      resPage: 0,
      resPages: 1,
      resRows: [],
      resEmpty: '',
      resEmptySub: '',
      // 多源搜索结果：去重后的分组（换源用）与失败提示
      resGroups: [],
      resNote: '',
      // 当前这本书的候选来源（多源时目录页出现「换源」）
      bookGroup: null,
      searchTip: '输入关键词后点搜索，支持只输入书名的一部分',
      hots: HOTS,
      // 搜索历史（最近在前，落盘 conf/searchHist.json）
      hist: [],
      // 系统键盘（系统输入法）
      kbOK: false,
      kbOpen: false,
      kbUUID: '',
      // 字号
      fontKey: 'M',
      fontLabel: '中',
      fontSizePx: 18,
      lineHeightPx: 25,
      perPage: 0,
      fonts: FONTS,
      lineStyle: { fontSize: '18px', lineHeight: '25px' },
      // 翻页方式：tap=点左右两侧翻页，scroll=正文区上下拖动滚动
      pageMode: 'tap',
      pageModeDesc: '点屏幕左右两侧翻页',
      // 滚动模式：滑到章末继续上滑是否直接进下一章
      autoNext: true,
      // 设置页滚动（注意：不能叫 setScrollY —— 会与方法 setScrollY(v) 重名，
      // data 会覆盖方法，导致阅读区滚动全部抛异常）
      // 框架只绘制容器初始可视区内的行，平移过去的下方行是空白 —— 所以按行开窗，
      // setWin = 当前窗口的第一行，一次显示 SET_ROWS 行。
      setWin: 0,
      setWinRows: [],
      setWinBtn: '更多',
      setY0: 0,
      setStart: 0,
      setT: 0,
      pageModes: [
        { key: 'tap', label: '点按' },
        { key: 'scroll', label: '滚动' }
      ],
      // 滚动阅读
      allLines: [],
      scrollY: 0,
      scrollMax: 0,
      scrollStyle: { transform: 'translateY(0px)' },
      // 滚动模式的「行窗口」：只渲染视口附近的这些行（见 setScrollY）
      scWin: 0,
      scWinLines: [],
      scWinSize: 14,
      scrollPct: 0,
      lineH: 25,
      // 正文可视高度 = 217 - padT(4) - padB(2)。启动时按真实屏高重算（见 applyGeo）
      bodyH: 211,
      // 屏幕几何：先按设计稿铺底，mounted 时 applyGeo() 换成设备真实尺寸。
      // 960×266 这类机型高度少 14px，不换算就会把底部按钮顶出屏幕。
      geo: metrics(0, 0),
      bdStyle: {},
      readCutStyle: {},
      setViewStyle: {},
      listStyle: {},
      homeRowStyle: {},
      emptyStyle: {},
      cardSmStyle: {},
      // 阅读页刷新
      refreshing: false,
      refreshLabel: '刷新',
      readBtnLabel: '刷新',
      // 页脚临时提示（刷新/切模式的结果），优先于预取进度显示
      flashMsg: '',
      flashUntil: 0,
      // 触摸手势（tsX…scOverBottom）刻意不放 data：它们只给手势逻辑自己用、
      // 从不进模板，但一旦放进 data 就是响应式的 —— 一次拖动要写十几次，
      // 每写一次整模板重绘一次，手一拖界面就开始排队。见 initTouchBuf()。
      // 缓存
      cacheText: '0 章',
      cacheDetail: '',
      cacheItems: [],
      cacheBooks: 0,
      cacheBytes: 0,
      cacheChapters: 0,
      clearLabel: '清空全部',
      clearArmed: false,
      // 书架分页（原来 items.slice(0,4)，第 5 本之后根本不存在）
      shelfAll: [],
      shelfCursor: 0,
      shelfRange: '',
      shelfRows: SHELF_ROWS,
      shelfManage: false,
      shelfDelArmed: {},
      shelfManageLabel: '管理',
      // 存储余量（KB）
      freeKB: 0,
      // 缓存目录文案（关于页给用户看的位置）
      cacheDirText: '',
      appVerText: '',
      // 读写自检（设置页）
      diagRows: [],
      diagSum: '',
      diagBrief: '点这里检查本机能否正常落盘',
      diagBusy: false,
      // ---------- 书源管理 ----------
      srcRows: [],
      srcMsg: '',
      // 登录 Cookie：设备上没有浏览器内核，Cookie 由用户从浏览器复制后粘贴，
      // 存本机 conf/cookies.json（platform.js 的 saveCookie/cookieOf）
      ckSrcId: '',
      ckName: '',
      ckHost: '',
      ckMsg: '',
      ckBrief: '未设置',
      kbMode: 'search',
      srcPage: 0,
      srcPages: 1,
      srcPageText: '',
      srcLoading: false,
      srcTesting: false,
      srcStop: false,
      // ---------- CDN 管理 ----------
      cdnRows: [],
      cdnMsg: '',
      cdnPage: 0,
      cdnPages: 1,
      cdnPageText: '',
      cdnBusy: false,
      // ---------- 搜索范围设置 ----------
      netRows: [],
      netRowsAll: [],
      netWin: 0,
      enabledCount: 0,
      // ---------- 多来源选择 ----------
      pickRows: [],
      pickTitle: '',
      pickSub: '',
      pickGroup: null,
      // 结果列表里「N 个来源」提示
      resNote: '',
      // 搜索过程中的进度（第 2 个源回来时就先展示）
      searching: false,
      // 离线降级：没有目录缓存时，直接列出已下载正文
      offlineMode: false,
      offlineCids: [],
      // 引擎
      bgOK: false,
      online: true,
      cachedSet: {},
      inflight: {},
      pfQueue: [],
      pfDone: 0,
      pfTarget: 0,
      ticking: false,
      // 下载
      dl: null,
      dlLabel: '缓存',
      // 阅读页缓存按钮的三态（运行中 / 已暂停 / 上次没下完）
      dlBtnOn: false,
      dlRunning: false,
      dlBtnText: '继续缓存',
      dlBtnSub: '',
      dlPct: 0,
      dlFillPx: 0,
      dlText: '',
      dlFailed: [],
      // 写盘失败的章数（存储异常时不计入完成，避免"显示已缓存、点开是空的"）
      storageFail: 0,
      // 断网时点了缓存 → 记下来，恢复网络后自动续
      pendingDl: false,
      pendingDlFrom: null,
      netTick: 0,
      netProbing: false,
      dlSavedDone: 0,
      // 429 限流冷却截止时间：冷却期内不派发新请求
      netCooldown: 0,
      // 连续命中限流的次数（用于拉长退避）
      rlHits: 0,
      // 用户主动清空时不要触发「书架异常清空」的恢复逻辑
      clearing: false,
      shelfGuardBusy: false,
      snapObj: null,
      snapLoaded: false,
      // 漏桶排程：下一次允许发请求的时间（站点约 15 次/30 秒）
      rlNextAt: 0,
      // 最近 60 秒实际发出的请求时刻（滑窗限速用）
      rlLog: [],
      // 正在跑的批量抓取（一个 curl 进程带多章，复用连接）
      batches: [],
      // 上次未完成的下载任务（state.json 里带出来的）
      dlResume: null,
      // 状态落盘节流用：上次写进去的串、上次写的时间、手指是否在屏幕上
      stateStr: '',
      stateAt: 0,
      // 跳转 / 缓存起点
      jumpMode: 'jump',
      jumpScope: 'chap',
      jumpTitle: '跳转到第几章',
      jumpText: '',
      jumpHint: '',
      keyRows: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['C', '0', 'B']],
      // 最近
      last: null,
      lastLine: '',
      booted: false,
      stage: '',
      // 启动耗时（毫秒）：挂载到首屏就绪，随按需快照导出
      bootT0: 0,
      bootMs: 0,
      tocDirty: false,
      cmdBusy: false
    }
  },

  mounted() {
    this.initTouchBuf()
    this.bootT0 = Date.now()
    // 尺寸必须先定，boot 里的首次分页/排版都依赖它
    this.applyGeo()
    this.boot()
    this.timer = setInterval(() => {
      try {
        this.tick()
        this.pollCmd()
        this.saveTick()
      } catch (e) {}
    }, 450)
  },

  beforeDestroy() {
    if (this.timer) clearInterval(this.timer)
    try {
      // 兜底：最后 1.8s 内没落盘的阅读进度在这里补写（写接口本身是同步的）
      this.flushState()
    } catch (e) {}
    // 先关会话，避免输入法窗口残留
    try {
      P.closeTextEdit()
    } catch (e) {}
  },

  methods: {
    // 手势用的非响应式字段：只给逻辑用，不参与渲染
    initTouchBuf() {
      this.tsX = 0
      this.tsY = 0
      this.tsX2 = 0
      this.tsY2 = 0
      this.tsT = 0
      this.tsN = 0
      this.touching = false
      this.touchRaw = ''
      this.touchDiag = ''
      this.scY0 = 0
      this.scOverTop = 0
      this.scOverBottom = 0
      this.scrollPx = 0
      this.scPendY = null
      this.scBusy = false
      // 排查手势时才置 true：打开后按下会记录事件原文与手势诊断
      this.dbgTouch = false
      // 主容器布局：true = flex 吃剩余空间（不读 env 高度），false = 按 env 算像素高
      this.layoutFlex = true
      // 调试用的屏幕尺寸覆盖（0 = 不覆盖）
      this.geoForceW = 0
      this.geoForceH = 0
    },

    // ---------- 屏幕几何 ----------
    // 全设备上架后的适配核心：把「吃掉剩余空间」的容器高度从写死改成按真实屏高算。
    // 只平移纵向余量，字号和行高不动 —— 内容尺寸跟着缩会直接伤可读性。
    applyGeo() {
      const s = P.screenSize()
      // geoForceW/H 是调试覆盖值（指令 geoforce 960x266），正常运行时为 0 走真实尺寸
      const w = this.geoForceW > 0 ? this.geoForceW : s.w
      const h = this.geoForceH > 0 ? this.geoForceH : s.h
      const g = metrics(w, h)
      this.geo = g
      setScreen(g.w, g.h)
      // 主容器两种布局，由指令「layout flex|abs」切换：
      //   flex —— 高度交给框架按 100vh 自己算，连 env 都不用读；env 报错值也不会溢出
      //   abs  —— 按 env 算出的像素高度，给 flex 链不成立的固件兜底
      // env 与 vh 同源时两者结果应当完全一致，用截图对拍验证。
      this.bdStyle = this.layoutFlex ? { flex: 1 } : { height: g.body + 'px' }
      this.readCutStyle = { height: g.readCut + 'px' }
      this.setViewStyle = { height: g.setView + 'px' }
      this.listStyle = { height: g.list + 'px' }
      this.homeRowStyle = { height: g.homeRow + 'px' }
      this.emptyStyle = { height: g.empty + 'px' }
      this.cardSmStyle = { height: g.cardSm + 'px' }
      this.bodyH = g.readCut
      // 分页行数变了：保住当前字符位置重排，否则换机型读同一本书会跳页
      if (this.rawText) {
        try {
          const keep = this.curCharOff()
          this.rebuildBlocks(this.rawText)
          this.restoreOff(keep)
          this.updateFoot()
        } catch (e) {}
      } else if (this.scrollMax > 0) {
        this.scrollMax = Math.max(0, this.allLines.length * this.lineH - this.bodyH)
      }
    },

    // ---------- 启动 ----------
    async boot() {
      try {
        await this.bootInner()
      } catch (e) {
        this.bootError = String((e && e.message) || e)
        this.booted = true
      }
    },

    async bootInner() {
      this.stage = 'init'
      const dir = await P.init()
      this.DIR = dir
      // 关于页要把「书存到哪儿了」明确告诉用户，否则他会以为没下载成功
      this.cacheDirText = P.cacheRoot()
      this.appVerText = (await P.appVersion()) || ''
      // 数据根目录的抓取残留（整页 HTML）不影响功能，但很占地方：每页目录 124KB
      try {
        await P.cleanScratch()
      } catch (e) {}
      this.stage = 'state'
      const st = (await P.loadState()) || {}
      // 搜索历史：读坏了不能拖垮启动，失败就当空（sanitize 会把脏数据滤掉）
      try {
        this.hist = sanitizeHist(await P.loadJsonConf('searchHist.json'))
      } catch (e) {
        this.hist = []
      }
      this.fontKey = st.fontKey || 'M'
      // 旧版存的是 swipe（左右划动翻页），语义已改为 scroll（上下拖动滚动）
      this.pageMode = st.pageMode === 'scroll' || st.pageMode === 'swipe' ? 'scroll' : 'tap'
      this.pageModeDesc = this.pageMode === 'scroll' ? '正文区上下拖动滚动' : '点屏幕左右两侧翻页'
      // 未记录过就默认开启（保持原来的「滑到底自动进下一章」行为）
      this.autoNext = st.autoNext === undefined ? true : !!st.autoNext
      this.updateSetScroll()
      this.last = st.last || null
      // 上次没下完的任务：重新打开这本书时提示「继续 735/952」
      this.dlResume = st.dl && st.dl.bid ? st.dl : null
      this.applyFont(this.fontKey, false)
      this.updateLastLine()
      this.stage = 'cache'
      // 系统输入法能力探测（只在启动时做一次，失败就整体走热词降级）
      try {
        this.kbOK = P.textEditSupported()
      } catch (e) {
        this.kbOK = false
      }
      this.stage = 'done'
      this.booted = true
      this.bootMs = Date.now() - (this.bootT0 || Date.now())
      this.syncChrome()
      this.goHome()
      // 书架统计要 fork shell 扫目录（书多时几百毫秒），绝不能挡首屏：
      // 先渲染首页，空闲时再补上统计数字。
      setTimeout(async () => {
        try {
          await this.compactLegacyToc()
        } catch (e) {}
        try {
          await this.refreshCache()
        } catch (e) {}
      }, 700)
      // 后台能力探测放到首页渲染之后
      setTimeout(async () => {
        this.bgOK = await P.probeBackground()
        this.hMeta = this.bgOK ? '' : '逐章加载模式'
        if (!this.bgOK) this.footStat = '逐章加载'
        // 启动就判一次网络，断网时书架/阅读页能立刻给提示而不是空等
        // netUp 返回 null 表示「探测不了」，按通处理，别一上来就显示离线
        const up = await P.netUp(true)
        this.online = up !== false
        this.syncChrome()
      }, 600)
    },

    // ---------- 顶栏 ----------
    syncChrome() {
      const v = this.view
      if (v === 'home') {
        this.hTitle = '书海阅读'
        this.hMeta = this.bgOK ? '' : this.booted ? '逐章加载' : '就绪'
      } else if (v === 'search') {
        this.hTitle = '搜索'
        this.hMeta = this.kw ? '关键词：' + this.kw : ''
      } else if (v === 'results') {
        this.hTitle = '搜索结果'
        this.hMeta = this.kw + ' · ' + this.results.length + ' 本'
      } else if (v === 'toc') {
        this.hTitle = this.book ? ellipsis(this.book.title, 26) : '目录'
        this.hMeta = (this.total ? '共 ' + this.total + ' 章' : '加载中…') +
          (this.book && this.book.srcKind && this.book.srcKind !== 'native' ? ' · ' + this.book.srcName : '') +
          (this.online ? '' : ' · 离线')
      } else if (v === 'jump') {
        this.hTitle = this.jumpMode === 'dlfrom' ? '缓存起点' : (this.jumpScope === 'page' ? '跳到目录页' : '跳转章节')
        this.hMeta = '1 - ' + this.total
      } else if (v === 'read') {
        const c = this.chapMap[this.chapterIndex]
        this.hTitle = c ? ellipsis(c.title, 30) : '阅读'
        this.hMeta =
          (this.chapterIndex >= 0
            ? this.chapterIndex + 1 + '/' + this.total + ' · ' +
              (this.pageMode === 'scroll'
                ? this.scrollPct + '%'
                : this.pageIndex + 1 + '/' + this.pages.length)
            : '') + (this.online ? '' : ' · 离线')
      } else if (v === 'settings') {
        this.hTitle = '设置'
        this.hMeta = ''
      } else if (v === 'cache') {
        this.hTitle = '书架'
        // 顶栏数字必须和列表对得上：原来写「9 本已下载」却只列 4 行
        this.hMeta =
          (this.cacheBooks ? this.cacheBooks + ' 本 · ' + this.cacheChapters + ' 章' : '离线可读') +
          (this.online ? '' : ' · 离线')
      } else if (v === 'help') {
        this.hTitle = '使用说明'
        this.hMeta = ''
      } else if (v === 'cookie') {
        this.hTitle = '登录 Cookie'
        this.hMeta = this.ckName || ''
      } else if (v === 'diag') {
        this.hTitle = '读写自检'
        this.hMeta = this.diagSum
      } else if (v === 'sources') {
        this.hTitle = '书源管理'
        this.hMeta = STORE.srcList.length + ' 个源 · 启用 ' + this.enabledCount
      } else if (v === 'cdn') {
        this.hTitle = 'CDN 线路'
        const pri = primaryLine(STORE.cdnList || [])
        this.hMeta = pri ? '首选 ' + pri.name : '未启用线路'
      } else if (v === 'netset') {
        this.hTitle = '搜索范围'
        this.hMeta = this.enabledCount + ' 个源参与搜索'
      } else if (v === 'pick') {
        this.hTitle = '选择来源'
        this.hMeta = this.pickSub
      }
      // 设置页/搜索范围页的行是「数据驱动 + 开窗」渲染的，只有这两页需要同步窗口内容。
      // 原来无条件调用，等于每次翻页都把设置页的行数组整个重建一遍（新数组 = 整模板重绘）。
      if (v === 'settings' || v === 'netset') this.refreshSetWindow()
    },

    // 把当前该显示的 4 行算出来存进 data（模板里不能直接调用方法当 v-for 数据源）
    refreshSetWindow() {
      const all = this.setRows()
      const max = Math.max(0, all.length - 4)
      if (this.setWin > max) this.setWin = max
      if (this.setWin < 0) this.setWin = 0
      this.setWinRows = all.slice(this.setWin, this.setWin + 4)
      // 设备字体没有 ⌄/⌃ 字形（会渲染成豆腐块），只用纯文字
      this.setWinBtn = this.setWin >= max ? '回到顶部' : '更多'
    },

    // 不想拖动也能翻窗口（触摸注入/拖动在个别环境不稳时的兜底）
    pageSetWin() {
      this.setSetScroll(this.setWin >= this.setWinMax() ? 0 : this.setWinMax())
    },

    goHome() {
      this.view = 'home'
      this.loading = ''
      this.syncChrome()
    },

    showHelp() {
      this.view = 'help'
      this.syncChrome()
    },

    // ---------- 字号 ----------
    applyFont(key, repaginate) {
      const f = fontByKey(key)
      this.fontKey = f.key
      this.fontLabel = f.label
      this.fontSizePx = f.size
      this.lineHeightPx = f.line
      const em = maxEmOf(f)
      const ln = maxLinesOf(f)
      this.perPage = Math.floor(em) * ln
      this.lineStyle = { fontSize: f.size + 'px', lineHeight: f.line + 'px', height: f.line + 'px' }
      if (repaginate && this.rawText) {
        // 先按旧字号算出字符偏移，重排后回到同一位（滚动模式同样适用）
        const keep = this.curCharOff()
        this.rebuildBlocks(this.rawText)
        this.restoreOff(keep)
        this.updateFoot()
        this.syncChrome()
      }
      if (this.view === 'settings') this.hMeta = ''
    },

    setFont(key) {
      this.applyFont(key, true)
      this.saveLast(true)
    },

    cycleFont() {
      const order = ['S', 'M', 'L']
      const i = order.indexOf(this.fontKey)
      const next = order[(i + 1) % order.length]
      this.applyFont(next, true)
      this.saveLast(true)
    },

    // ---------- 翻页方式 ----------
    setPageMode(mode) {
      if (this.refreshing) return
      const m = mode === 'scroll' || mode === 'swipe' ? 'scroll' : 'tap'
      if (m === this.pageMode) return
      // 切模式保持阅读位置：记下当前字符偏移，重排后回到同一处
      const keep = this.curCharOff()
      this.pageMode = m
      this.pageModeDesc = m === 'scroll' ? '正文区上下拖动滚动' : '点屏幕左右两侧翻页'
      if (this.rawText) {
        this.rebuildBlocks(this.rawText)
        this.restoreOff(keep)
        if (this.view === 'read') this.saveLast(true)
      }
      this.stateAt = 0
      this.saveDirty = true
      this.flushState()
      this.updateSetScroll()
      this.flash(m === 'scroll' ? '已切换为滚动阅读' : '已切换为点按翻页', 2500)
      this.syncChrome()
    },

    // 滚动模式下「滑到底是否自动进下一章」
    toggleAutoNext() {
      this.autoNext = !this.autoNext
      this.stateAt = 0
      this.saveDirty = true
      this.flushState()
      this.flash(this.autoNext ? '滑到章末会接着进下一章' : '滑到章末会停住', 3000)
      this.refreshSetWindow()
    },

    // ---------- 设置页滚动（无 scroll-view，按行开窗） ----------
    // 视口 171px 只放得下 4 行（每行 38 + 3 间距 = 41）；框架不会绘制视口外的行，
    // 所以不做 translateY，而是直接换「显示哪 4 行」。
    setRows() {
      const rows = []
      rows.push({
        k: '字号',
        btns: this.fonts.map((f) => ({ t: f.label, on: this.fontKey === f.key, act: 'font:' + f.key })),
        note: '正文 ' + this.fontSizePx + 'px / 行高 ' + this.lineHeightPx + 'px'
      })
      rows.push({
        k: '阅读',
        btns: this.pageModes.map((p) => ({ t: p.label, on: this.pageMode === p.key, act: 'mode:' + p.key })),
        note: this.pageModeDesc
      })
      if (this.pageMode === 'scroll') {
        rows.push({
          k: '连读',
          btns: [{ t: this.autoNext ? '自动下一章' : '停在章末', on: this.autoNext, act: 'autonext' }],
          note: this.autoNext ? '滑到底继续上滑就进下一章' : '滑到底后停在章末，需自己点下一章'
        })
      }
      rows.push({
        k: '书架',
        btns: [{ t: '已下载', on: false, act: 'cache' }],
        note: this.cacheText
      })
      rows.push({
        k: '加载',
        btns: [],
        note: this.bgOK ? '后台预取可用（最多提前 5 章）' : '后台预取不可用，已降级为逐章加载'
      })
      rows.push({
        k: '书源',
        btns: [{ t: '管理', on: false, act: 'src' }],
        note: '共 ' + Math.max(1, STORE.srcList.length) + ' 个 · 启用 ' + statsOf(STORE.srcList).enabled
      })
      rows.push({
        k: 'CDN',
        btns: [{ t: '线路', on: false, act: 'cdn' }],
        note: '远程书源多线路，首选失败自动切下一条'
      })
      rows.push({
        k: '搜索',
        btns: [{ t: '范围', on: false, act: 'netset' }],
        note: '并发 / 超时 / 重试 / 去重'
      })
      rows.push({
        k: '存储',
        btns: [{ t: '读写自检', on: false, act: 'diag' }],
        note: this.diagBrief
      })
      return rows
    },

    setWinMax() {
      return Math.max(0, this.setRows().length - 4)
    },

    updateSetScroll() {
      this.setWin = clamp(this.setWin, 0, this.setWinMax())
      this.refreshSetWindow()
    },

    setSetScroll(v) {
      this.setWin = clamp(v, 0, this.setWinMax())
      this.refreshSetWindow()
    },

    onSetTouchStart(e) {
      const p = this.touchPoint(e)
      if (!p) return
      this.setY0 = p.y
      this.setStart = this.setWin
      this.setT = Date.now()
    },

    onSetTouchMove(e) {
      if (!this.setT) return
      const p = this.touchPoint(e)
      if (!p) return
      // 拖动超过半行就换一行，手指跟得上又不会抖
      const moved = Math.round((this.setY0 - p.y) / 41)
      this.setSetScroll(this.setStart + moved)
    },

    onSetTouchEnd() {
      this.setT = 0
    },

    // 设置行里的按钮统一在这里分发
    tapSetting(act) {
      const a = String(act || '')
      const sp = a.indexOf(':')
      const op = sp < 0 ? a : a.slice(0, sp)
      const arg = sp < 0 ? '' : a.slice(sp + 1)
      if (op === 'font') this.setFont(arg)
      else if (op === 'mode') this.setPageMode(arg)
      else if (op === 'autonext') this.toggleAutoNext()
      else if (op === 'cache') this.goCache()
      else if (op === 'diag') this.runSelfCheck()
      else if (op === 'src') this.goSources()
      else if (op === 'cdn') this.goCdn()
      else if (op === 'netset') this.goNetset()
    },

    // 页脚临时提示：刷新/切换的结果优先显示，过期后自动回到预取进度
    flash(msg, ms) {
      this.flashMsg = msg || ''
      this.flashUntil = Date.now() + (ms || 2600)
      if (this.view === 'read') this.footStat = this.flashMsg
    },

    // ---------- 触摸手势（划动翻页） ----------
    // 不同固件的事件载荷不完全一致：touches/changedTouches/pageX/x 逐个兜底
    touchPoint(e) {
      if (!e) return null
      let src = null
      if (e.touches && e.touches.length) src = e.touches[0]
      else if (e.changedTouches && e.changedTouches.length) src = e.changedTouches[0]
      else if (e.pageX != null || e.x != null || e.clientX != null) src = e
      if (!src) return null
      let x = src.pageX
      if (x == null) x = src.x
      if (x == null) x = src.clientX
      let y = src.pageY
      if (y == null) y = src.y
      if (y == null) y = src.clientY
      if (x == null || y == null) return null
      return { x: Number(x), y: Number(y) }
    },

    rawOf(e) {
      try {
        return JSON.stringify(e)
      } catch (x) {
        try {
          const keys = []
          for (const k in e) keys.push(k)
          return 'keys=' + keys.join(',')
        } catch (y) {
          return 'unstringifiable'
        }
      }
    },

    onTouchStart(e) {
      this.touching = true
      // 原来这里无条件 JSON.stringify 整个事件对象（纯诊断用），
      // 每次按下都要序列化一遍 touches/target，白烧几十毫秒。要排查手势时再开。
      if (this.dbgTouch) this.touchRaw = this.rawOf(e)
      const p = this.touchPoint(e)
      if (!p) return
      this.tsX = p.x
      this.tsY = p.y
      this.tsX2 = p.x
      this.tsY2 = p.y
      this.tsT = Date.now()
      this.tsN = 1
      this.scY0 = this.scrollY
      this.scOverTop = 0
      this.scOverBottom = 0
    },

    onTouchMove(e) {
      if (!this.tsT) return
      this.tsN++
      const p = this.touchPoint(e)
      if (p) {
        this.tsX2 = p.x
        this.tsY2 = p.y
      }
      if (this.pageMode !== 'scroll' || this.loading) return
      // 手指上移 → 内容上移（看到后面）
      const raw = this.scY0 - (this.tsY2 - this.tsY)
      if (raw < 0) {
        this.scOverTop = -raw
        this.scOverBottom = 0
      } else if (raw > this.scrollMax) {
        this.scOverBottom = raw - this.scrollMax
        this.scOverTop = 0
      } else {
        this.scOverTop = 0
        this.scOverBottom = 0
      }
      this.applyScroll(raw)
    },

    // 拖动合帧：一次拖动连发十几个 touchmove，每个都立即重排的话，
    // 处理速度赶不上手指，事件越拖越排队（"拖一下要等一下才动"）。
    // 这里只保留最新位置，等这一帧画完再应用下一个。
    applyScroll(v) {
      this.scPendY = v
      if (this.scBusy) return
      this.scBusy = true
      const step = () => {
        const y = this.scPendY
        this.scPendY = null
        try {
          if (y != null) this.setScrollY(y)
        } catch (err) {
          this.scBusy = false
          return
        }
        this.$nextTick(() => {
          setTimeout(() => {
            if (this.scPendY != null) step()
            else this.scBusy = false
          }, 0)
        })
      }
      step()
    },

    // 手指离开后的收尾：越界换章 / 停在章末 / 落进度。
    // 单独抽出来，是为了让调试指令 scend 也能走同一套分支（触摸注入不可靠时的兜底验证）。
    finishScrollDrag() {
      // 已经滑到头还继续拖 → 换章；否则只是普通滚动，落一次阅读进度
      if (this.scOverTop > 56 && this.chapterIndex > 0) {
        this.scOverTop = 0
        // 从章首继续下拉 → 上一章的末尾
        this.openChapter(this.chapterIndex - 1, true)
      } else if (this.scOverBottom > 56) {
        this.scOverBottom = 0
        if (this.autoNext) {
          this.nextChapter()
        } else {
          // 停在章末：回弹到底并提示怎么改
          this.setScrollY(this.scrollMax)
          this.flash('已到章末 · 设置页可开启「自动下一章」', 3500)
        }
      } else {
        this.saveLast()
      }
    },

    onTouchEnd(e) {
      this.touching = false
      // 收尾前先把还没画出去的最后一格落下来，否则松手时位置差几像素
      if (this.scPendY != null) {
        this.setScrollY(this.scPendY)
        this.scPendY = null
      }
      if (!this.tsT) return
      const t0 = this.tsT
      this.tsT = 0
      const p = this.touchPoint(e) || { x: this.tsX2, y: this.tsY2 }
      const dx = p.x - this.tsX
      const dy = p.y - this.tsY
      const dt = Date.now() - t0
      if (this.dbgTouch) this.touchDiag =
        'dx=' + Math.round(dx) + ' dy=' + Math.round(dy) + ' dt=' + dt + ' n=' + this.tsN +
        ' mode=' + this.pageMode + ' y=' + Math.round(this.scrollY) + '/' + Math.round(this.scrollMax)
      if (this.pageMode === 'scroll') {
        this.finishScrollDrag()
        return
      }
      if (dt > 1500) return
      // 点按模式一：横向滑动仍然翻页（老手势保留）
      if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) this.nextPage()
        else this.prevPage()
        return
      }
      // 点按模式二：轻点屏幕 → 右半屏下一页、左半屏上一页
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        // 分界线按真实宽度算（936/2=468 只对设计稿成立）
        if (p.x >= this.geo.centerX) this.nextPage()
        else this.prevPage()
      }
    },

    // ---------- 滚动阅读 ----------
    // 框架没有 scroll-view，滚动 = 整章一次性排好，靠 translateY 上移
    rebuildBlocks(text) {
      const f = fontByKey(this.fontKey)
      const paras = String(text).split('\n')
      const em = maxEmOf(f)
      const maxLines = maxLinesOf(f)
      // 折行只算一次：分页数组和滚动行数组都从同一份 items 切
      const laid = layoutLines(paras, em)
      this.pages = paginateLines(laid.items, laid.end, maxLines)
      this.allLines = laid.items
      this.lineH = f.line
      this.scrollMax = Math.max(0, laid.items.length * f.line - this.bodyH)
      // 换章/换字号后行内容全变了：把窗口标记作废，下一次 setScrollY 会重建
      this.scWin = -1
      this.scWinLines = []
    },

    setScrollY(v) {
      const y = clamp(v, 0, this.scrollMax)
      this.scrollY = y
      const py = Math.round(y)
      const lh = this.lineH || 25
      // 行窗口：视口能放下的行数 + 预卷 2 行。整章渲染时一帧要重绘全部节点
      // （实测 168 行 / 141ms），窗口化之后只剩十来行，位移只改 translateY。
      const need = Math.max(4, Math.ceil(this.bodyH / lh) + 2)
      const total = this.allLines.length
      const k = clamp(Math.floor(py / lh) - 2, 0, Math.max(0, total - need))
      // 1. 先算位移（窗口左上角在内容里的纵坐标 - 当前滚动量）
      const ty = k * lh - py
      if (ty !== this.scrollPx || k !== this.scWin) {
        this.scrollPx = ty
        this.scrollStyle = { transform: 'translateY(' + ty + 'px)' }
      }
      // 2. 只有走出窗口才换行（一屏约 9 行，窗口 2 行余量 → 约每 2 行才重建一次）
      if (k !== this.scWin) {
        this.scWin = k
        this.buildScWin(need)
      }
      const per = this.lineH * maxLinesOf(fontByKey(this.fontKey))
      const p = per > 0 ? Math.floor(y / per) : 0
      this.pageIndex = clamp(p, 0, Math.max(0, this.pages.length - 1))
      const pct = this.scrollMax > 0 ? Math.round((y / this.scrollMax) * 100) : 0
      // 每帧都刷顶栏太重，百分比变了才刷
      if (pct !== this.scrollPct) {
        this.scrollPct = pct
        if (this.view === 'read') this.syncChrome()
      }
    },

    // 重填行窗口。原地改数组（length 后逐项赋值）比每次新建数组少一次整表替换
    buildScWin(size) {
      const n = size || this.scWinSize || 14
      this.scWinSize = n
      const out = []
      const all = this.allLines
      for (let i = this.scWin; i < all.length && out.length < n; i++) out.push(all[i].t)
      this.scWinLines = out
    },

    // 当前位置对应的字符偏移（切模式 / 切字号时用它保住位置）
    curCharOff() {
      if (this.pageMode === 'scroll') {
        if (!this.allLines.length) return 0
        const i = clamp(Math.floor(this.scrollY / Math.max(1, this.lineH)), 0, this.allLines.length - 1)
        return this.allLines[i].off
      }
      return this.pages[this.pageIndex] ? this.pages[this.pageIndex].start : 0
    },

    restoreOff(off) {
      if (!this.pages.length) return
      if (this.pageMode === 'scroll') {
        const li = lineOfOffset(this.allLines, off)
        this.setScrollY(li * this.lineH)
        this.updateFoot()
        this.syncChrome()
      } else {
        this.showPage(pageOfOffset(this.pages, off))
      }
    },

    // ---------- 搜索 ----------
    goSearch() {
      this.view = 'search'
      this.syncChrome()
    },

    // ---------- 系统键盘（系统输入法）----------
    // 搜索框是伪输入框：点它唤起系统输入法，用户在系统键盘输入并确认后，
    // textEditFinished 回调把文本带回，直接发起搜索。
    openSystemKeyboard() {
      if (this.kbOpen) return
      this.searchTip = '正在唤起系统键盘…'
      const ok = P.initTextEdit((r) => {
        this.onKbResult(r)
      })
      if (!ok) {
        this.kbOK = false
        this.searchTip = '系统键盘不可用，可点下方热词搜索'
        return
      }
      this.kbOK = true
      const uuid = P.openTextEdit(this.kw, {
        placeholder: '输入书名关键词',
        maxlength: 20,
        enterButtonText: '搜索'
      })
      if (!uuid) {
        this.kbOpen = false
        this.searchTip = '唤起系统键盘失败，可点下方热词搜索'
        return
      }
      this.kbUUID = uuid
      this.kbOpen = true
      this.searchTip = '在系统键盘上输入关键词，按「搜索」确认'
    },

    async onKbResult(r) {
      const wasOpen = this.kbOpen
      this.kbOpen = false
      this.kbUUID = ''
      P.closeTextEdit()
      if (!r) return
      if (!r.confirmed) {
        if (wasOpen) this.searchTip = '已取消输入，可重新点输入框'
        return
      }
      const t = String(r.text || '').trim()
      if (this.kbMode === 'cookie') {
        this.kbMode = 'search'
        // Cookie 里可能有空格和分号，不能 trim 掉两端以外的内容
        const raw = String(r.text || '')
        if (!raw) {
          this.ckMsg = '没有输入内容'
          return
        }
        const okSave = await P.saveCookie(this.ckHost, raw, this.ckName)
        const saved = await P.cookieOf(this.ckHost)
        // 写后读回：设备上 storage/fs 都可能静默失败，不读回等于没存
        if (!okSave || !saved) {
          this.ckMsg = '保存失败：Cookie 没落到本地'
          return
        }
        this.ckBrief = saved.length + ' 字符 · ' + String(saved).slice(0, 18) + '…'
        this.ckMsg = '已保存并读回校验通过（' + saved.length + ' 字符）'
        return
      }
      this.kw = t
      this.hMeta = t ? '关键词：' + t : ''
      if (!t) {
        this.searchTip = '没有输入内容，可重新点输入框'
        return
      }
      await this.doSearch()
    },

    searchHot(w) {
      this.kw = w
      this.doSearch()
    },

    // 记一条搜索历史并落盘。
    // 落盘失败不回滚内存：宁可这次没存住，也别让刚搜的词在眼前消失。
    async rememberKw(kw) {
      const next = pushHist(this.hist, kw)
      // 与现状完全一致（重复点同一个热词）就不落盘，省一次同步写
      if (next.length === this.hist.length && next[0] === this.hist[0]) return
      this.hist = next
      try {
        await P.saveJsonConf('searchHist.json', next)
      } catch (e) {
        this.searchTip = '历史没存住：' + ((e && e.message) || e)
      }
    },

    async clearHist() {
      this.hist = []
      try {
        await P.saveJsonConf('searchHist.json', [])
        this.searchTip = '已清空搜索历史'
      } catch (e) {
        this.searchTip = '清空失败：' + ((e && e.message) || e)
      }
    },

    // 搜索：多源并发，谁先回来先展示（onPartial 增量），单源挂掉不影响其它源。
    // refresh=true 只由「重搜」触发，此时跳过缓存；普通搜索短时复用同一关键词结果。
    async doSearch(refresh) {
      const kw = cleanKw(this.kw)
      if (!kw) {
        this.searchTip = '请先输入关键词'
        return
      }
      if (this.kw !== kw) this.kw = kw
      // 发起就算一次搜索（不要求有结果）：用户回头找「刚搜过什么」时，
      // 没搜到的那次往往才是最想再试一次的
      this.rememberKw(kw)
      await this.ensureStore()
      const net = STORE.net || DEF_NET
      const list = STORE.srcList
      const self = this
      const sources = []
      for (let i = 0; i < list.length; i++) {
        const r = list[i]
        // 不兼容的源不参与：选了也只会白等一次超时
        if (!r.enabled || r.status === 'bad') continue
        sources.push(
          searchSourceOf(r, function (req, rec) {
            return self.grabText(req, String((rec && rec.id) || 'x').replace(/[^\w]/g, '').slice(-8))
          })
        )
      }
      this.view = 'results'
      this.results = []
      this.resRows = []
      this.resGroups = []
      this.resPage = 0
      this.resPages = 1
      this.resEmpty = ''
      this.resEmptySub = ''
      this.resNote = ''
      this.hTitle = '搜索结果'
      if (!sources.length) {
        this.hMeta = '未启用书源'
        this.resEmpty = '还没有启用任何书源'
        this.resEmptySub = '设置 → 书源 → 全选（或导入破冰源）后再搜'
        this.searchTip = '没有启用书源，先去设置里勾选'
        return
      }
      this.searching = true
      this.hMeta = '搜索中… 0/' + sources.length
      const handle = searchAll({
        kw: kw,
        page: 1,
        sources: sources,
        concurrency: net.concurrency,
        timeout: (net.timeout || 8) * 1000,
        retry: net.retry,
        dedupe: net.dedupe !== false,
        cache: STORE.cache,
        refresh: !!refresh,
        overallTimeout: Math.max(15000, (net.timeout || 8) * 1000 + 8000),
        onPartial: function (groups, stats) {
          // 已经回来的源先展示：等全部源会让人以为「卡住了」
          self.applyGroups(groups, stats)
          self.hMeta = '搜索中… ' + stats.done + '/' + stats.total
        }
      })
      let res = null
      try {
        res = await handle.promise
      } catch (e) {
        res = null
      }
      this.searching = false
      if (!res) {
        this.hMeta = '搜索失败'
        this.searchTip = '搜索失败，请检查网络后重试'
        this.resEmpty = '搜索失败，请检查网络后重试'
        this.resEmptySub = '关键词：' + kw
        return
      }
      this.applyGroups(res.groups, res.stats)
      this.hMeta = kw + ' · ' + this.results.length + ' 本 · ' + res.stats.ok + '/' + res.stats.total + ' 个源有结果'
      if (!this.results.length) {
        this.searchTip = '没有匹配结果，换个关键词试试'
        this.resEmpty = '没有找到「' + kw + '」相关的书'
        const errs = (res.stats.errors || []).slice(0, 2).map(function (e) { return e.name + '：' + e.error })
        this.resEmptySub = errs.length ? '失败的源：' + errs.join('；') : '换个关键词，或点下方「重搜」再试一次'
      } else if (res.stats.fail) {
        this.resNote = res.stats.fail + ' 个源没返回（其它源已正常显示）'
      }
    },

    // 把去重分组铺成列表行（保留 group 供「换源」用）
    applyGroups(groups, stats) {
      const net = STORE.net || DEF_NET
      const gs = (groups || []).slice()
      if (net.order === 'priority') {
        gs.sort(function (a, b) {
          const pa = (a.best && a.best.priority) || 99
          const pb = (b.best && b.best.priority) || 99
          if (pa !== pb) return pa - pb
          return (b.score || 0) - (a.score || 0)
        })
      }
      this.resGroups = gs
      const items = []
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i]
        const b = g.best || (g.sources && g.sources[0]) || null
        if (!b) continue
        items.push({
          bid: b.bid,
          title: b.title,
          author: b.author || '',
          meta: (g.sources.length > 1 ? g.sources.length + ' 个来源 · ' : '') + (b.sourceName || ''),
          desc: b.intro || b.lastChapter || '',
          gi: i
        })
      }
      this.results = items
      this.resPages = Math.max(1, Math.ceil(items.length / RESULT_ROWS))
      if (this.resPage > this.resPages - 1) this.resPage = this.resPages - 1
      if (this.resPage < 0) this.resPage = 0
      this.renderResults()
    },

    renderResults() {
      const from = this.resPage * RESULT_ROWS
      const rows = []
      for (let i = from; i < this.results.length && i < from + RESULT_ROWS; i++) {
        const r = this.results[i]
        rows.push({
          bid: r.bid,
          title: ellipsis(r.title, 30),
          author: ellipsis(r.author || '佚名', 14),
          meta: ellipsis(r.meta || '', 20),
          desc: ellipsis(r.desc || '', 52),
          gi: r.gi
        })
      }
      this.resRows = rows
    },

    resPrev() {
      if (this.resPage > 0) {
        this.resPage--
        this.renderResults()
      }
    },

    resNext() {
      if (this.resPage < this.resPages - 1) {
        this.resPage++
        this.renderResults()
      }
    },

    // ---------- 打开一本书 ----------
    // 缓存管理页要显示书名，落地一份元信息
    async saveMeta() {
      if (!this.book) return
      // 离线降级时 total 是"本地正文条数"，不是真实章数，别写进 meta 污染数据
      if (this.offlineMode) return
      try {
        await P.writeFile(
          P.bookDir(this.book.bid) + '/meta.json',
          JSON.stringify({
            bid: this.book.bid,
            title: this.book.title || '',
            author: this.book.author || '',
            total: this.total || 0
          })
        )
        // 第三方源的书必须记住「哪个源、哪本书的地址」，否则下次从书架点开只能猜
        if (this.book.srcKind && this.book.srcKind !== 'native' && this.book.srcId) {
          await P.writeFile(
            P.bookDir(this.book.bid) + '/src.json',
            JSON.stringify({
              id: this.book.srcId,
              name: this.book.srcName || '',
              url: this.book.url || '',
              vars: this.book.vars || null
            })
          )
        }
      } catch (e) {}
    },

    async openBook(r) {
      // 源列表没加载就先加载：否则 srcRecord 返回 null，
      // 一本书会被判成「书海阁」走原生解析路径（轻小说源的目录永远抓不到）。
      // 从书架直接打开、或调试指令 open 时都可能没走过搜索，这里必须兜住。
      await this.ensureStore()
      // 多来源：把这一本书的所有来源分组带上，目录页可以「换源」
      const g = r && r.gi != null ? this.resGroups[r.gi] : r && r.group ? r.group : null
      this.bookGroup = g || null
      let srcId = (r && r.sourceId) || (g && g.best && g.best.sourceId) || ''
      let srcUrl = (r && r.url) || ''
      let srcVars = (r && r.vars) || null
      // 从书架点进来的没有来源信息：书目录里存的 src.json 是唯一线索，
      // 不读它就只能当书海阁的书去拼 URL，第三方源的书会整本 404
      if (!srcId) {
        try {
          const s = JSON.parse((await P.readFile(P.bookDir(r.bid) + '/src.json')) || 'null')
          if (s && s.id) {
            srcId = s.id
            srcUrl = s.url || ''
            srcVars = s.vars || null
          }
        } catch (e) {}
      }
      if (!srcId) srcId = NATIVE_ID
      const rec = this.srcRecord(srcId)
      this.book = {
        bid: r.bid,
        title: r.title,
        author: r.author || '',
        intro: r.intro || '',
        url: srcUrl,
        vars: srcVars,
        srcId: srcId,
        srcName: rec ? rec.name : '书海阁',
        srcKind: rec ? rec.kind : 'native'
      }
      this.chapMap = {}
      this.chunkLoaded = {}
      this.chunkLoading = {}
      this.total = 0
      this.tocCursor = 0
      this.cachedSet = {}
      this.inflight = {}
      this.pfQueue = []
      this.dl = null
      this.dlLabel = '缓存'
      this.dlFailed = []
      this.dlText = ''
      this.dlFillPx = 0
      this.offlineMode = false
      this.offlineCids = []
      this.view = 'toc'
      this.tocRows = []
      this.tocRange = ''
      this.syncChrome()
      const t0 = Date.now()
      const cids = await P.cachedCids(r.bid)
      for (let i = 0; i < cids.length; i++) this.cachedSet[cids[i]] = 1
      // 打开书的第一屏：有本地目录就立刻出，没有就先占位、后台抓。
      // 原来这里 await ensureChunk(1)，没缓存的书要空等一次网络往返（1.8s+）。
      const cachedToc = await P.readTocTxt(r.bid, 1)
      this.tocLoading = !cachedToc
      this.renderToc()
      if (cachedToc) {
        await this.ensureChunk(1)
        this.tocLoading = false
        this.renderToc()
      } else {
        this.ensureChunk(1).then(() => {
          this.tocLoading = false
          if (this.view === 'toc') this.renderToc()
        })
      }
      await this.saveMeta()
      // 记住这本书（未读状态）
      this.last = {
        bid: r.bid,
        title: r.title,
        author: r.author || '',
        chapterIndex: 0,
        pageIndex: 0,
        pct: 0
      }
      this.saveLast(true)
    },

    // ---------- 目录 ----------
    // 外层只负责并发闸门与异常兜底：某页抓崩了不能把整条下载链路带下去
    async ensureChunk(pageNo) {
      if (!this.book) return
      // 离线降级模式下 chapMap 是本地正文拼的，不需要也不应该再去联网补目录
      if (this.offlineMode) return
      if (this.chunkLoaded[pageNo]) return
      if (this.chunkLoading[pageNo]) {
        // 同一页已有请求在飞：等它落地，否则调用方会拿到空的 chapMap 直接判「章节缺失」
        const t0 = Date.now()
        while (this.chunkLoading[pageNo] && Date.now() - t0 < 30000) {
          await P.sleep(150)
        }
        return
      }
      this.chunkLoading[pageNo] = true
      try {
        await this.ensureChunkInner(pageNo)
      } catch (e) {
      } finally {
        // 无论成功失败都要放开，否则这一页会永久占着闸门（整本下载卡死的元凶）
        this.chunkLoading[pageNo] = false
      }
    },

    async ensureChunkInner(pageNo) {
      const bid = this.book.bid
      // 第三方源：Legado 规则只给一页目录，走另一条路（整表铺进 chapMap）
      const ad = this.bookAdapter()
      if (ad) {
        await this.ensureChunkAd(ad, pageNo)
        return
      }
      // 1) 新版紧凑目录缓存在 toc/ 子目录，一页 4KB 左右
      let parsed = tocFromText(await P.readTocTxt(bid, pageNo))
      // 2) 旧版缓存的是整页 HTML（124KB），解析后就地转成紧凑格式并删掉
      if (!parsed.chapters.length) {
        const oldHtml = await P.readFile(P.tocHtmlPath(bid, pageNo))
        if (oldHtml) {
          parsed = parseToc(oldHtml, bid)
          if (parsed.chapters.length) {
            await P.writeTocTxt(bid, pageNo, tocToText(parsed))
            await P.rm(P.tocHtmlPath(bid, pageNo))
          }
        }
      }
      // 3) 都没有才联网
      if (!parsed.chapters.length) {
        const out = P.scratchPath('toc_' + pageNo + '.html')
        const html = await this.fetchUrl(P.urlToc(bid, pageNo), out, 25)
        await P.rm(out)
        parsed = html ? parseToc(html, bid) : { total: 0, title: '', chapters: [] }
        if (parsed.chapters.length) await P.writeTocTxt(bid, pageNo, tocToText(parsed))
      }
      if (!parsed.chapters.length) {
        this.hMeta = '目录 ' + pageNo + ' 页没抓到'
        return
      }
      if (parsed.total > 0) this.total = parsed.total
      if (parsed.title && this.book) this.book.title = parsed.title
      const base = (pageNo - 1) * 100
      for (let i = 0; i < parsed.chapters.length; i++) {
        this.chapMap[base + i] = {
          cid: parsed.chapters[i].cid,
          title: parsed.chapters[i].title
        }
      }
      this.chunkLoaded[pageNo] = true
      if (this.view === 'toc') this.renderToc()
      this.syncChrome()
    },

    // 并发抓目录页（每批 4 页）：20 页串行要两分钟，用户会以为"点了没反应"    // 第三方源目录：规则里只有一页，整表铺进 chapMap，同时按 100 章一页标记已加载，
    // 这样上层的分页/跳转/整本下载逻辑完全不用改。
    async ensureChunkAd(ad, pageNo) {
      const bid = this.book.bid
      let parsed = tocFromText(await P.readTocTxt(bid, 1))
      // 轻小说源（kind='ln'）：目录是「卷 → 章节」两层，单请求拿不到全表，
      // 由 adapter 的 tocAll 逐卷翻完再一次性铺进 chapMap。
      if (!parsed.chapters.length && ad.tocAll) {
        this.hMeta = '正在取目录 · ' + (this.book.srcName || '')
        const self = this
        let got = null
        try {
          got = await ad.tocAll(this.book, async function (req) {
            const out = P.scratchPath('toc_ln.tmp')
            let r = null
            try {
              r = await P.fetchReqEx(req, out, 20)
            } catch (e) {
              r = null
            }
            await P.rm(out)
            self.hMeta = '正在取目录 · ' + (got ? got.chapters.length : 0) + ' 章'
            return r && r.code === 200 ? r.text : null
          })
        } catch (e) {
          got = null
        }
        if (got && got.chapters && got.chapters.length) {
          parsed = { total: got.chapters.length, chapters: got.chapters }
          await P.writeTocTxt(bid, 1, tocToText(parsed))
        }
      }
      if (!parsed.chapters.length) {
        const gt = await this.grabTocText(ad, this.book, bid)
        if (!gt.text) {
          this.hMeta = (gt.error || '目录没抓到') + ' · ' + (this.book.srcName || '')
          return
        }
        try {
          parsed = ad.parseToc(gt.text, this.book)
        } catch (e) {
          parsed = { total: 0, chapters: [] }
        }
        if (parsed.chapters.length) await P.writeTocTxt(bid, 1, tocToText(parsed))
      }
      if (!parsed.chapters.length) {
        this.hMeta = '目录解析为空 · ' + (this.book.srcName || '')
        return
      }
      this.total = parsed.chapters.length
      for (let i = 0; i < parsed.chapters.length; i++) {
        const c = parsed.chapters[i]
        this.chapMap[i] = { cid: c.cid, title: c.title, url: c.url || '' }
      }
      const pages = Math.max(1, Math.ceil(this.total / 100))
      for (let p = 1; p <= pages; p++) this.chunkLoaded[p] = true
      if (this.view === 'toc') this.renderToc()
      this.syncChrome()
    },

    async ensureTocPages(pages) {
      const need = []
      for (let i = 0; i < pages.length; i++) {
        if (!this.chunkLoaded[pages[i]]) need.push(pages[i])
      }
      for (let i = 0; i < need.length; i += 4) {
        const batch = need.slice(i, i + 4)
        const jobs = []
        for (let j = 0; j < batch.length; j++) jobs.push(this.ensureChunk(batch[j]))
        await Promise.all(jobs)
        this.hMeta = '目录 ' + Math.min(i + 4, need.length) + '/' + need.length
      }
      return need.length
    },

    renderToc() {
      const total = this.total || 0
      if (!total) {
        // 目录抓不到时不要只给一句「加载中…」——正文可能明明都在本地
        const n = Object.keys(this.cachedSet || {}).length
        this.tocRows = []
        this.tocRange = n ? '仅正文 ' + n + ' 章' : '暂无目录'
        return
      }
      const w = windowOf(this.tocCursor, total, TOC_ROWS)
      const rows = []
      for (let i = w.from; i < w.to; i++) {
        const c = this.chapMap[i]
        rows.push({
          idx: i,
          title: c ? ellipsis(c.title, 34) : '加载中…',
          cached: c && this.cachedSet[c.cid] ? true : false
        })
      }
      this.tocRows = rows
      this.tocRange = w.from + 1 + '-' + w.to + ' / ' + total
      // 当前窗口所在目录块没加载就补
      const need = tocPageOf(w.from)
      if (!this.chunkLoaded[need]) this.ensureChunk(need)
    },

    tocPrev() {
      if (this.tocCursor <= 0) return
      this.tocCursor = moveCursor(this.tocCursor, -1, this.total, TOC_ROWS)
      this.renderToc()
      this.syncChrome()
    },

    tocNext() {
      if (this.tocCursor + TOC_ROWS >= this.total) return
      this.tocCursor = moveCursor(this.tocCursor, 1, this.total, TOC_ROWS)
      this.renderToc()
      this.syncChrome()
    },

    // ---------- 跳转 / 缓存起点 ----------
    openJump() {
      if (!this.total) return
      this.jumpMode = 'jump'
      this.jumpScope = 'chap'
      this.jumpTitle = '跳转到第几章'
      this.jumpText = ''
      this.jumpHint = '范围 1 - ' + this.total
      this.view = 'jump'
      this.syncChrome()
    },

    // 按章 / 按目录屏：后者只动目录页，不进入章节、不动阅读进度
    setJumpScope(scope) {
      const s = scope === 'page' ? 'page' : 'chap'
      if (s === this.jumpScope) return
      this.jumpScope = s
      this.jumpText = ''
      if (s === 'page') {
        this.jumpTitle = '跳到目录第几屏'
        const pages = this.tocScreenCount()
        this.jumpHint = '共 ' + pages + ' 屏 · 每屏 ' + TOC_ROWS + ' 章 · 不会进入章节'
      } else {
        this.jumpTitle = '跳转到第几章'
        this.jumpHint = '范围 1 - ' + this.total
      }
    },

    tocScreenCount() {
      if (!this.total) return 1
      return Math.max(1, Math.ceil(this.total / TOC_ROWS))
    },

    // 从第几章开始缓存：默认当前章，直接确认就是"从这章往后全存"
    openDlFrom() {
      if (!this.total) return
      this.jumpMode = 'dlfrom'
      this.jumpTitle = '从第几章开始缓存'
      const cur = clamp(this.chapterIndex >= 0 ? this.chapterIndex : 0, 0, Math.max(0, this.total - 1))
      this.jumpText = String(cur + 1)
      this.updateDlHint()
      this.view = 'jump'
      this.syncChrome()
    },

    updateDlHint() {
      const n = parseInt(this.jumpText || '0', 10)
      const from = clamp(n || 1, 1, this.total)
      let left = 0
      for (let i = from - 1; i < this.total; i++) {
        const c = this.chapMap[i]
        if (c && this.cachedSet[c.cid]) continue
        left++
      }
      this.jumpHint = '第 ' + from + ' 章起，待存 ' + left + ' 章（已存的会跳过）'
    },

    // 键面文字：C=清空 B=退格，其余为数字本身
    keyLabel(k) {
      if (k === 'C') return '清空'
      if (k === 'B') return '退格'
      return String(k)
    },

    tapKey(k) {
      if (k === 'C') {
        this.jumpText = ''
      } else if (k === 'B') {
        this.jumpText = this.jumpText.slice(0, this.jumpText.length - 1)
      } else {
        if (this.jumpText.length >= 5) return
        this.jumpText = (this.jumpText === '0' ? '' : this.jumpText) + k
      }
      if (this.jumpMode === 'dlfrom') {
        this.updateDlHint()
        return
      }
      const n = parseInt(this.jumpText || '0', 10)
      if (this.jumpScope === 'page') {
        const pages = this.tocScreenCount()
        this.jumpHint = n
          ? '第 ' + n + ' 屏 · 第 ' + ((n - 1) * TOC_ROWS + 1) + '-' + Math.min(this.total, n * TOC_ROWS) + ' 章'
          : '共 ' + pages + ' 屏 · 每屏 ' + TOC_ROWS + ' 章 · 不会进入章节'
        return
      }
      this.jumpHint = n ? '第 ' + n + ' 章' + (this.total ? ' / ' + this.total : '') : '范围 1 - ' + this.total
    },

    cancelJump() {
      this.jumpMode = 'jump'
      this.jumpTitle = '跳转到第几章'
      this.view = 'toc'
      this.syncChrome()
    },

    async confirmJump() {
      if (this.jumpMode === 'dlfrom') {
        const n = parseInt(this.jumpText || '0', 10)
        if (!n || n < 1 || (this.total && n > this.total)) {
          this.jumpHint = '请输入 1 - ' + this.total + ' 之间的数字'
          return
        }
        this.jumpMode = 'jump'
        this.jumpTitle = '跳转到第几章'
        this.view = 'toc'
        this.syncChrome()
        this.renderToc()
        await this.startDownload(n - 1)
        return
      }
      const n = parseInt(this.jumpText || '0', 10)
      // 只跳到目录某一屏：不动当前阅读章、不动阅读进度
      if (this.jumpScope === 'page') {
        const pages = this.tocScreenCount()
        if (!n || n < 1 || n > pages) {
          this.jumpHint = '请输入 1 - ' + pages + ' 之间的屏号'
          return
        }
        this.tocCursor = clamp((n - 1) * TOC_ROWS, 0, Math.max(0, this.total - 1))
        this.view = 'toc'
        this.syncChrome()
        this.renderToc()
        this.flash('已定位到目录第 ' + n + ' 屏（未进入章节）', 3000)
        return
      }
      if (!n || n < 1 || (this.total && n > this.total)) {
        this.jumpHint = '请输入 1 - ' + this.total + ' 之间的数字'
        return
      }
      const idx = n - 1
      this.tocCursor = idx
      this.view = 'toc'
      this.syncChrome()
      this.renderToc()
      await this.openChapter(idx)
    },

    // ---------- 阅读 ----------
    async openChapter(idx, atBottom) {
      if (!this.book) return
      if (idx < 0) idx = 0
      if (this.total && idx >= this.total) idx = this.total - 1
      this.chapterIndex = idx
      this.pageIndex = 0
      this.pages = []
      this.lines = []
      this.allLines = []
      this.scrollY = 0
      this.scrollMax = 0
      this.scrollPct = 0
      this.scrollStyle = { transform: 'translateY(0px)' }
      this.rawText = ''
      this.loading = '正在加载第 ' + (idx + 1) + ' 章…'
      this.view = 'read'
      this.syncChrome()

      // 目录块可能没加载
      const pageNo = tocPageOf(idx)
      if (!this.chunkLoaded[pageNo]) {
        await this.ensureChunk(pageNo)
      }
      const c = this.chapMap[idx]
      if (!c) {
        // 离线打开书架时目录可能没下全：给出比「缺失」更有用的指引
        this.loading = '这一章的目录还没下载，回列表换一章'
        return
      }

      const bid = this.book.bid
      let text = await P.readCache(bid, c.cid)
      if (text && /<!DOCTYPE|<html[\s>]/i.test(String(text).slice(0, 400))) {
        // 兼容早期版本写进缓存的整页 HTML：就地转成正文并回写
        const fixed = parseChapter(String(text), c.title).paras.join('\n')
        // 解析不出正文就别把坏内容留在缓存里，当作未缓存重新抓
        text = fixed.length >= 50 ? fixed : ''
        if (text) await P.writeCache(bid, c.cid, text)
        else await P.rm(P.cachePath(bid, c.cid))
      }
      if (!text) {
        // 要联网了才探网络：读本地缓存时不该被一次探测拖慢
        if (!(await this.ensureOnline(false))) {
          this.loading = '第 ' + (idx + 1) + ' 章未下载 · 离线，联网后可读'
          return
        }
        text = await this.fetchChapter(bid, c)
        if (!text) {
          this.loading = '第 ' + (idx + 1) + ' 章未下载 · 联网后自动存'
          return
        }
        // 写盘失败不能算已缓存，否则重进是空的（「缓存不成功」的典型表现）
        const wrote = await P.writeCache(bid, c.cid, text)
        if (wrote) this.cachedSet[c.cid] = 1
        else this.flash('正文读到了但存不下，设置页可做读写自检', 4000)
        this.tocDirty = true
      }

      this.rawText = text
      this.rebuildBlocks(text)
      this.loading = ''
      this.showPage(0)
      // 从章末上滑过来的，落到新章末尾
      if (this.pageMode === 'scroll' && atBottom) this.setScrollY(this.scrollMax)
      this.syncChrome()
      this.saveLast(true)
      this.rebuildPrefetch(idx)
    },

    // ---------- 书源适配 ----------
    srcRecord(id) {
      const list = STORE.srcList || []
      for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
      return null
    },

    // 只有第三方源才返回适配器：书海阁继续走原来的批量/预取链路（那套经过实测调优）
    bookAdapter() {
      const b = this.book
      // 除了书海阁（native），其它源（Legado 导入源、内置轻小说源）都走适配器
      if (!b || b.srcKind === 'native' || !b.srcKind) return null
      const rec = this.srcRecord(b.srcId)
      return rec ? adapterOf(rec) : null
    },

    openPickBook() {
      if (this.bookGroup) this.openPick(this.bookGroup)
    },

    async fetchChapter(bid, c) {
      // 第三方源：一章一个请求（规则里没有批量语法），失败就返回空让上层提示重试
      const ad = this.bookAdapter()
      if (ad) {
        const out = P.scratchPath('ch_ad.tmp')
        let r = null
        try {
          r = await P.fetchReqEx(ad.chapterRequest(this.book, { cid: c.cid, title: c.title, url: c.url || '' }), out, 25)
        } catch (e) {
          r = null
        }
        await P.rm(out)
        if (!r || r.code !== 200 || !r.text) return ''
        try {
          return String(ad.parseChapter(r.text, this.book) || '')
        } catch (e) {
          return ''
        }
      }
      // 已经在预取队列里，等它
      const it = this.inflight[c.cid]
      if (it && it.batch) {
        // 这一章正在某个批量任务里：批量项没有单章的 .dest，只能等批次结束再读缓存。
        // （旧代码直接 waitFile(undefined + '.ok')，等于干等 40 秒，阅读页就卡在"正在加载"）
        const b = this.batchOf(it.batch)
        if (b) await P.waitFile(b.ok, 20000)
        const cached0 = await P.readCache(bid, c.cid)
        if (cached0) return cached0
      } else if (it) {
        const ok = await P.waitFile(it.dest + '.ok', 40000)
        if (ok) {
          // tick 可能已经收尾并写入缓存
          const cached = await P.readCache(bid, c.cid)
          if (cached) {
            delete this.inflight[c.cid]
            return cached
          }
          const s = await P.readFile(it.dest)
          delete this.inflight[c.cid]
          await P.rm(it.dest + '.ok')
          if (s) {
            const parsed = parseChapter(s, c.title)
            return parsed.paras.join('\n')
          }
        }
      }
      const out = P.scratchPath('ch_' + c.cid + '.html')
      const html = await this.fetchUrl(P.urlChapter(bid, c.cid), out, 30)
      if (!html) return ''
      const parsed = parseChapter(html, c.title)
      return parsed.paras.join('\n')
    },

    showPage(i) {
      if (!this.pages.length) return
      this.pageIndex = clamp(i, 0, this.pages.length - 1)
      this.lines = this.pages[this.pageIndex].lines
      if (this.pageMode === 'scroll') {
        const per = this.lineH * maxLinesOf(fontByKey(this.fontKey))
        this.setScrollY(this.pageIndex * per)
      }
      this.updateFoot()
      this.syncChrome()
    },

    updateFoot() {
      if (this.flashMsg && Date.now() < this.flashUntil) {
        this.setFoot(this.flashMsg)
        return
      }
      // 缓存按钮：本进程有任务，或者磁盘上还留着这本书没下完的进度，都要能一键继续
      const rb = this.book && this.dlResume && this.dlResume.bid === this.book.bid ? this.dlResume : null
      if (this.dl && this.dl.total) {
        this.dlBtnOn = true
        this.dlRunning = !!this.dl.running
        this.dlBtnText = this.dl.running ? '暂停缓存' : '继续缓存'
        this.dlBtnSub = this.dl.done + '/' + this.dl.total
        this.setFoot('')
      } else if (rb) {
        this.dlBtnOn = true
        this.dlRunning = false
        this.dlBtnText = '继续缓存'
        this.dlBtnSub = (rb.done || 0) + '/' + (rb.total || this.total || 0)
        this.setFoot('')
      } else {
        this.dlBtnOn = false
        this.dlRunning = false
      }
      if (this.dlBtnOn) {
        // 缓存进度已经在按钮上了
      } else if (!this.online) {
        this.setFoot('离线 · 只读已下载')
      } else if (!this.bgOK) {
        this.setFoot('逐章加载')
      } else if (this.pfTarget > 0) {
        this.setFoot('预取 ' + this.pfDone + '/' + this.pfTarget)
      } else {
        this.setFoot('')
      }
      // 阅读页顶栏不显示下载条，缓存任务的暂停/继续交给独立按钮（模板里的 dlbtn2）
      const btn = this.refreshing ? '刷新中' : '刷新'
      if (btn !== this.readBtnLabel) this.readBtnLabel = btn
    },

    // 阅读页的缓存暂停/继续
    onDlBtn() {
      if (this.dl && this.dl.total) {
        if (this.dl.running) this.pauseDl()
        else this.toggleDownload()
        return
      }
      // 没有内存里的任务，但上次没下完：按上次的起点续上
      const r = this.dlResume
      if (r && this.book && r.bid === this.book.bid) {
        this.startDownload(typeof r.from === 'number' ? r.from : 0)
      }
    },

    // 页脚在 tick 里每 450ms 刷一次；值没变就别赋值，省掉一次无意义的模板重绘
    setFoot(v) {
      const s = v || ''
      if (s !== this.footStat) this.footStat = s
    },

    onLastBtn() {
      this.refreshReading()
    },

    // 阅读页没有顶部进度条，页脚这行是进度显示（点一下也能暂停）
    onFootTap() {
      if (this.dl && this.dl.running) this.pauseDl()
      else if (this.dl && this.dl.paused) this.toggleDownload()
    },

    pauseDl() {
      if (!this.dl || !this.dl.running) return
      this.dl.running = false
      this.dl.paused = true
      this.persistDl()
      this.flash('已暂停，进度已保存', 2500)
      this.updateFoot()
    },

    prevPage() {
      if (this.pageIndex > 0) {
        this.showPage(this.pageIndex - 1)
        this.saveLast()
      }
    },

    nextPage() {
      if (this.pageIndex < this.pages.length - 1) {
        this.showPage(this.pageIndex + 1)
        this.saveLast()
      } else {
        this.nextChapter()
      }
    },

    prevChapter() {
      if (this.chapterIndex > 0) this.openChapter(this.chapterIndex - 1)
    },

    nextChapter() {
      if (this.chapterIndex + 1 < this.total) this.openChapter(this.chapterIndex + 1)
    },

    backToToc() {
      this.tocCursor = this.chapterIndex
      this.view = 'toc'
      this.renderToc()
      this.syncChrome()
    },

    // ---------- 阅读页刷新：本章正文 + 目录一起重抓 ----------
    async refreshReading() {
      if (this.refreshing || !this.book || this.chapterIndex < 0) return
      // 刷新必须联网，先探一次；不再拿 20 秒前的负结果直接判死
      if (!(await this.ensureOnline(true))) {
        this.flash('离线，无法刷新；检查网络后点顶栏「离线」', 4000)
        return
      }
      this.refreshing = true
      this.refreshLabel = '刷新中'
      this.flash('正在刷新本章与目录…', 6000)
      const idx = this.chapterIndex
      const bid = this.book.bid
      // 刷新后按字符偏移找回原位置，正文有增删也不至于跳章首
      const keep = this.curCharOff()
      const t0 = Date.now()
      let msg = ''
      let ok = false
      try {
        await this.refreshToc(idx)
        const c = this.chapMap[idx]
        if (!c) throw new Error('章节信息缺失')
        const text = await this.fetchChapterFresh(bid, c)
        if (!text) throw new Error('本章没抓到内容')
        const wrote = await P.writeCache(bid, c.cid, text)
        if (wrote) this.cachedSet[c.cid] = 1
        this.tocDirty = true
        this.rawText = text
        this.rebuildBlocks(text)
        this.loading = ''
        this.restoreOff(keep)
        this.rebuildPrefetch(idx)
        this.saveLast(true)
        msg = '已刷新 · 第 ' + (idx + 1) + ' 章 · 目录 ' + this.total + ' 章'
        ok = true
      } catch (e) {
        msg = '刷新失败：' + ((e && e.message) || e)
      }
      this.refreshing = false
      this.refreshLabel = '刷新'
      this.flash(msg, 4200)
    },

    // 目录刷新：本地目录缓存整本作废，先重抓当前章所在目录页（总章数也就更新了），
    // 其余页保留「未加载」状态，翻到那一屏时再按需重抓。
    async refreshToc(idx) {
      const bid = this.book.bid
      // 目录整体作废：紧凑缓存目录直接删，旧版 html 也一并清掉
      await P.clearTocTxt(bid)
      const oldPages = Math.max(1, Math.ceil((this.total || 0) / 100))
      for (let p = 1; p <= oldPages; p++) {
        await P.rm(P.tocHtmlPath(bid, p))
      }
      this.chunkLoaded = {}
      this.chunkLoading = {}
      await this.ensureChunk(tocPageOf(idx))
      if (this.view === 'toc') this.renderToc()
    },

    async fetchChapterFresh(bid, c) {
      // 第三方源：交给适配器（一章一个请求），走和阅读页同一条路径，避免两套解析
      const ad = this.bookAdapter()
      if (ad) return this.fetchChapter(bid, c)
      const out = P.scratchPath('rf_' + c.cid + '.html')
      await P.rm(out)
      await P.rm(out + '.ok')
      const html = await this.fetchUrl(P.urlChapter(bid, c.cid), out, 30)
      await P.rm(out)
      if (!html) return ''
      const parsed = parseChapter(html, c.title)
      return parsed.paras.join('\n')
    },

    // ---------- 预取 / 下载引擎 ----------
    rebuildPrefetch(idx) {
      this.pfQueue = []
      this.pfDone = 0
      this.pfTarget = 0
      if (!this.online) {
        this.updateFoot()
        return
      }
      if (!this.bgOK) {
        this.updateFoot()
        return
      }
      // 统计「后 5 章」的就绪情况：已缓存的也算进度，这样用户能看到 5/5
      for (let k = 1; k <= 5; k++) {
        const j = idx + k
        if (j >= this.total) break
        const c = this.chapMap[j]
        if (!c) continue
        this.pfTarget++
        if (this.cachedSet[c.cid]) this.pfDone++
        else this.pfQueue.push({ idx: j, cid: c.cid })
      }
      this.updateFoot()
    },

    // 命中 429：这一章放回队列头部而不是记失败，整体冷却；连续命中就拉长冷却
    // 从响应头里取 Retry-After（支持秒数与 HTTP-date 两种写法，RFC 6585）
    parseRetryAfter(txt) {
      const rows = String(txt || '').split('\n')
      for (let i = rows.length - 1; i >= 0; i--) {
        const m = /^retry-after:\s*(.+)$/i.exec(rows[i].trim())
        if (!m) continue
        const v = m[1].trim()
        if (/^\d+$/.test(v)) {
          const n = parseInt(v, 10)
          if (n > 0) return n
        }
        const t = Date.parse(v)
        if (!isNaN(t)) {
          const sec = Math.round((t - Date.now()) / 1000)
          if (sec > 0) return sec
        }
      }
      return 0
    },

    hitRateLimit(it, cid, raSec) {
      this.rlHits = (this.rlHits || 0) + 1
      // 实测（MEB0700009006978）：触发 429 后 +10s、+20s 探测仍是 429，+30s 才恢复。
      // 服务端给了 Retry-After 就按它来（省时间）；没给才用有上限的指数退避。
      let base = 0
      if (raSec && raSec > 0) base = clamp(raSec * 1000, 5000, 120000)
      else base = it ? Math.min(30000, 6000 * Math.pow(2, Math.min(2, this.rlHits - 1))) : 30000
      // 抖动 ±10%：固定节拍会和站点窗口共振，多台设备同时重试也会二次触发限流
      const wait = Math.round(base * (0.9 + Math.random() * 0.2))
      this.netCooldown = Date.now() + wait
      // 撞限流说明这个窗口的配额已经用光，排程整体往后推
      this.rlNextAt = Date.now() + wait
      if (it && it.dl && this.dl) {
        const tries = it.tries || 0
        if (tries < 8) {
          this.dl.queue.unshift({ idx: it.idx, cid: cid, tries: tries + 1 })
        } else {
          this.dl.fail++
          this.dl.failed.push({ cid: cid, idx: it.idx, why: '限流 429（已重试 8 次）' })
        }
      }
      const sec = Math.round(wait / 1000)
      // 已暂停/已停下时不要改进度条文案，否则用户看到「限流冷却」会以为还在跑
      if (this.dl && this.dl.running) {
        this.dlText = '站点限流 · 冷却 ' + sec + 's'
        this.flash('站点限流，' + sec + ' 秒后自动继续', 3000)
      }
    },

    // ---------- 漏桶节拍：按章节间隔匀速发，且严格不越过「60 秒窗口内 15 次」 ----------
    // 只靠固定 2.6s 节拍会踩边界：某一分钟里挤进 15+ 次就吃 429，冷却 30s 反而更慢。
    // 这里维护一份「最近 60 秒实际发出请求的时间戳」，满 14 次就等到最早那条过期
    // （留 1 次余量），本质是 RFC 6585 建议的客户端滑窗限速。
    rlSlot(n) {
      const now = Date.now()
      const W = 60000
      const MAX = 14
      const GAP = 2600
      if (!this.rlLog) this.rlLog = []
      let t = Math.max(now, this.rlNextAt || 0)
      for (let i = 0; i < n; i++) {
        while (this.rlLog.length && t - this.rlLog[0] >= W) this.rlLog.shift()
        if (this.rlLog.length >= MAX) {
          t = this.rlLog[0] + W + 300
          while (this.rlLog.length && t - this.rlLog[0] >= W) this.rlLog.shift()
        }
        this.rlLog.push(t)
        this.rlLog.sort(function (a, b) {
          return a - b
        })
        t += GAP
      }
      this.rlNextAt = t
    },

    // 一批多章交给同一个 curl 进程：复用 TLS 连接，单章 4.5s → 2.2s（实测）
    batchLaunch(jobs, dl) {
      const bid = this.book.bid
      const key = 'b' + Date.now() + '_' + Math.floor(Math.random() * 1000)
      const cfg = P.scratchPath(key + '.cfg')
      const log = P.scratchPath(key + '.log')
      const ok = P.scratchPath(key + '.ok')
      const hdr = P.scratchPath(key + '.hdr')
      const lines = []
      const items = []
      // 存一份响应头：撞 429 时能从 Retry-After 读到服务端要求的等待时间，
      // 比我们自己猜 30 秒更省时间（RFC 6585：有 Retry-After 就按它来）
      lines.push('dump-header = "' + hdr + '"')
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]
        const dest = P.scratchPath('ch_' + job.cid + '.html')
        if (i > 0) lines.push('next')
        lines.push('url = "' + P.urlChapter(bid, job.cid) + '"')
        lines.push('output = "' + dest + '"')
        // 每章的 HTTP 码由 curl 写一行到 stdout，事后能逐章判定（429 要单独认）
        lines.push('write-out = "' + job.cid + ' %{http_code}\\n"')
        items.push({ cid: job.cid, idx: job.idx, dest: dest, tries: job.tries || 0 })
        this.inflight[job.cid] = { batch: key }
      }
      const rec = { key: key, cfg: cfg, log: log, ok: ok, hdr: hdr, items: items, t0: Date.now(), timeout: 40, dl: !!dl }
      this.batches.push(rec)
      P.writeFile(cfg, lines.join('\n')).then(function () {
        P.fetchBatch(cfg, log, ok, 40)
      })
      return rec
    },

    batchOf(key) {
      for (let i = 0; i < this.batches.length; i++) {
        if (this.batches[i].key === key) return this.batches[i]
      }
      return null
    },

    async batchCollect() {
      for (let bi = this.batches.length - 1; bi >= 0; bi--) {
        const b = this.batches[bi]
        const fin = await P.exists(b.ok)
        const expired = Date.now() - b.t0 > b.timeout * 1000 + 12000
        if (!fin && !expired) continue
        let logTxt = ''
        if (fin) logTxt = (await P.readFile(b.log)) || ''
        const codes = {}
        const rows = String(logTxt).split('\n')
        for (let i = 0; i < rows.length; i++) {
          const p = rows[i].trim().split(/\s+/)
          if (p.length >= 2) codes[p[0]] = p[1]
        }
        let limited = false
        for (let i = 0; i < b.items.length; i++) {
          const it = b.items[i]
          const code = codes[it.cid] || ''
          let good = false
          let why = ''
          if (code === '200') {
            const txt = await P.readFile(it.dest)
            if (txt && txt.length > 300) {
              // 缓存统一存「正文纯文本」：直接存 HTML 会让阅读页把整页源码当正文
              const ci = this.chapMap[it.idx]
              const body = parseChapter(txt, ci ? ci.title : '').paras.join('\n')
              if (body && body.length > 80) {
                const wrote = await P.writeCache(this.book.bid, it.cid, body)
                if (wrote) {
                  this.cachedSet[it.cid] = 1
                  this.tocDirty = true
                  good = true
                  this.rlHits = 0
                } else {
                  why = '存不下（存储异常）'
                  this.storageFail++
                }
              } else {
                why = '解析不出正文'
              }
            } else {
              why = '内容过短 ' + (txt ? txt.length : 0) + 'B'
            }
          } else if (code === '429') {
            limited = true
            why = '429'
          } else if (code === '404') {
            why = '404'
          } else if (!code) {
            why = expired ? '超时未返回' : '无响应'
          } else {
            why = 'HTTP ' + code
          }
          await P.rm(it.dest)
          delete this.inflight[it.cid]
          if (good) {
            if (b.dl && this.dl) this.dl.done++
            else this.pfDone++
          } else if (limited) {
            // 限流不是失败：放回队首等冷却，不计失败次数
            if (b.dl && this.dl) this.dl.queue.unshift({ idx: it.idx, cid: it.cid, tries: it.tries })
          } else if (b.dl && this.dl) {
            if (it.tries < 2 && why !== '404') {
              this.dl.queue.push({ idx: it.idx, cid: it.cid, tries: it.tries + 1 })
            } else {
              this.dl.fail++
              this.dl.failed.push({ cid: it.cid, idx: it.idx, why: why })
            }
          }
        }
        // 撞限流时优先按服务端给的 Retry-After 冷却；没有这个头才退回自己的退避
        let raSec = 0
        if (limited && fin) raSec = this.parseRetryAfter(await P.readFile(b.hdr))
        await P.rm(b.cfg)
        await P.rm(b.log)
        await P.rm(b.ok)
        await P.rm(b.hdr)
        this.batches.splice(bi, 1)
        if (limited) this.hitRateLimit(null, null, raSec)
      }
    },

    launch(job, timeout) {
      const bid = this.book.bid
      const dest = P.scratchPath('ch_' + job.cid + '.html')
      if (this.inflight[job.cid]) return
      P.fetchBg(P.urlChapter(bid, job.cid), dest, timeout || 30)
      this.inflight[job.cid] = {
        dest: dest,
        idx: job.idx,
        t0: Date.now(),
        timeout: timeout || 30,
        tries: job.tries || 0,
        dl: !!job.dl
      }
    },

    async tick() {
      if (this.ticking) return
      if (!this.booted) return
      this.ticking = true
      try {
        // 0. 离线心跳：约每 2.7s 探一次，一旦恢复立刻改状态并续上被挂起的动作。
        //    原来 this.online 一旦变 false 就再没有任何路径会把它改回来。
        if (!this.online) {
          this.netTick++
          if (this.netTick % 6 === 0) {
            const up = await P.netUp(true)
            if (up !== false) {
              this.online = true
              this.syncChrome()
              this.updateFoot()
              this.flash('网络已恢复', 3000)
              await this.afterOnline()
            }
          }
        }
        if (!this.book) return
        // 后台进程不可用时的降级下载：在 tick 内逐章同步抓，慢但能真正下下来
        // 第三方源也走这条：Legado 规则没有批量语法，拼不出整本 curl 配置
        if (this.dl && this.dl.running && (!this.bgOK || this.bookAdapter())) await this.dlStepSync()
        // 1. 收尾：批量（连接复用）与单章（预取）两条路径
        await this.batchCollect()
        const cids = Object.keys(this.inflight)
        for (let i = 0; i < cids.length; i++) {
          const cid = cids[i]
          const it = this.inflight[cid]
          if (it.batch) continue
          if (await P.exists(it.dest + '.ok')) {
            const codeS = await P.readFile(it.dest + '.code')
            const code = parseInt(String(codeS || '0').trim(), 10) || 0
            const txt = await P.readFile(it.dest)
            let good = false
            let why = ''
            // 站点限流：这不是"章节坏了"，必须放回队列等冷却，否则整本会雪崩成失败
            if (code === 429 || (txt && txt.length < 120 && String(txt).indexOf('429') >= 0)) {
              this.hitRateLimit(it, cid)
              await P.rm(it.dest + '.ok')
              await P.rm(it.dest + '.code')
              await P.rm(it.dest)
              delete this.inflight[cid]
              continue
            }
            if (txt && txt.length > 300) {
              // 缓存统一存「正文纯文本」：直接存 HTML 会让阅读页把整页源码当正文
              const ci = this.chapMap[it.idx]
              const body = parseChapter(txt, ci ? ci.title : '').paras.join('\n')
              if (body && body.length > 80) {
                const wrote = await P.writeCache(this.book.bid, cid, body)
                if (wrote) {
                  this.cachedSet[cid] = 1
                  this.tocDirty = true
                  good = true
                  this.rlHits = 0
                } else {
                  why = '存不下（存储异常）'
                  this.storageFail++
                }
              } else {
                why = '解析不出正文（' + (code || '?') + '/' + txt.length + 'B）'
              }
            } else {
              why = txt ? '内容过短 ' + txt.length + 'B（HTTP ' + (code || '?') + '）' : '没抓到内容（HTTP ' + (code || '?') + '）'
            }
            await P.rm(it.dest + '.ok')
            await P.rm(it.dest + '.code')
            await P.rm(it.dest)
            delete this.inflight[cid]
            if (it.dl && this.dl) {
              if (good) this.dl.done++
              else {
                // 普通失败先重试一次，再记失败
                const tries = it.tries || 0
                if (tries < 2 && code !== 404) {
                  this.dl.queue.push({ idx: it.idx, cid: cid, tries: tries + 1 })
                  why = ''
                } else {
                  this.dl.fail++
                  this.dl.failed.push({ cid: cid, idx: it.idx, why: why })
                }
              }
            } else if (good) {
              this.pfDone++
            }
          } else if (Date.now() - it.t0 > it.timeout * 1000 + 8000) {
            await P.rm(it.dest + '.ok')
            await P.rm(it.dest + '.code')
            await P.rm(it.dest)
            delete this.inflight[cid]
            if (it.dl && this.dl) {
              this.dl.fail++
              this.dl.failed.push({ cid: cid, idx: it.idx, why: '超时 ' + it.timeout + 's' })
            }
          }
        }

        // 2. 派发：按站点配额匀速发（实测 15 次/30 秒，超出立刻 429）。
        //    以前是"并发 2 个、每 tick 放 1 个"，两个请求一起回、窗口瞬间打满，
        //    接着连吃冷却，实际吞吐只有 8~10 章/分钟。
        const now = Date.now()
        const cooling = now < (this.netCooldown || 0)
        const ready = now >= (this.rlNextAt || 0)
        if (this.dl && this.dl.running && !this.bgOK) {
          // 同步分支在 dlStepSync 里处理，不走这里
        } else if (!cooling && ready) {
          if (this.view === 'read' && this.pfQueue.length) {
            // 阅读中优先喂当前章之后的几章：用户翻页要紧，后台整本下载往后排
            const head = this.pfQueue[0]
            if (head.idx > this.chapterIndex + 5 || head.idx <= this.chapterIndex) {
              this.pfQueue.shift()
            } else {
              this.rlSlot(1)
              this.launch(this.pfQueue.shift(), 30)
            }
          } else if (this.dl && this.dl.running && this.dl.queue && this.dl.queue.length) {
            let dlBusy = false
            for (let i = 0; i < this.batches.length; i++) {
              if (this.batches[i].dl) dlBusy = true
            }
            if (!dlBusy) {
              const n = Math.min(4, this.dl.queue.length)
              const jobs = []
              for (let i = 0; i < n; i++) {
                const j = this.dl.queue.shift()
                j.dl = true
                jobs.push(j)
              }
              this.rlSlot(jobs.length)
              this.batchLaunch(jobs, true)
            }
          }
        }

        // 3. 下载进度
        if (this.dl && this.dl.running) {
          this.updateDlBar()
          const left = this.dl.queue ? this.dl.queue.length : 0
          if (!left && !Object.keys(this.inflight).length) {
            this.dl.running = false
            await this.finishDl()
          } else {
            this.dlLabel = '暂停 ' + this.dl.done + '/' + this.dl.total
            if (this.view === 'toc') this.hMeta = '缓存中 ' + this.dl.done + '/' + this.dl.total
            // 每 10 章落一次盘：退出应用后能续，不必每分钟写 state.json
            if (this.dl.done - (this.dlSavedDone || 0) >= 10) {
              this.dlSavedDone = this.dl.done
              this.persistDl()
            }
          }
        }
        if (this.view === 'read') this.updateFoot()
        // 目录页上要能实时看到「存」角标，否则整本下载时毫无反馈
        if (this.view === 'toc' && this.tocDirty) {
          this.tocDirty = false
          this.renderToc()
        }
      } finally {
        this.ticking = false
      }
    },

    // 后台进程不可用时的降级：一次 tick 抓一章（同步 curl），慢但不再"点了没反应"
    async dlStepSync() {
      const dl = this.dl
      if (!dl) return
      if (Date.now() < (this.netCooldown || 0)) return
      // 同步降级路径同样要按配额走，否则一口气把窗口打满，后面全是 429
      if (Date.now() < (this.rlNextAt || 0)) return
      this.rlSlot(1)
      if (!dl.queue || !dl.queue.length) {
        dl.running = false
        await this.finishDl()
        return
      }
      const job = dl.queue.shift()
      const c = this.chapMap[job.idx] || { cid: job.cid, title: '' }
      const txt = await this.fetchChapterFresh(this.book.bid, c)
      // 同步路径同样要认 429，否则限流会被当成"章节坏了"
      if (txt && txt.length < 120 && txt.indexOf('429') >= 0) {
        this.hitRateLimit({ idx: job.idx, dl: true, tries: job.tries || 0 }, job.cid)
        return
      }
      if (txt && txt.length > 80) {
        const wrote = await P.writeCache(this.book.bid, job.cid, txt)
        if (wrote) {
          this.cachedSet[job.cid] = 1
          this.tocDirty = true
          dl.done++
          this.rlHits = 0
        } else {
          dl.fail++
          this.storageFail++
          dl.failed.push({ idx: job.idx, cid: job.cid, why: '存储' })
        }
      } else {
        dl.fail++
        dl.failed.push({ cid: job.cid, idx: job.idx, why: '同步抓取失败' })
      }
      this.dlLabel = '暂停 ' + dl.done + '/' + dl.total
      this.updateDlBar()
      if (!dl.queue.length) {
        dl.running = false
        await this.finishDl()
      }
    },

    updateDlBar() {
      const dl = this.dl
      if (!dl || !dl.total) {
        this.dlFillPx = 0
        this.dlText = ''
        this.dlPct = 0
        return
      }
      const pct = clamp(Math.round((dl.done / dl.total) * 100), 0, 100)
      this.dlPct = pct
      // 框架里百分比宽度不可靠，直接按轨道 600px 折算成像素
      this.dlFillPx = Math.round((600 * pct) / 100)
      let t = (dl.from ? '第' + (dl.from + 1) + '章起 · ' : '') + dl.done + '/' + dl.total + ' · ' + pct + '%'
      const failN = dl.failed ? dl.failed.length : 0
      if (failN) t += ' · 失败 ' + failN
      // 限流冷却期间明确告诉用户在等什么，而不是看起来"卡住"
      if (Date.now() < (this.netCooldown || 0)) {
        t = '站点限流 · 冷却 ' + Math.ceil((this.netCooldown - Date.now()) / 1000) + 's · ' + dl.done + '/' + dl.total
      } else if (dl.running && dl.startDone != null && dl.t0 && dl.done > dl.startDone) {
        const per = (Date.now() - dl.t0) / 1000 / (dl.done - dl.startDone)
        const left = Math.max(0, dl.total - dl.done)
        if (per > 0 && left > 0) {
          const min = Math.round((per * left) / 60)
          t += min > 0 ? ' · 约 ' + min + ' 分钟' : ' · 快好了'
        }
      }
      this.dlText = t
    },

    async finishDl() {
      const dl = this.dl
      if (!dl) return
      dl.paused = false
      const failN = dl.failed ? dl.failed.length : 0
      this.dlLabel = failN ? '重试 ' + failN + ' 章' : '重新缓存'
      this.hMeta = '缓存完成 ' + dl.done + ' 章' + (failN ? ' · 失败 ' + failN : '')
      this.updateDlBar()
      this.persistDl(null)
      if (this.storageFail) {
        this.flash('缓存 ' + dl.done + ' 章，' + this.storageFail + ' 章存不下（存储异常，设置页可自检）', 6000)
      } else {
        this.flash('缓存完成 ' + dl.done + ' 章' + (failN ? '，失败 ' + failN + '（点重试）' : ''), 5000)
      }
    },

    // rec 传 null 表示"这次任务已结束，不用续"；不传则按当前 dl 自动生成
    persistDl(rec) {
      const dl = this.dl
      let r = rec
      if (r === undefined) {
        r =
          dl && dl.total
            ? {
                bid: dl.bid || (this.book && this.book.bid),
                from: dl.from || 0,
                done: dl.done,
                total: dl.total,
                fail: dl.fail,
                at: Date.now()
              }
            : null
      }
      this.dlResume = r
      this.stateAt = 0
      this.saveDirty = true
      this.flushState()
    },

    // ---------- 整本下载 ----------
    // 目录页那个「缓存」按钮：正在跑就暂停，暂停中/有失败就继续，否则先问起点
    tapCacheBtn() {
      if (this.dl && !this.dl.running && (this.dl.failed || []).length) {
        this.toggleDownload()
        return
      }
      if (this.dl && this.dl.running) {
        this.toggleDownload()
        return
      }
      if (this.dl && this.dl.queue && this.dl.queue.length) {
        this.toggleDownload()
        return
      }
      // 有「待续」任务（上次没下完）时直接续，不再让用户重选起点
      if (this.dlResume && this.book && this.dlResume.bid === this.book.bid) {
        this.toggleDownload()
        return
      }
      this.openDlFrom()
    },

    // 点「缓存」→ 选起点 → 真正开始。默认起点是当前章，直接确认就是从这章往后存
    async toggleDownload() {
      if (this.dl && this.dl.running) {
        this.dl.running = false
        // 暂停后进度条要继续显示，否则用户找不到「继续」
        this.dl.paused = true
        this.dlLabel = '继续缓存'
        // 暂停就把冷却清掉，否则进度条还挂着「限流冷却 Ns」，看着像没停下来
        this.netCooldown = 0
        this.updateDlBar()
        this.persistDl()
        this.flash('已暂停，进度已保存', 3000)
        return
      }
      if (!this.book) return
      if (!this.total) {
        this.hMeta = '目录未就绪，先刷新'
        return
      }
      // 有失败章优先重试，否则从第一处没存的地方重新算队列
      if (this.dl && this.dl.failed && this.dl.failed.length) {
        const q = this.dl.failed.slice()
      this.dl = {
        running: true,
        paused: false,
        bid: this.book.bid,
        from: this.dl.from || 0,
          total: q.length,
          done: 0,
          startDone: 0,
          t0: Date.now(),
          fail: 0,
          failed: [],
          queue: q
        }
        this.dlLabel = '暂停 0/' + q.length
        return
      }
      await this.startDownload(this.dlFromIdx())
    },

    // 起点：优先沿用当前任务/上次任务的起点，否则用当前正在读的章
    dlFromIdx() {
      if (this.dl && typeof this.dl.from === 'number') return this.dl.from
      if (this.dlResume && this.dlResume.bid === (this.book && this.book.bid) && typeof this.dlResume.from === 'number') {
        return this.dlResume.from
      }
      return this.chapterIndex > 0 ? this.chapterIndex : 0
    },

    async startDownload(fromIdx) {
      if (!this.book) return
      // 联网前统一过一道网络判定：原来只读 this.online，一旦被判离线就永久失败
      if (!(await this.ensureOnline(true))) {
        this.pendingDl = true
        // 记住这次请求的起点，联网后按"用户刚才要的"续，而不是回到上次的旧任务
        this.pendingDlFrom = fromIdx
        this.hMeta = '离线 · 联网后自动开始缓存'
        this.flash('离线，已记下；联网后自动从第 ' + (Math.max(0, Number(fromIdx) || 0) + 1) + ' 章开始', 4500)
        return
      }
      // 目录还没落地时 total 是 0，先抓第 1 页拿到总章数，
      // 否则起点会被 clamp 成 0（整本书从头重算，看起来像"没理会我选的章"）
      if (!this.total) await this.ensureChunk(1)
      let from = clamp(Number(fromIdx) || 0, 0, Math.max(0, this.total - 1))
      // 目录全部抓齐（并发 4 页）：队列依赖 chapMap，缺页会让后半本静默消失
      const pages = Math.ceil(this.total / 100)
      const list = []
      for (let p = 1; p <= pages; p++) list.push(p)
      await this.ensureTocPages(list)
      // 起点那一章拿不到目录（常见于后半本目录页抓失败）就退到第一个有数据的章，
      // 而不是直接判定"下不了"——这是用户反馈"一本也下不了"的主要成因
      if (!this.chapMap[from]) {
        let first = -1
        for (let i = 0; i < this.total; i++) {
          if (this.chapMap[i]) {
            first = i
            break
          }
        }
        if (first < 0) {
          this.hMeta = '目录一页都没抓到，先刷新目录'
          return
        }
        from = first
      }
      const queue = []
      let done = 0
      let missing = 0
      for (let i = from; i < this.total; i++) {
        const c = this.chapMap[i]
        if (!c) {
          missing++
          continue
        }
        if (this.cachedSet[c.cid]) {
          done++
          continue
        }
        queue.push({ idx: i, cid: c.cid })
      }
      if (!queue.length) {
        this.hMeta = done ? '这些章节都已缓存' : '没有可缓存的章节'
        return
      }
      this.dlFailed = []
      this.storageFail = 0
      this.dl = {
        running: true,
        paused: false,
        bid: this.book.bid,
        from: from,
        total: queue.length + done,
        done: done,
        startDone: done,
        t0: Date.now(),
        fail: 0,
        failed: [],
        queue: queue
      }
      this.dlLabel = '暂停 ' + done + '/' + (queue.length + done)
      this.hMeta = '从第 ' + (from + 1) + ' 章开始 · 待存 ' + queue.length + ' 章'
      this.dlResume = null
      this.updateDlBar()
      this.persistDl()
      // 后台能力不可用时也别直接放弃：走同步逐章，慢但能用
      if (!this.bgOK) this.flash('逐章同步缓存（较慢，别离开目录页）', 5000)
      else if (queue.length > 0) {
        // 站点自己限流（实测 15 次/30 秒），客户端只能贴着这个上限跑；先说清预期
        const mins = Math.max(1, Math.round(queue.length / 14))
        this.flash('已开始，站点限速约 14 章/分钟，剩 ' + queue.length + ' 章约 ' + mins + ' 分钟', 5000)
      }
    },

    // ---------- 缓存 / 书架 ----------
    // 旧版把整页目录 HTML 存在书目录下（124KB/页），启动时一次性转成紧凑文本
    async compactLegacyToc() {
      let books = []
      try {
        books = await P.listBookDirs()
      } catch (e) {
        return
      }
      for (let i = 0; i < books.length; i++) {
        const bid = books[i]
        const pages = await P.legacyTocPages(bid)
        for (let j = 0; j < pages.length; j++) {
          const html = await P.readFile(P.tocHtmlPath(bid, pages[j]))
          if (!html) continue
          const parsed = parseToc(html, bid)
          if (!parsed.chapters.length) continue
          await P.writeTocTxt(bid, pages[j], tocToText(parsed))
          await P.rm(P.tocHtmlPath(bid, pages[j]))
        }
      }
    },

    async refreshCache() {
      // 统计本身会 fork 一个 shell 扫目录，失败时**不能**把列表清空当成事实：
      // 用户看到的就是「书全没了」，实际上文件都在。所以失败直接保留上一次的结果。
      let s = null
      try {
        s = await P.cacheSummary()
      } catch (e) {
        return
      }
      this.cacheBytes = s.bytes || 0
      this.cacheChapters = s.chapters || 0
      this.cacheText = s.chapters + ' 章 · ' + kb(this.cacheBytes)
      const items = []
      for (let i = 0; i < s.items.length; i++) {
        const b = s.items[i]
        items.push({
          bid: b.bid,
          title: b.title,
          author: b.author,
          total: b.total,
          count: b.count,
          size: kb(b.bytes || b.kb * 1024),
          onlyToc: !!b.onlyToc
        })
      }
      this.shelfAll = items
      this.cacheBooks = s.books
      if (this.shelfCursor > Math.max(0, items.length - 1)) this.shelfCursor = 0
      this.renderShelf()
      // 存储余量：写不进去的时候用户至少能提前看到。
      // df 是一次 execShell（实测 100ms 上下），只有书架页需要显示它，
      // 首页刷新时白花这 100ms 去卡一拍点击毫无意义。
      if (this.view === 'cache') {
        try {
          this.freeKB = await P.freeKB()
        } catch (e) {}
      }
      const parts = []
      if (s.bodyKB > 0) parts.push('正文 ' + kb(s.bodyKB * 1024))
      if (s.tocKB > 0) parts.push('目录 ' + kb(s.tocKB * 1024))
      if (this.freeKB > 0) parts.push('剩余 ' + kb(this.freeKB * 1024))
      this.cacheDetail = s.books > 0 ? parts.join(' · ') : '还没有下载任何章节'
      // 原来这里不刷顶栏，清空后还写着「9 本已下载」
      this.syncChrome()
      const restored = await this.shelfWatch(s.books)
      if (restored) await this.refreshCache()
    },

    // 书架「意外变空」的看门狗。
    // 记录：上次有多少本、在哪个目录；这次若是 0 且不是用户点的清空，
    // 就把现场写进 app.log，并去其它候选目录找书搬回来。
    async shelfWatch(now) {
      if (this.shelfGuardBusy) return false
      this.shelfGuardBusy = true
      try {
        let prev = this.snapObj
        if (!this.snapLoaded) {
          prev = await P.readShelfSnap()
          this.snapObj = prev
          this.snapLoaded = true
        }
        if (prev && prev.books > 0 && now === 0 && !this.clearing) {
          let found = []
          try {
            found = await P.findBooksElsewhere()
          } catch (e) {}
          if (found.length) {
            const n = await P.restoreBooks(found[0].p)
            if (n > 0) {
              this.flash('已恢复书架（上次的存储目录变了）', 5000)
              this.snapObj = null
              this.snapLoaded = true
              return true
            }
          }
        }
        if (now > 0) {
          this.snapObj = { at: Date.now(), dir: this.DIR, books: now, chapters: this.cacheChapters }
          await P.saveShelfSnap(this.snapObj)
        }
        return false
      } finally {
        this.shelfGuardBusy = false
      }
    },


    // 书架分页：一屏 5 本，越界靠翻屏（原来 slice(0,4)，第 5 本起连渲染都没有）
    renderShelf() {
      const all = this.shelfAll || []
      const total = all.length
      if (!total) {
        this.cacheItems = []
        this.shelfRange = '0/0'
        return
      }
      const w = windowOf(this.shelfCursor, total, SHELF_ROWS)
      this.shelfCursor = w.from
      const rows = []
      for (let i = w.from; i < w.to; i++) {
        const b = all[i]
        let meta = b.count > 0 ? b.count + ' 章 · ' + b.size : '仅目录 · 未下载正文'
        // 有未完成的下载任务时在这一行直接给「待续 x/y」
        if (this.dlResume && this.dlResume.bid === b.bid) {
          meta = '待续 ' + (this.dlResume.done || 0) + '/' + (this.dlResume.total || b.total || 0)
        }
        rows.push({
          bid: b.bid,
          title: b.title,
          author: b.author,
          total: b.total,
          count: b.count,
          size: b.size,
          meta: meta,
          armed: !!this.shelfDelArmed[b.bid]
        })
      }
      this.cacheItems = rows
      this.shelfRange = w.from + 1 + '-' + w.to + '/' + total
    },

    shelfPrev() {
      if (this.shelfCursor <= 0) return
      this.shelfCursor = moveCursor(this.shelfCursor, -1, this.shelfAll.length, SHELF_ROWS)
      this.renderShelf()
    },

    shelfNext() {
      if (this.shelfCursor + SHELF_ROWS >= this.shelfAll.length) return
      this.shelfCursor = moveCursor(this.shelfCursor, 1, this.shelfAll.length, SHELF_ROWS)
      this.renderShelf()
    },

    // 书架行点击：管理模式下一律当"删除"，避免和"打开"抢点击
    tapShelfRow(b) {
      if (!b) return
      if (this.shelfManage) {
        this.armShelfDelete(b.bid)
        return
      }
      this.openShelfBook(b)
    },

    toggleShelfManage() {
      this.shelfManage = !this.shelfManage
      this.shelfManageLabel = this.shelfManage ? '完成' : '管理'
      this.shelfDelArmed = {}
      this.renderShelf()
    },

    // 两段式删除：第一下变红确认，第二下才真删（和"清空全部"同一套路）
    async armShelfDelete(bid) {
      if (!this.shelfDelArmed[bid]) {
        this.shelfDelArmed[bid] = 1
        this.shelfDelArmed = Object.assign({}, this.shelfDelArmed)
        this.renderShelf()
        return
      }
      await P.removeBook(bid)
      delete this.shelfDelArmed[bid]
      this.shelfDelArmed = Object.assign({}, this.shelfDelArmed)
      if (this.book && this.book.bid === bid) this.book = null
      if (this.dlResume && this.dlResume.bid === bid) this.dlResume = null
      await this.refreshCache()
      this.hMeta = '已移除 1 本'
    },

    // 从书架直接打开：完全不依赖网络，目录与正文都走本地
    async openShelfBook(b) {
      if (!b || !b.bid) return
      this.book = { bid: b.bid, title: b.title || b.bid, author: b.author || '' }
      this.chapMap = {}
      this.chunkLoaded = {}
      this.chunkLoading = {}
      this.cachedSet = {}
      this.inflight = {}
      this.pfQueue = []
      this.dl = null
      this.dlLabel = '缓存'
      this.dlFailed = []
      this.dlText = ''
      this.dlFillPx = 0
      this.offlineMode = false
      this.offlineCids = []
      this.tocCursor = 0
      this.total = 0
      this.view = 'toc'
      this.tocRows = []
      this.tocRange = '加载中…'
      this.syncChrome()
      const cids = await P.cachedCids(b.bid)
      for (let i = 0; i < cids.length; i++) this.cachedSet[cids[i]] = 1
      // 不再信任 meta.total：目录抓取失败时它会被写成 0，之后正文躺在磁盘上却一章都点不进
      const tm = await P.tocMeta(b.bid)
      let total = tm.total || 0
      if (!total && tm.pages > 0) total = tm.pages * 100
      if (!total && b.total > 0) total = b.total
      if (tm.title && this.book && !this.book.title) this.book.title = tm.title
      this.total = total
      if (!total) {
        // 只有正文、没有目录：把已下载章节直接列出来，别让它停在「加载中…」
        this.setupOfflineToc(cids)
        return
      }
      await this.ensureChunk(1)
      this.renderToc()
      await this.saveMeta()
      // 上次没下完的任务：按钮直接变「继续 735/952」，点一下就接着跑
      if (this.dlResume && this.dlResume.bid === b.bid) {
        this.dlLabel = '继续 ' + (this.dlResume.done || 0) + '/' + (this.dlResume.total || total)
        this.flash('上次缓存到 ' + (this.dlResume.done || 0) + ' 章，可继续', 4000)
      }
    },

    // 离线降级：目录丢了就用已下载正文列表顶上，至少能读
    setupOfflineToc(cids) {
      const ids = (cids || []).slice()
      ids.sort(function (a, b) {
        return Number(a) - Number(b)
      })
      this.offlineMode = true
      this.offlineCids = ids
      this.chunkLoaded = { 1: true }
      this.chapMap = {}
      for (let i = 0; i < ids.length; i++) {
        this.chapMap[i] = { cid: ids[i], title: '已下载章节 ' + (i + 1) }
      }
      this.total = ids.length
      this.tocCursor = 0
      this.renderToc()
      this.syncChrome()
      if (!ids.length) this.hMeta = '这本书没有可读内容'
      else this.flash('目录缺失，已按本地正文列出 ' + ids.length + ' 章', 5000)
    },

    // ============================================================
    // 书源 / CDN / 搜索范围
    // 设计取舍：配置对象（带完整 Legado 规则）放模块级 STORE，不进 data。
    // 界面上只放「渲染行」，这样 60+ 个源也不会让 Vue 每次 setData 都深度遍历。
    // ============================================================

    // 首次进设置页才读盘；loadJsonConf 走 loadBoth（文件优先、storage 兜底）
    async ensureStore() {
      if (STORE.loaded) return
      if (STORE.loading) return STORE.loading
      STORE.loading = (async function () {
        let s = null
        let c = null
        let n = null
        try { s = await P.loadJsonConf('sources.json') } catch (e) {}
        try { c = await P.loadJsonConf('cdn.json') } catch (e) {}
        try { n = await P.loadJsonConf('net.json') } catch (e) {}
        const native = recordFromNative(P.SITE)
        let list = (s && s.list) || []
        if (!list.length) list = [native]
        else if (!list.some(function (x) { return x && x.id === NATIVE_ID })) list.unshift(native)
        for (let i = 0; i < list.length; i++) {
          const r = list[i]
          if (!r) continue
          if (r.status == null) r.status = r.kind === 'native' ? 'ok' : 'untested'
          if (r.priority == null) r.priority = i + 1
          if (r.enabled == null) r.enabled = r.kind === 'native'
          if (r.lastTestAt == null) r.lastTestAt = 0
          if (r.lastMs == null) r.lastMs = 0
          if (r.lastError == null) r.lastError = ''
        }
        // 内置轻小说源（轻之国度等）：老配置里没有就补进来，
        // 已有的保持用户设置的启用状态与优先级
        list = ensureLNRecords(list)
        STORE.srcList = list
        STORE.cdnList = c && c.lines && c.lines.length ? c.lines : defaultLines()
        STORE.cdnTarget = (c && c.target) || CDN_TARGET
        STORE.net = Object.assign({}, DEF_NET, n && n.net ? n.net : (n || {}))
        STORE.cache = createCache(10 * 60 * 1000)
        STORE.loaded = true
        STORE.loading = null
      })()
      return STORE.loading
    },

    async saveSrcConf() {
      try { await P.saveJsonConf('sources.json', { v: 1, list: STORE.srcList }) } catch (e) {}
    },
    async saveCdnConf() {
      try { await P.saveJsonConf('cdn.json', { v: 1, lines: STORE.cdnList, target: STORE.cdnTarget }) } catch (e) {}
    },
    async saveNetConf() {
      try { await P.saveJsonConf('net.json', { v: 1, net: STORE.net }) } catch (e) {}
    },

    // ---------- 书源列表 ----------
    renderSrc() {
      const list = STORE.srcList
      const st = statsOf(list)
      this.srcPages = Math.max(1, Math.ceil(list.length / SRC_ROWS))
      if (this.srcPage > this.srcPages - 1) this.srcPage = this.srcPages - 1
      if (this.srcPage < 0) this.srcPage = 0
      const from = this.srcPage * SRC_ROWS
      const rows = []
      for (let i = from; i < list.length && i < from + SRC_ROWS; i++) {
        const r = list[i]
        const meta = statusText(r.status) + (r.lastMs ? ' · ' + r.lastMs + 'ms' : '') + (r.enabled ? '' : ' · 停用')
        rows.push({
          id: r.id,
          name: ellipsis(r.name || r.id, 20),
          meta: meta,
          color:
            r.status === 'ok' ? '#4ec97a'
              : r.status === 'bad' ? '#e0685f'
                : r.status === 'login' ? '#d0a24a'
                  : r.status === 'fail' ? '#c98a5a' : '#8a8a97',
          on: !!r.enabled
        })
      }
      this.srcRows = rows
      this.enabledCount = st.enabled
      this.srcPageText = this.srcPage + 1 + '/' + this.srcPages + ' · 启用 ' + st.enabled + '/' + st.total
    },

    async goSources() {
      await this.ensureStore()
      this.view = 'sources'
      this.srcMsg = ''
      this.renderSrc()
      this.syncChrome()
    },

    srcPageMove(d) {
      this.srcPage = clamp(this.srcPage + d, 0, this.srcPages - 1)
      this.renderSrc()
    },

    async srcAll(on) {
      await this.ensureStore()
      const list = STORE.srcList
      let n = 0
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === NATIVE_ID) continue
        // 不兼容的源不参与「全选」：选了也搜不出东西，只会拖慢搜索
        if (on && list[i].status === 'bad') continue
        list[i].enabled = !!on
        if (on) n++
      }
      await this.saveSrcConf()
      this.renderSrc()
      this.renderNet()
      this.srcMsg = on ? '已启用 ' + n + ' 个（不兼容的源跳过，未测试的也已启用）' : '已全部停用（书海阁保留）'
    },

    async openCookie(srcId) {
      await this.ensureStore()
      const rec = this.srcRecord(srcId)
      if (!rec) return
      this.ckSrcId = srcId
      this.ckName = rec.name || srcId
      this.ckHost = String(rec.baseUrl || rec.site || '').replace(/^https?:\/\//, '').split('/')[0]
      const v = await P.cookieOf(this.ckHost)
      this.ckBrief = v ? v.length + ' 字符 · ' + String(v).slice(0, 18) + '…' : '未设置（公开章节仍可读）'
      this.ckMsg = rec.login ? '该源标注需要登录' : '该源公开章节免登录'
      this.view = 'cookie'
      this.syncChrome()
    },

    async editCookie() {
      if (!P.initTextEdit) P.initTextEdit = function () { return false }
      const okInit = P.initTextEdit((r) => this.onKbResult(r))
      if (!okInit) {
        this.ckMsg = '系统键盘不可用，无法在机内输入'
        return
      }
      this.kbMode = 'cookie'
      const cur = await P.cookieOf(this.ckHost)
      const uuid = P.openTextEdit(cur || '', { placeholder: '粘贴 Cookie 整串', maxlength: 4000, enterButtonText: '保存' })
      if (!uuid) {
        this.kbMode = 'search'
        this.ckMsg = '唤起键盘失败'
        return
      }
      this.kbUUID = uuid
      this.kbOpen = true
      this.ckMsg = '粘贴后按「保存」'
    },

    async clearCookie() {
      const ok = await P.saveCookie(this.ckHost, '', '')
      this.ckBrief = '未设置'
      this.ckMsg = ok ? '已清除该站 Cookie' : '清除失败（落盘出错）'
    },

    // 真实验证：带着当前 Cookie 抓一次该源首页/接口，看是不是还停在登录态
    async testCookie() {
      this.ckMsg = '验证中…'
      const rec = this.srcRecord(this.ckSrcId)
      if (!rec) {
        this.ckMsg = '源不存在'
        return
      }
      const ad = adapterOf(rec)
      let req = null
      let probe = ''
      try {
        if (rec.kind === 'ln') {
          req = ad.searchRequest('测试', 1)
          probe = '搜索接口'
        } else if (rec.kind === 'legado') {
          req = ad.searchRequest('测试', 1)
          probe = '搜索接口'
        } else {
          req = { url: rec.baseUrl || rec.site }
          probe = '首页'
        }
      } catch (e) {
        this.ckMsg = '构造请求失败：' + emsg(e)
        return
      }
      const out = P.scratchPath('ck_probe.tmp')
      let r = null
      try {
        r = await P.fetchReqEx(req, out, 20)
      } catch (e) {
        r = null
      }
      await P.rm(out)
      if (!r || !r.code) {
        this.ckMsg = '验证失败：网络无响应'
        return
      }
      const t = String(r.text || '')
      const logged = /"logged_in"\s*:\s*1|退出登录|\/logout|我的书架|个人中心/i.test(t)
      const needLogin = /请先登录|未登录|请登录|login required|Just a moment|CF-RAY/i.test(t)
      if (r.code === 200 && logged) this.ckMsg = probe + ' 200 · 已登录'
      else if (needLogin) this.ckMsg = probe + ' ' + r.code + ' · 仍要求登录（Cookie 可能过期）'
      else this.ckMsg = probe + ' ' + r.code + ' · 无法确认登录态（' + t.length + 'B）'
    },

    async tapSrc(act) {
      await this.ensureStore()
      const s = String(act || '')
      const i = s.indexOf(':')
      const op = i > 0 ? s.slice(0, i) : s
      const id = i > 0 ? s.slice(i + 1) : ''
      const list = STORE.srcList
      let idx = -1
      for (let k = 0; k < list.length; k++) if (list[k] && list[k].id === id) { idx = k; break }
      if (idx < 0) return
      const r = list[idx]
      if (op === 'tog') {
        if (r.id === NATIVE_ID) { this.srcMsg = '书海阁是内置源，不能停用'; return }
        r.enabled = !r.enabled
        await this.saveSrcConf()
        this.renderSrc()
        this.renderNet()
        this.srcMsg = r.name + (r.enabled ? ' 已启用' : ' 已停用')
      } else if (op === 'up') {
        if (idx <= 0) { this.srcMsg = '已经是第一个了'; return }
        const prev = list[idx - 1]
        list[idx - 1] = r
        list[idx] = prev
        const pa = r.priority
        r.priority = prev.priority
        prev.priority = pa
        await this.saveSrcConf()
        this.renderSrc()
        this.renderNet()
        this.srcMsg = r.name + ' 上移到第 ' + idx + ' 位'
      } else if (op === 'del') {
        if (r.id === NATIVE_ID) { this.srcMsg = '内置源不能删除'; return }
        list.splice(idx, 1)
        await this.saveSrcConf()
        this.renderSrc()
        this.renderNet()
        this.srcMsg = '已删除 ' + r.name + '（不影响已下载的正文）'
      } else if (op === 'test') {
        await this.testOne(idx)
      } else if (op === 'ck') {
        await this.openCookie(r.id)
      }
    },

    // 单源完整测试：搜索 → 目录 → 正文，逐级报告卡在哪一步
    async testOne(idx) {
      const r = STORE.srcList[idx]
      if (!r) return
      this.srcMsg = '测试中：' + r.name
      this.renderSrc()
      const res = await this.probeSource(r, true)
      r.status = res.status
      r.lastTestAt = Date.now()
      r.lastMs = res.ms || 0
      r.lastError = res.error || ''
      await this.saveSrcConf()
      this.renderSrc()
      this.renderNet()
      this.srcMsg = r.name + '：' + statusText(r.status) + (res.note ? ' · ' + res.note : '') + (res.error ? ' · ' + res.error : '')
    },

    async grabEx(req, tag, timeout) {
      const out = P.scratchPath('p_' + tag + '.tmp')
      try {
        const r = await P.fetchReqEx(req, out, timeout || 12)
        return r || { code: 0, text: '', error: '无返回' }
      } catch (e) {
        return { code: 0, text: '', error: emsg(e) }
      } finally {
        await P.rm(out)
      }
    },

    // 取目录页文本。目录地址有两种：固定地址，或「从详情页提取链接」的规则
    // （text.点击阅读@href 这类）。后者必须先抓详情页解出 tocUrl 再抓目录页，
    // 否则规则文本会被当成 URL 请求 → 全部报「目录 HTTP -」。
    async grabTocText(ad, book, tag) {
      const plan = ad.tocPlan ? ad.tocPlan(book) : { req: ad.tocRequest(book) }
      const g1 = await this.grabEx(plan.req, (tag || 't') + 'a', 20)
      if (!g1.code || g1.code >= 400 || !g1.text) {
        return { text: '', code: g1.code || 0, error: '目录 HTTP ' + (g1.code || '-'), via: 'direct' }
      }
      if (!plan.detail) return { text: g1.text, code: g1.code, error: '', via: 'direct' }
      let turl = ''
      try {
        const d = ad.parseDetail(g1.text, book)
        turl = String((d && d.tocUrl) || '')
      } catch (e) {}
      if (!turl) return { text: g1.text, code: g1.code, error: '', via: 'detail-inline' }
      const g2 = await this.grabEx({ url: turl, method: 'GET', charset: 'utf-8' }, (tag || 't') + 'b', 20)
      if (!g2.code || g2.code >= 400 || !g2.text) {
        return {
          text: '',
          code: g2.code || 0,
          error: '目录页 HTTP ' + (g2.code || '-') + ' · ' + turl.slice(0, 60),
          via: 'detail'
        }
      }
      return { text: g2.text, code: g2.code, error: '', via: 'detail', url: turl }
    },

    // fetchText 注入给搜索引擎：返回正文文本，失败抛错（错误要能冒到界面）
    async grabText(req, tag) {
      const out = P.scratchPath('q_' + (tag || 'x') + '.tmp')
      try {
        const r = await P.fetchReqEx(req, out, 20)
        if (!r || !r.code) throw new Error((r && r.error) || '连接失败')
        if (r.code >= 400) throw new Error('HTTP ' + r.code)
        if (isChallenge(r.text)) throw new Error('需要人机验证')
        return r.text
      } finally {
        await P.rm(out)
      }
    },

    // deep=false 只测搜索（批量测试用，快）；deep=true 连目录和正文一起测
    async probeSource(r, deep) {
      const t0 = Date.now()
      const ad = adapterOf(r)
      if (!ad) return { status: 'bad', error: '无法构造适配器', ms: 0 }
      const tag = String(r.id || 'x').replace(/[^\w]/g, '').slice(-10)
      // 探测词要跟源的类型配：轻小说站搜「诡秘」永远 0 条，会被误判成
      // 「源失效」，实际换个轻小说书名一搜就有。0 条时才换下一个词，
      // 连不上/HTTP 错误不换（换词也一样）。
      const kws = r.kind === 'ln' ? ['败犬', '诡秘', '魔法'] : ['诡秘', '败犬']
      let list = []
      let ms1 = 0
      let kwUsed = kws[0]
      let zeroTried = ''
      for (let ki = 0; ki < kws.length; ki++) {
        const kw = kws[ki]
        let req = null
        try {
          req = ad.searchRequest(kw, 1)
        } catch (e) {
          return { status: 'bad', error: '规则异常：' + emsg(e), ms: 0 }
        }
        if (!req || !req.url) return { status: 'bad', error: '搜索地址为空', ms: 0 }
        // 12s 对国内慢站偏紧（轻之国度实测 17.5s 才回首页），会误判成「连不上」
        const g1 = await this.grabEx(req, tag + '_s' + ki, 15)
        ms1 = Date.now() - t0
        if (!g1.code) return { status: 'fail', error: '连不上：' + (g1.error || 'DNS/连接失败'), ms: ms1 }
        if (g1.code >= 400) return { status: 'fail', error: 'HTTP ' + g1.code, ms: ms1 }
        if (isChallenge(g1.text)) return { status: 'login', error: '返回人机验证页', ms: ms1 }
        if (isRedirectPage(g1.text)) return { status: 'fail', error: '站点返回跳转页（要 Cookie/JS）', ms: ms1 }
        try {
          list = ad.parseSearch(g1.text, { key: kw, page: 1 }) || []
        } catch (e) {
          return { status: 'bad', error: '搜索解析失败：' + emsg(e), ms: ms1 }
        }
        kwUsed = kw
        if (list.length) break
        zeroTried = zeroTried ? zeroTried + '/' + kw : kw
        list = []
      }
      if (!list.length) {
        return {
          status: 'fail',
          error: '页面能开但解析 0 条（试过「' + zeroTried + '」）',
          note: '搜索 0 条',
          ms: ms1
        }
      }
      if (!deep) return { status: 'ok', note: '搜索 ' + list.length + ' 条（' + kwUsed + '）', ms: ms1 }
      // 目录
      const b = {
        title: list[0].title,
        author: list[0].author || '',
        url: list[0].url,
        bid: list[0].bid,
        vars: list[0].vars || null
      }
      let toc = null
      if (ad.tocAll) {
        // 轻小说站的目录是「卷 → 章节」两层，详情页里没有章节列表，必须走它自己的接口
        try {
          const g = await ad.tocAll(b, async function (req) {
            const o = P.scratchPath('probe_toc.tmp')
            let rr = null
            try {
              rr = await P.fetchReqEx(req, o, 20)
            } catch (e) {
              rr = null
            }
            await P.rm(o)
            return rr && rr.code === 200 ? rr.text : null
          })
          toc = g && g.chapters && g.chapters.length ? g : null
          if (!toc) {
            return { status: 'partial', error: '目录 0 章（自己接口没拿到）', note: '搜索 ' + list.length + ' 条', ms: Date.now() - t0 }
          }
        } catch (e) {
          return { status: 'partial', error: '目录失败：' + emsg(e), note: '搜索 ' + list.length + ' 条', ms: Date.now() - t0 }
        }
      } else {
        const gt = await this.grabTocText(ad, b, tag)
        if (!gt.text) {
          return { status: 'partial', error: gt.error || '目录没抓到', note: '搜索 ' + list.length + ' 条', ms: Date.now() - t0 }
        }
        try {
          toc = ad.parseToc(gt.text, b)
        } catch (e) {
          return { status: 'partial', error: '目录解析失败：' + emsg(e), note: '搜索 ' + list.length + ' 条', ms: Date.now() - t0 }
        }
      }
      const chs = (toc && toc.chapters) || []
      if (!chs.length) return { status: 'partial', error: '目录 0 章', note: '搜索 ' + list.length + ' 条', ms: Date.now() - t0 }
      // 正文：第一章可能是「前言/公告」这类短章，一章不足就再试两章，
      // 否则好好的源会被判成「正文只有 15 字」
      let lastLen = -1
      let lastErr = ''
      const probeChs = chs.slice(0, 3)
      for (let ci = 0; ci < probeChs.length; ci++) {
        try {
          const g3 = await this.grabEx(ad.chapterRequest(b, probeChs[ci]), tag + '_c', 15)
          if (!g3.code || g3.code >= 400) {
            lastErr = '正文 HTTP ' + (g3.code || '-')
            continue
          }
          const txt = String(ad.parseChapter(g3.text, b) || '')
          if (txt.length >= 30) {
            return {
              status: 'ok',
              note: '搜索 ' + list.length + ' 条 · 目录 ' + chs.length + ' 章 · 正文 ' + txt.length + ' 字',
              ms: Date.now() - t0
            }
          }
          lastLen = txt.length
        } catch (e) {
          lastErr = '正文解析失败：' + emsg(e)
        }
      }
      return {
        status: 'partial',
        error: lastErr || '正文只有 ' + lastLen + ' 字（试了 ' + probeChs.length + ' 章）',
        note: '目录 ' + chs.length + ' 章',
        ms: Date.now() - t0
      }
    },

    // 批量测试：已启用的全部测一遍；一个都没启用就测当前页。
    // 再点一次 = 停下（源多时一轮要几分钟，必须能中断）。
    async testAllSources() {
      await this.ensureStore()
      if (this.srcTesting) { this.srcStop = true; this.srcMsg = '正在停下…'; return }
      const list = STORE.srcList
      const targets = []
      for (let i = 0; i < list.length; i++) if (list[i].enabled) targets.push(i)
      if (!targets.length) {
        const from = this.srcPage * SRC_ROWS
        for (let i = from; i < list.length && i < from + SRC_ROWS; i++) targets.push(i)
      }
      if (!targets.length) { this.srcMsg = '没有可测试的源'; return }
      this.srcTesting = true
      this.srcStop = false
      const st = { ok: 0, partial: 0, fail: 0, login: 0, bad: 0 }
      try {
        for (let k = 0; k < targets.length; k++) {
          if (this.srcStop) break
          const r = list[targets[k]]
          this.srcMsg = '测试 ' + (k + 1) + '/' + targets.length + ' · ' + r.name
          this.renderSrc()
          const res = await this.probeSource(r, false)
          r.status = res.status
          r.lastTestAt = Date.now()
          r.lastMs = res.ms || 0
          r.lastError = res.error || ''
          if (st[res.status] != null) st[res.status]++
          this.renderSrc()
          await P.sleep(120)
        }
        await this.saveSrcConf()
      } finally {
        this.srcTesting = false
        this.srcStop = false
      }
      this.renderSrc()
      this.renderNet()
      this.srcMsg =
        (this.srcStop ? '已停止 · ' : '') +
        '可用 ' + st.ok + ' · 部分 ' + st.partial + ' · 失效 ' + st.fail +
        ' · 需登录 ' + st.login + ' · 不兼容 ' + st.bad
    },

    // 内置包导入（离线可用）：pobing=破冰，guaner=关耳女频
    async importPack(which) {
      await this.ensureStore()
      const pkg = PACKS[which]
      if (!pkg) return
      const r = importLegadoJson(JSON.stringify(pkg.list), STORE.srcList)
      STORE.srcList = r.list
      await this.saveSrcConf()
      this.srcPage = 0
      this.renderSrc()
      this.renderNet()
      this.srcMsg =
        '导入「' + pkg.name + '」新增 ' + r.added + '，更新 ' + r.updated +
        '；可解析的已启用，不兼容的已停用'
    },

    // ---------- CDN 线路 ----------
    renderCdn() {
      const lines = STORE.cdnList
      this.cdnPages = Math.max(1, Math.ceil(lines.length / CDN_ROWS))
      if (this.cdnPage > this.cdnPages - 1) this.cdnPage = this.cdnPages - 1
      if (this.cdnPage < 0) this.cdnPage = 0
      const sorted = sortByPriority(lines)
      const pri = primaryLine(lines)
      const from = this.cdnPage * CDN_ROWS
      const rows = []
      for (let i = from; i < sorted.length && i < from + CDN_ROWS; i++) {
        const l = sorted[i]
        const tag = l.ok === true ? '可用' : l.ok === false ? '不可用' : '未测试'
        rows.push({
          id: l.id,
          name: ellipsis(l.name, 12) + (pri && pri.id === l.id ? ' 首选' : ''),
          meta: tag + (l.lastMs ? ' · ' + l.lastMs + 'ms' : '') + (l.enabled ? '' : ' · 停用'),
          color: l.ok === true ? '#4ec97a' : l.ok === false ? '#e0685f' : '#8a8a97',
          on: !!l.enabled
        })
      }
      this.cdnRows = rows
      const okN = lines.filter(function (l) { return l.ok === true }).length
      this.cdnPageText = this.cdnPage + 1 + '/' + this.cdnPages + ' · 可用 ' + okN + '/' + lines.length
    },

    async goCdn() {
      await this.ensureStore()
      this.view = 'cdn'
      this.cdnMsg = ''
      this.renderCdn()
      this.syncChrome()
    },

    cdnPageMove(d) {
      this.cdnPage = clamp(this.cdnPage + d, 0, this.cdnPages - 1)
      this.renderCdn()
    },

    async cdnAll(on) {
      await this.ensureStore()
      for (let i = 0; i < STORE.cdnList.length; i++) STORE.cdnList[i].enabled = !!on
      await this.saveCdnConf()
      this.renderCdn()
      this.cdnMsg = on ? '已启用全部线路（按优先级依次尝试）' : '已全部停用（更新书源会失败）'
    },

    async tapCdn(act) {
      await this.ensureStore()
      const s = String(act || '')
      const i = s.indexOf(':')
      const op = i > 0 ? s.slice(0, i) : s
      const id = i > 0 ? s.slice(i + 1) : ''
      const lines = STORE.cdnList
      let idx = -1
      for (let k = 0; k < lines.length; k++) if (lines[k].id === id) { idx = k; break }
      if (idx < 0) return
      const l = lines[idx]
      if (op === 'tog') {
        l.enabled = !l.enabled
        await this.saveCdnConf()
        this.renderCdn()
        this.cdnMsg = l.name + (l.enabled ? ' 已启用' : ' 已停用')
      } else if (op === 'up') {
        if (idx <= 0) { this.cdnMsg = '已经是优先级最高的了'; return }
        const prev = lines[idx - 1]
        lines[idx - 1] = l
        lines[idx] = prev
        const pa = l.priority
        l.priority = prev.priority
        prev.priority = pa
        await this.saveCdnConf()
        this.renderCdn()
        this.cdnMsg = l.name + ' 提到第 ' + idx + ' 位'
      } else if (op === 'test') {
        await this.testCdnOne(idx)
      }
    },

    async cdnFetch(url, timeout) {
      const out = P.scratchPath('cdn.tmp')
      const t = Math.max(6, Math.ceil((timeout || 12000) / 1000))
      try {
        const r = await P.fetchReqEx({ url: url, method: 'GET', charset: 'utf-8' }, out, t)
        if (!r || !r.code) return { ok: false, error: (r && r.error) || '连接失败', ms: (r && r.ms) || 0, code: 0 }
        if (r.code !== 200) return { ok: false, error: 'HTTP ' + r.code, ms: r.ms, code: r.code }
        return { ok: true, text: r.text, ms: r.ms, code: r.code }
      } catch (e) {
        return { ok: false, error: emsg(e), ms: 0, code: 0 }
      } finally {
        await P.rm(out)
      }
    },

    async testCdnOne(idx) {
      const l = STORE.cdnList[idx]
      if (!l) return
      this.cdnMsg = '测试 ' + l.name + '…'
      this.renderCdn()
      const self = this
      const r = await testLine(l, STORE.cdnTarget, function (u, t) { return self.cdnFetch(u, t) }, 15000)
      await this.saveCdnConf()
      this.renderCdn()
      this.cdnMsg = l.name + '：' + (r.ok ? '可用 · ' + r.ms + 'ms · ' + (r.count || 0) + ' 条' : '不可用 · ' + r.error)
    },

    async testAllCdn() {
      await this.ensureStore()
      if (this.cdnBusy) return
      this.cdnBusy = true
      try {
        for (let i = 0; i < STORE.cdnList.length; i++) {
          this.cdnMsg = '测试线路 ' + (i + 1) + '/' + STORE.cdnList.length
          this.renderCdn()
          await this.testCdnOne(i)
        }
        const okN = STORE.cdnList.filter(function (l) { return l.ok === true }).length
        this.cdnMsg = '测完：' + okN + '/' + STORE.cdnList.length + ' 条线路可用'
      } finally {
        this.cdnBusy = false
        this.renderCdn()
        await this.saveCdnConf()
      }
    },

    // 通过 CDN 拉远程书源：按优先级依次试，成功就停；内容必须过校验才算成功
    async updateSourcesFromCdn() {
      await this.ensureStore()
      if (this.cdnBusy) { this.cdnMsg = '正在更新，请稍候'; return }
      this.cdnBusy = true
      this.cdnMsg = '拉取书源…'
      this.renderCdn()
      try {
        const self = this
        const res = await fetchWithFailover(
          STORE.cdnList,
          STORE.cdnTarget,
          function (u, t) { return self.cdnFetch(u, t) },
          { timeout: 15 }
        )
        await this.saveCdnConf()
        this.renderCdn()
        if (!res.ok) {
          this.cdnMsg = '全部线路都失败：' + (res.errors || []).join('；')
          return
        }
        const v = validatePayload(res.text, STORE.cdnTarget.expect)
        if (!v.ok) {
          this.cdnMsg = res.lineName + ' 内容校验不通过：' + v.reason + '（已保留原书源配置）'
          return
        }
        const r = importLegadoJson(res.text, STORE.srcList)
        STORE.srcList = r.list
        await this.saveSrcConf()
        this.renderSrc()
        this.renderNet()
        this.cdnMsg =
          '成功（' + res.lineName + ' ' + res.ms + 'ms）：文件 ' + v.count + ' 条，新增 ' +
          r.added + '，更新 ' + r.updated + ' · 启用 ' +
          statsOf(STORE.srcList).enabled + '/' + STORE.srcList.length
      } catch (e) {
        this.cdnMsg = '更新失败：' + emsg(e)
      } finally {
        this.cdnBusy = false
        this.renderCdn()
      }
    },

    // ---------- 搜索范围 ----------
    renderNet() {
      const n = STORE.net || DEF_NET
      const st = statsOf(STORE.srcList)
      this.enabledCount = st.enabled
      const rows = []
      rows.push({
        k: '并发',
        btns: [1, 2, 3, 5].map(function (v) { return { t: v + ' 路', on: n.concurrency === v, act: 'conc:' + v } }),
        note: '同时搜 ' + n.concurrency + ' 个源，开太大容易被站点限流'
      })
      rows.push({
        k: '超时',
        btns: [6, 8, 12].map(function (v) { return { t: v + 's', on: n.timeout === v, act: 'to:' + v } }),
        note: '单源超过 ' + n.timeout + 's 就跳过，其它源照常出结果'
      })
      rows.push({
        k: '重试',
        btns: [0, 1, 2].map(function (v) { return { t: v + ' 次', on: n.retry === v, act: 'retry:' + v } }),
        note: n.retry ? '失败后再试 ' + n.retry + ' 次（遇 429 不重试）' : '失败不重试，出结果更快'
      })
      rows.push({
        k: '去重',
        btns: [{ t: n.dedupe ? '已开启' : '已关闭', on: n.dedupe, act: 'dedupe' }],
        note: n.dedupe ? '同一本书只留一条，详情页可切来源' : '每个来源各占一条'
      })
      rows.push({
        k: '排序',
        btns: [
          { t: '优先级', on: n.order === 'priority', act: 'order:priority' },
          { t: '匹配度', on: n.order === 'match', act: 'order:match' }
        ],
        note: n.order === 'priority' ? '按书源优先级排' : '按书名/作者匹配度排'
      })
      rows.push({
        k: '启用',
        btns: [{ t: '书源 ' + st.enabled + '/' + st.total, on: false, act: 'src' }],
        note: '点这里进书源管理勾选'
      })
      this.netRowsAll = rows
      const max = Math.max(0, rows.length - 4)
      if (this.netWin > max) this.netWin = max
      if (this.netWin < 0) this.netWin = 0
      this.netRows = rows.slice(this.netWin, this.netWin + 4)
    },

    async goNetset() {
      await this.ensureStore()
      this.view = 'netset'
      this.netWin = 0
      this.renderNet()
      this.syncChrome()
    },

    netPageMove(d) {
      const all = this.netRowsAll || []
      if (!all.length) return
      const max = Math.max(0, all.length - 4)
      this.netWin = clamp((this.netWin || 0) + d, 0, max)
      this.netRows = all.slice(this.netWin, this.netWin + 4)
    },

    async tapNet(act) {
      await this.ensureStore()
      const s = String(act || '')
      const i = s.indexOf(':')
      const op = i > 0 ? s.slice(0, i) : s
      const val = i > 0 ? s.slice(i + 1) : ''
      const n = STORE.net
      if (op === 'conc') n.concurrency = parseInt(val, 10) || 3
      else if (op === 'to') n.timeout = parseInt(val, 10) || 8
      else if (op === 'retry') n.retry = parseInt(val, 10) || 0
      else if (op === 'dedupe') n.dedupe = !n.dedupe
      else if (op === 'order') n.order = val === 'match' ? 'match' : 'priority'
      else if (op === 'src') { await this.goSources(); return }
      await this.saveNetConf()
      this.renderNet()
    },

    // ---------- 多来源选择 ----------
    openPick(group) {
      if (!group || !group.sources || !group.sources.length) return
      this.pickGroup = group
      this.pickTitle = ellipsis(group.title || '选择来源', 24)
      const auth = group.author ? ellipsis(group.author, 12) : '佚名'
      this.pickSub = auth + ' · ' + group.sources.length + ' 个来源'
      const rows = []
      for (let i = 0; i < group.sources.length; i++) {
        const s = group.sources[i]
        rows.push({
          name: ellipsis(s.sourceName || s.sourceId, 12),
          meta:
            statusText(s.status) +
            (s.lastChapter ? ' · 最新 ' + ellipsis(s.lastChapter, 10) : '') +
            (s.login ? ' · 需登录' : ''),
          color: s.status === 'ok' ? '#4ec97a' : s.status === 'login' ? '#d0a24a' : '#8a8a97'
        })
      }
      this.pickRows = rows
      this.view = 'pick'
      this.syncChrome()
    },

    async choosePick(i) {
      const g = this.pickGroup
      if (!g || !g.sources[i]) return
      const s = g.sources[i]
      if (this.book && this.book.bid === s.bid) {
        this.backFromPick()
        return
      }
      await this.openBook({
        bid: s.bid,
        title: s.title,
        author: s.author || '',
        intro: s.intro || '',
        sourceId: s.sourceId,
        url: s.url,
        vars: s.vars || null,
        group: g
      })
    },

    backFromPick() {
      // 从目录页进来的回目录，从结果页进来的回结果
      this.view = this.book ? 'toc' : 'results'
      this.syncChrome()
    },

    goSettings() {
      this.view = 'settings'
      this.updateSetScroll()
      this.syncChrome()
    },

    // 读写自检：逐项真写真读，把「哪一层落不了盘」直接摆给用户看。
    // 这台设备上缓存失败的排查全靠它——以前只能靠 adb 连进去翻日志。
    // 关键路径耗时实测（按需执行，结果是一次性 JSON，不是日志）
    async runBench() {
      const N = 5
      const b = { bootMs: this.bootMs || 0, dataDir: this.DIR }
      const p = this.DIR + '/.bench_a'
      let big = ''
      for (let i = 0; i < 200; i++) big += '[2026-11-07 12:00:00] init booksRoot=/userdisk/BookSea/8001792304816621 n=0 stable=1\n'
      big = big.slice(0, 20000)
      let t0 = Date.now()
      await P.writeFile(p, big)
      b.write20k = Date.now() - t0
      t0 = Date.now()
      for (let i = 0; i < N; i++) {
        const old = (await P.readFile(p)) || ''
        await P.writeFile(p, (old + 'x').slice(-20000))
      }
      b.loglineAvg = Math.round((Date.now() - t0) / N)
      t0 = Date.now()
      for (let i = 0; i < N; i++) await P.writeFile(this.DIR + '/.bench_b', '{"fontKey":"M","last":null,"pageMode":"tap","autoNext":true}')
      b.stateAvg = Math.round((Date.now() - t0) / N)
      t0 = Date.now()
      await P.cacheSummary(true)
      b.scanMs = Date.now() - t0
      t0 = Date.now()
      await P.cacheSummary()
      b.scanCachedMs = Date.now() - t0
      t0 = Date.now()
      await P.freeKB()
      b.dfMs = Date.now() - t0
      b.probeBook = await P.pathProbe(P.cacheRoot())
      b.probeData = await P.pathProbe(P.dataRoot())
      await P.rm(p)
      await P.rm(this.DIR + '/.bench_b')
      await P.writeFile(this.DIR + '/bench.json', JSON.stringify(b))
    },

    // 卡顿定位用：把「一次交互真正占住 JS 线程多久」逐项量出来。
    // 每项都带通道记账（fs 读/写/rm/shell 的次数与耗时），因为这台设备上
    // 阻塞就是卡顿本身，光有总时长分不清是重绘还是同步调用。
    async bench2() {
      const b = { bootMs: this.bootMs || 0, view: this.view, ch: (this.rawText || '').length, pages: this.pages.length }
      const stat = async (k, fn) => {
        P.statStart()
        const t0 = Date.now()
        try {
          await fn()
        } catch (e) {
          b[k + 'Err'] = String((e && e.message) || e)
        }
        b[k + 'Ms'] = Date.now() - t0
        b[k + 'Stat'] = P.statStop()
      }
      // 翻页：同步部分（data 赋值 + 页脚），10 次取均值
      if (this.pages.length) {
        const t0 = Date.now()
        for (let i = 0; i < 10; i++) {
          this.pageIndex = i % this.pages.length
          this.lines = this.pages[this.pageIndex].lines
          this.updateFoot()
        }
        b.turnMs = Math.round((Date.now() - t0) / 10)
        // 渲染延迟：改完数据到框架回调 nextTick，用户感知的就是这一段
        b.turnRender = await this.measureRender(5, () => {
          const i = (this.pageIndex + 1) % this.pages.length
          this.pageIndex = i
          this.lines = this.pages[i].lines
        })
      }
      // 滚动一帧：touchmove 每次都会走这条（改 translateY + 重算页脚）
      if (this.pageMode === 'scroll' && this.scrollMax > 0) {
        // 只看位移（2px，不跨行、不换窗口）
        b.scrollTiny = await this.measureRender(5, () => {
          this.setScrollY(Math.min(this.scrollMax, this.scrollY + 2))
        })
        // 跨行：会顺带换一次行窗口
        b.scrollLine = await this.measureRender(5, () => {
          this.setScrollY(Math.min(this.scrollMax, this.scrollY + 25))
        })
        b.scrollRender = b.scrollLine
      }
      // 打开一章（本地已缓存）：真正让用户等的那一段
      if (this.total && this.chapterIndex >= 0) {
        const idx2 = Math.min(this.total - 1, this.chapterIndex + 1)
        const t0 = Date.now()
        await this.openChapter(idx2)
        b.openChapterMs = Date.now() - t0
        await this.openChapter(this.chapterIndex - 1 >= 0 ? this.chapterIndex - 1 : 0)
      }
      // 排版：一章正文重新折行 + 分页
      if (this.rawText) {
        const t0 = Date.now()
        this.rebuildBlocks(this.rawText)
        b.layoutMs = Date.now() - t0
      }
      // 定时器一拍
      await stat('tick', () => this.tick())
      if (this.total) await stat('toc', () => this.renderToc())
      await stat('shelf', () => this.refreshCache())
      // 页面切换：点一下按钮到界面刷出来。--  每项都含一次 24ms 的固定等待，
      // 绝对值偏大，但同一台机器上不同版本之间可比。
      const vs = {}
      const seq = ['search', 'results', 'toc', 'settings', 'cache', 'home']
      for (let i = 0; i < seq.length; i++) {
        const v = seq[i]
        const t0 = Date.now()
        try {
          if (v === 'cache') {
            this.view = 'cache'
            this.renderShelf()
          } else if (v === 'results') {
            this.view = 'results'
            this.renderResults()
          } else if (v === 'toc') {
            this.view = 'toc'
            this.renderToc()
          } else this.view = v
          this.syncChrome()
        } catch (e) {
          vs[v + 'Err'] = String((e && e.message) || e)
        }
        await this.$nextTick()
        await P.sleep(24)
        vs[v] = Date.now() - t0
      }
      b.views = vs
      await stat('state', () => P.loadState())
      await P.writeFile(this.DIR + '/bench2.json', JSON.stringify(b))
      this.hMeta = '基准已存'
    },

    // 量「改完数据到框架下一次回调」的间隔：这才是用户感觉到的延迟，
    // 光量 JS 执行时间没用 —— 数据赋值本身是 0ms，慢的是原生侧重建节点。
    measureRender(n, act) {
      return new Promise((resolve) => {
        const once = (k, sum) => {
          if (k <= 0) {
            resolve(Math.round(sum / n))
            return
          }
          const t0 = Date.now()
          act()
          this.$nextTick(() => {
            setTimeout(() => once(k - 1, sum + (Date.now() - t0)), 0)
          })
        }
        once(n, 0)
      })
    },

    async runSelfCheck() {
      if (this.diagBusy) return
      this.diagBusy = true
      this.view = 'diag'
      this.diagRows = []
      this.diagSum = '检测中…'
      this.syncChrome()
      let r = null
      try {
        r = await P.selfCheck()
      } catch (e) {
        this.diagRows = [{ k: '自检', ok: false, v: '异常：' + ((e && e.message) || e) }]
        this.diagSum = '检测失败'
        this.diagBusy = false
        return
      }
      this.diagRows = r.rows || []
      this.diagSum = '通过 ' + r.pass + '/' + r.total
      this.diagBrief = r.pass === r.total ? '全部通过（' + r.total + ' 项）' : '异常 ' + (r.total - r.pass) + ' 项，点此查看'
      this.diagBusy = false
    },

    goCache() {
      this.view = 'cache'
      this.clearArmed = false
      this.clearLabel = '清空全部'
      this.syncChrome()
      // 统计要 fork 一个 du 扫目录（实测 130ms 起，书多更久），
      // 直接在点击里跑会把这一帧按住 —— 先让页面出来，再补数字。
      setTimeout(() => {
        this.refreshCache()
      }, 60)
    },

    async clearAll() {
      if (!this.clearArmed) {
        this.clearArmed = true
        this.clearLabel = '再点一次确认'
        return
      }
      // 停掉下载与预取
      this.clearing = true
      if (this.dl) this.dl.running = false
      this.dl = null
      this.pfQueue = []
      this.inflight = {}
      await P.clearCache()
      this.snapObj = { at: Date.now(), dir: this.DIR, books: 0, chapters: 0, by: 'user' }
      await P.saveShelfSnap(this.snapObj)
      this.cachedSet = {}
      this.clearArmed = false
      this.clearLabel = '清空全部'
      await this.refreshCache()
      this.cacheDetail = '已清空'
      this.clearing = false
    },

    // ---------- 状态存取 ----------
    // 阅读进度的落盘策略：攒批 + 内容去重 + 手指在屏幕上时不写。
    // 原来每翻一页都会在 450ms 内写一次 state.json；在只支持 shell 写盘的机型上
    // 一次写是几条同步 execShell（每条几十到几百毫秒），翻页就会一顿一顿的。
    // 现在最多 1.8s 落一次，且内容没变就完全不写。
    saveTick() {
      if (!this.booted || !this.saveDirty) return
      if (this.view === 'read') {
        if (this.touching) return
        if (Date.now() - this.stateAt < 1800) return
      }
      this.flushState()
    },

    stateObj() {
      return {
        fontKey: this.fontKey,
        last: this.last || null,
        pageMode: this.pageMode,
        autoNext: this.autoNext,
        dl: this.dlResume || null
      }
    },

    flushState() {
      if (!this.saveDirty) return
      const o = this.stateObj()
      let txt = ''
      try {
        txt = JSON.stringify(o)
      } catch (e) {
        return
      }
      this.saveDirty = false
      if (txt === this.stateStr) return
      this.stateStr = txt
      this.stateAt = Date.now()
      // 不 await：写盘期间界面照常响应，下一次 tick 不会被拖住
      P.saveState(o)
    },

    saveLast(now) {
      if (!this.book) return
      // chapterIndex 初始为 -1（未进入任何章节），落盘时收敛到 0，避免首页显示"第 0 章"
      const ci = Math.max(0, this.chapterIndex)
      const pct = this.total ? Math.round(((ci + this.pageIndex / Math.max(1, this.pages.length)) / this.total) * 100) : 0
      this.last = {
        bid: this.book.bid,
        title: this.book.title,
        author: this.book.author || '',
        chapterIndex: ci,
        pageIndex: this.pageIndex,
        pct: clamp(pct, 0, 100),
        // 章内字符偏移：滚动模式靠它精确回位
        charOff: this.curCharOff()
      }
      this.updateLastLine()
      this.saveDirty = true
      if (now) {
        this.stateAt = 0
        this.flushState()
      }
    },

    updateLastLine() {
      if (this.last) {
        this.lastLine = '第 ' + (this.last.chapterIndex + 1) + ' 章 · 已读 ' + (this.last.pct || 0) + '%'
      }
    },

    async resumeLast() {
      if (!this.last || !this.last.bid) {
        this.goSearch()
        return
      }
      this.book = {
        bid: this.last.bid,
        title: this.last.title,
        author: this.last.author || ''
      }
      this.chapMap = {}
      this.chunkLoaded = {}
      this.chunkLoading = {}
      this.total = 0
      this.cachedSet = {}
      this.inflight = {}
      this.dl = null
      this.dlFailed = []
      this.dlText = ''
      this.dlFillPx = 0
      this.offlineMode = false
      this.offlineCids = []
      this.view = 'toc'
      this.syncChrome()
      const cids = await P.cachedCids(this.book.bid)
      for (let i = 0; i < cids.length; i++) this.cachedSet[cids[i]] = 1
      // 同样不信任 meta.total：目录抓失败时它会是 0
      const tm2 = await P.tocMeta(this.book.bid)
      if (tm2.total) this.total = tm2.total
      await this.ensureChunk(1)
      if (!this.total) this.setupOfflineToc(cids)
      await this.saveMeta()
      const idx = this.last.chapterIndex || 0
      const keep = this.last.charOff || 0
      this.tocCursor = idx
      this.renderToc()
      await this.openChapter(idx)
      // 滚动模式下按字符偏移精确落回上次位置
      if (keep > 0 && this.view === 'read' && !this.loading) {
        this.restoreOff(keep)
        // openChapter 存的是章首位置，回位后要重存一次，否则下次打开又跳回章首
        this.saveLast(true)
      }
    },

    // ---------- 网络状态：单一真相 ----------
    // 只有这里能改 this.online。探测不了（null）时乐观放行，让真实请求自己去试，
    // 宁可失败一次也别把用户误判成离线——那正是"重连后仍提示断网"的根因。
    async ensureOnline(force) {
      let up = null
      try {
        up = await P.netUp(!!force)
      } catch (e) {
        up = null
      }
      if (up === false) {
        this.online = false
        this.syncChrome()
        this.updateFoot()
        return false
      }
      this.online = true
      this.syncChrome()
      this.updateFoot()
      return true
    },

    // 点顶栏的「离线」直接重探，比让用户干等好
    async probeNet() {
      if (this.netProbing) return
      this.netProbing = true
      this.flash('正在检查网络…', 2500)
      const ok = await this.ensureOnline(true)
      this.netProbing = false
      if (!ok) {
        this.flash('仍然离线，请检查 WiFi', 3000)
        return
      }
      this.flash('网络已恢复', 2200)
      await this.afterOnline()
    },

    // 离线期间挂起的动作，联网后自动续跑
    async afterOnline() {
      if (this.pendingDl) {
        this.pendingDl = false
        const f = this.pendingDlFrom
        this.pendingDlFrom = null
        await this.startDownload(typeof f === 'number' ? f : this.dlFromIdx())
      }
      // 断网时阅读页会停在「未下载 · 离线，联网后可读」，联网后这句文案不会自己消失，
      // 用户会以为还是断网。这里直接重取当前章，把状态刷新回来。
      if (this.view === 'read' && String(this.loading || '').indexOf('离线') >= 0) {
        await this.refreshReading()
      }
    },

    // ---------- 网络取数（后台优先，失败降级同步） ----------
    // out 只是 curl 落地用的临时文件，内容读完就删；早期版本留着当代价极高的「缓存」
    async fetchUrl(url, out, timeout) {
      const t = timeout || 25
      // 断网时后台要等 34s + 同步 30s 才报错，先探一次站点，探不通立刻放弃
      const up = await P.netUp(false)
      if (up === false) {
        this.online = false
        this.updateFoot()
        return null
      }
      if (up === true) this.online = true
      if (this.bgOK) {
        P.fetchBg(url, out, t)
        const ok = await P.waitFile(out + '.ok', t * 1000 + 4000)
        if (ok) {
          const s = await P.readFile(out)
          await P.rm(out + '.ok')
          await P.rm(out)
          return s
        }
        await P.rm(out + '.ok')
      }
      const s = await P.fetchSync(url, out, t)
      await P.rm(out)
      // 同步路径也会撞 429：内容是一小段 {"code":429,...}
      if (s && s.length < 200 && s.indexOf('429') >= 0) {
        this.hitRateLimit(null, null)
        return null
      }
      // 单个 URL 失败不等于整机离线：可能只是这一章 404 或站点抽风
      // （旧版这里 markNet(!!s)，一次解析空就把整机判成离线，必须拿掉）
      return s
    },

    // ---------- 调试指令通道 ----------
    async pollCmd() {
      // booted 之前不消费指令：否则指令刚切的视图会被 bootInner 末尾的 goHome 覆盖
      if (!this.DIR || this.cmdBusy || !this.booted) return
      this.cmdBusy = true
      try {
        const p = this.DIR + '/cmd.txt'
        if (await P.exists(p)) {
          const s = await P.readFile(p)
          const cmd = String(s || '').trim()
          // 执行后写 <done> 而非清空：内容变化天然去重，同一指令可重复下发
          if (cmd && cmd !== '<done>') {
            await P.writeFile(p, '<done>')
            await this.runCmd(cmd)
          }
        }
      } finally {
        this.cmdBusy = false
      }
    },

    async runCmd(cmd) {
      try {
        await this.runCmdInner(cmd)
      } catch (e) {
        this.hMeta = '指令失败：' + ((e && e.message) || e)
      }
    },

    async runCmdInner(cmd) {
      const sp = cmd.indexOf(' ')
      const op = sp < 0 ? cmd : cmd.slice(0, sp)
      const arg = sp < 0 ? '' : cmd.slice(sp + 1).trim()
      if (op === 'search') {
        this.kw = arg
        await this.doSearch()
      } else if (op === 'shelf') {
        this.goCache()
      } else if (op === 'readbid') {
        // 离线验证用：不经过搜索，直接按 bid 从书架打开
        const s = await P.cacheSummary()
        let hit = null
        for (let i = 0; i < s.items.length; i++) {
          if (s.items[i].bid === arg || !arg) hit = s.items[i]
        }
        if (hit) await this.openShelfBook(hit)
        else this.hMeta = '书架里没有 ' + arg
      } else if (op === 'clean') {
        const n = await P.cleanScratch()
        await this.compactLegacyToc()
        await this.refreshCache()
        this.hMeta = '已清理残留 ' + n + ' 个文件'
      } else if (op === 'jump' && !this.book) {
        this.flash('先打开一本书再跳转', 2500)
      } else if (op === 'open') {
        await this.openBook({ bid: arg, title: '调试书目 ' + arg, author: '' })
      } else if (op === 'jump') {
        this.jumpText = String(arg)
        await this.confirmJump()
      } else if (op === 'next') {
        this.nextPage()
      } else if (op === 'prev') {
        this.prevPage()
      } else if (op === 'nchap') {
        this.nextChapter()
      } else if (op === 'pchap') {
        this.prevChapter()
      } else if (op === 'font') {
        this.setFont(arg || 'M')
      } else if (op === 'mode') {
        this.setPageMode(arg)
      } else if (op === 'ck') {
        // 打开某源的 Cookie 页（绕过书源列表点击）
        await this.openCookie(arg || 'lk')
      } else if (op === 'cksave') {
        // 调试：直接落盘 Cookie，绕开系统输入法（键盘弹了就收不回，无人值守测不了）
        // 用法：cksave www.lightnovel.fun lk_security_key=xxx
        const sp0 = arg.indexOf(' ')
        const h = sp0 < 0 ? arg : arg.slice(0, sp0)
        const v = sp0 < 0 ? '' : arg.slice(sp0 + 1)
        const ok = await P.saveCookie(h, v, 'debug')
        await P.writeFile(this.DIR + '/cksave.txt', (ok ? 'OK ' : 'FAIL ') + h + ' len=' + v.length)
      } else if (op === 'ckget') {
        // 调试：读回 Cookie（证明重启后能从盘上读到）并落盘给外部断言
        const v = await P.cookieOf(arg)
        const all = await P.cookieList()
        await P.writeFile(
          this.DIR + '/ckget.txt',
          'host=' + arg + '\nlen=' + (v ? v.length : 0) + '\nvalue=' + (v || '(empty)') +
          '\nhosts=' + (all || []).map(function (x) { return x.host + ':' + x.len }).join(',')
        )
      } else if (op === 'fetch') {
        // 诊断：用应用内同一套 fetchReqEx 抓一次 URL，把状态码/耗时/字节数落盘。
        // 用来区分「站点不通」和「我的抓取通道坏了」——shell 里手写 curl 通不代表这条通。
        const out = P.scratchPath('dbg.tmp')
        let r = null
        try {
          r = await P.fetchReqEx({ url: arg, method: 'GET', headers: { Accept: 'application/json' } }, out, 20)
        } catch (e) {
          r = null
        }
        const tx = r && r.text ? r.text : ''
        await P.writeFile(
          this.DIR + '/fetchdbg.txt',
          'url=' + arg + '\ncode=' + (r ? r.code : 'null') + '\nms=' + (r ? r.ms : -1) +
          '\nsize=' + (r ? r.size : -1) + '\nerr=' + (r ? r.error : 'exception') +
          '\ntextlen=' + tx.length + '\nhead=' + tx.slice(0, 160) + '\ntail=' + tx.slice(-80)
        )
        await P.rm(out)
      } else if (op === 'tocdbg') {
        // 诊断：当前书的源信息 + tocAll 是否可用 + 实跑结果
        const ad = this.bookAdapter()
        const rec = this.book ? this.srcRecord(this.book.srcId) : null
        const info = {
          book: this.book
            ? { bid: this.book.bid, url: this.book.url, srcId: this.book.srcId, srcKind: this.book.srcKind, srcName: this.book.srcName }
            : null,
          rec: rec ? { id: rec.id, kind: rec.kind, lnId: rec.lnId, baseUrl: rec.baseUrl, site: rec.site } : null,
          hasAd: !!ad,
          hasTocAll: !!(ad && ad.tocAll)
        }
        if (ad && ad.tocAll && this.book) {
          const log = []
          try {
            const g = await ad.tocAll(this.book, async function (req) {
              const o = P.scratchPath('tdbg.tmp')
              let rr = null
              try { rr = await P.fetchReqEx(req, o, 20) } catch (e) { rr = null }
              log.push({
                url: String(req && req.url).slice(0, 120),
                code: rr ? rr.code : -1,
                ms: rr ? rr.ms : -1,
                size: rr ? rr.size : -1,
                textlen: rr && rr.text ? rr.text.length : -1
              })
              await P.rm(o)
              return rr && rr.code === 200 ? rr.text : null
            })
            info.got = g && g.chapters ? g.chapters.length : -1
            info.first = g && g.chapters && g.chapters[0] ? g.chapters[0] : null
          } catch (e) {
            info.err = String((e && e.message) || e)
          }
          info.log = log
        }
        await P.writeFile(this.DIR + '/tocdbg.txt', JSON.stringify(info))
      } else if (op === 'refresh') {
        await this.refreshReading()
      } else if (op === 'tdbg') {
        await P.writeFile(
          this.DIR + '/touch.json',
          JSON.stringify({
            mode: this.pageMode,
            diag: this.touchDiag,
            raw: this.touchRaw,
            page: this.pageIndex + 1,
            pages: this.pages.length,
            scrollY: Math.round(this.scrollY),
            scrollMax: Math.round(this.scrollMax),
            lines: this.allLines.length,
            pct: this.scrollPct
          })
        )
      } else if (op === 'keypad') {
        this.openJump()
      } else if (op === 'key') {
        this.tapKey(arg)
      } else if (op === 'ok') {
        await this.confirmJump()
      } else if (op === 'resume') {
        await this.resumeLast()
      } else if (op === 'view') {
        this.view = arg || 'home'
        if (this.view === 'cache') await this.refreshCache()
        // 直接切到列表页时也要填一次列表：原来只有 goXxx() 会 render，
        // 从调试指令进来会看到「首选 jsDelivr」但一行线路都没有
        await this.ensureStore()
        if (this.view === 'cdn') this.renderCdn()
        else if (this.view === 'sources') this.renderSrc()
        else if (this.view === 'netset') this.renderNet()
        this.syncChrome()
      } else if (op === 'srcall') {
        // 调试：对全部源（含停用、含不兼容）跑完整链路，边跑边落盘
        await this.ensureStore()
        const deep = String(arg || '').trim() !== 'quick'
        const list = STORE.srcList
        const rows = []
        for (let i = 0; i < list.length; i++) {
          const r = list[i]
          let res = null
          try {
            res = await this.probeSource(r, deep)
          } catch (e) {
            res = { status: 'bad', error: '异常：' + emsg(e), ms: 0 }
          }
          r.status = res.status
          r.lastTestAt = Date.now()
          r.lastMs = res.ms || 0
          r.lastError = res.error || ''
          rows.push({
            i: i,
            name: r.name,
            kind: r.kind,
            enabled: !!r.enabled,
            status: res.status,
            note: res.note || '',
            error: res.error || '',
            ms: res.ms || 0,
            site: r.site || ''
          })
          await P.writeFile(
            this.DIR + '/srcall.json',
            JSON.stringify({ done: i + 1, total: list.length, rows: rows })
          )
          await P.sleep(120)
        }
        await this.saveSrcConf()
        this.renderSrc()
        this.renderNet()
      } else if (op === 'dl') {
        await this.toggleDownload()
      } else if (op === 'dlpause') {
        if (this.dl && this.dl.running) await this.toggleDownload()
      } else if (op === 'dlfrom') {
        this.openDlFrom()
      } else if (op === 'dlstart') {
        // 直接指定起始章（1 基）开始缓存，验证"从第 N 章开始"用
        const n = parseInt(arg || '1', 10) || 1
        await this.startDownload(Math.max(0, n - 1))
      } else if (op === 'dlsync') {
        // 模拟后台能力不可用，验证同步降级下载真能下下来
        this.bgOK = false
        await this.startDownload(0)
      } else if (op === 'net') {
        await this.probeNet()
        this.hMeta = (this.online ? '在线' : '离线') + ' · probe done'
      } else if (op === 'scrollby') {
        // 触摸注入不稳时用它验证滚动：scrollby 300 / scrollby -300 / scrollby 99999
        const d = parseInt(arg || '0', 10) || 0
        this.setScrollY(this.scrollY + d)
      } else if (op === 'setpos') {
        // 设置页跳到第 N 个窗口（验证新增行有没有被画出来）：setpos 999 = 最后一个窗口
        this.setSetScroll(parseInt(arg || '0', 10) || 0)
      } else if (op === 'scend') {
        // 模拟「滑到边界后松手」：scend bottom 走到章末分支，scend top 走上翻章分支
        const k = (arg || 'bottom').trim()
        this.scOverTop = k === 'top' ? 100 : 0
        this.scOverBottom = k === 'bottom' ? 100 : 0
        this.touchDiag = 'scend ' + k + ' y=' + Math.round(this.scrollY) + '/' + Math.round(this.scrollMax) +
          ' autoNext=' + (this.autoNext ? 1 : 0)
        this.finishScrollDrag()
      } else if (op === 'dlstat') {
        const dl = this.dl
        await P.writeFile(
          this.DIR + '/snapshot.json',
          JSON.stringify({
            online: this.online,
            bgOK: this.bgOK,
            pendingDl: this.pendingDl,
            cooldown: Math.max(0, Math.round(((this.netCooldown || 0) - Date.now()) / 1000)),
            total: this.total,
            chapterIndex: this.chapterIndex,
            dl: dl
              ? {
                  running: dl.running,
                  from: dl.from,
                  done: dl.done,
                  total: dl.total,
                  fail: dl.fail,
                  failed: (dl.failed || []).length,
                  queue: (dl.queue || []).length
                }
              : null,
            dlText: this.dlText,
            dlFillPx: this.dlFillPx,
            storageFail: this.storageFail || 0,
            bootMs: this.bootMs || 0,
            pageMode: this.pageMode,
            autoNext: this.autoNext,
            pageIndex: this.pageIndex + 1,
            pages: this.pages.length,
            tocCursor: this.tocCursor,
            tocRange: this.tocRange,
            tocLoading: this.tocLoading,
            jumpScope: this.jumpScope,
            diag: this.diagSum,
            cacheBooks: this.cacheBooks,
            cacheChapters: this.cacheChapters,
            shelfAll: this.shelfAll.length,
            shelfRange: this.shelfRange,
            shelfRows: this.cacheItems.length,
            freeKB: this.freeKB,
            // 布局对拍用：当前模式 + env 算出的屏高/主体高
            layout: this.layoutFlex ? 'flex' : 'abs',
            screen: this.geo ? this.geo.w + 'x' + this.geo.h : '',
            bodyH: this.bodyH,
            meta: this.cacheDetail
          })
        )
      } else if (op === 'geoforce') {
        // 模拟其它机型的屏幕尺寸：只改 env 读数，不动 vh —— 正好模拟「env 报错值」
        //   geoforce 960x266 / geoforce 0x0（复位）
        const m = String(arg || '').trim().match(/^(\d+)\s*[xX*,]\s*(\d+)$/)
        if (m) {
          this.geoForceW = parseInt(m[1], 10)
          this.geoForceH = parseInt(m[2], 10)
        } else {
          this.geoForceW = 0
          this.geoForceH = 0
        }
        this.applyGeo()
        this.hMeta = this.geoForceW ? '强制 ' + this.geoForceW + 'x' + this.geoForceH : '布局 ' + (this.layoutFlex ? 'flex' : 'abs')
      } else if (op === 'layout') {
        // layout flex / layout abs：切换主容器布局，用来在两台不同分辨率的机器上对拍
        const m = String(arg || '').trim().toLowerCase()
        if (m === 'flex') this.layoutFlex = true
        else if (m === 'abs') this.layoutFlex = false
        this.applyGeo()
        this.hMeta = '布局 ' + (this.layoutFlex ? 'flex' : 'abs')
      } else if (op === 'staton') {
        P.statStart()
        this.hMeta = '采样中'
      } else if (op === 'statend') {
        const s = P.statStop()
        await P.writeFile(this.DIR + '/stat.json', JSON.stringify(s))
        this.hMeta = '采样已存'
      } else if (op === 'envd') {
        await P.writeFile(this.DIR + '/env.json', JSON.stringify(P.envDump(), null, 1))
        this.hMeta = '环境已存'
      } else if (op === 'bench2') {
        await this.bench2()
      } else if (op === 'clear') {
        // 与界面一致的两段式：第一次仅进入待确认，第二次才真正清空
        await this.clearAll()
      } else if (op === 'cache') {
        await this.refreshCache()
      } else if (op === 'kb') {
        // 唤起系统键盘（真机验证入口）
        this.openSystemKeyboard()
      } else if (op === 'kbclose') {
        this.kbOpen = false
        P.closeTextEdit()
      } else if (op === 'bench') {
        await this.runBench()
      } else if (op === 'selftest') {
        // 读写自检（无人值守版）：结果落盘给脚本读
        await this.runSelfCheck()
        await P.writeFile(this.DIR + '/selfcheck.json', JSON.stringify({
          pass: this.diagSum,
          rows: this.diagRows
        }))
      } else if (op === 'tocpage') {
        // 跳到目录第 N 屏（不进章节），验证「按目录页跳转」
        const n = parseInt(arg || '1', 10) || 1
        this.jumpMode = 'jump'
        this.jumpScope = 'page'
        this.jumpTitle = '跳到目录第几屏'
        this.jumpText = String(n)
        this.view = 'toc'
        await this.confirmJump()
      } else if (op === 'autonext') {
        this.autoNext = arg !== '0'
        this.stateAt = 0
      this.saveDirty = true
      this.flushState()
      } else if (op === 'tapzone') {
        // 模拟点半屏（L=上一页 R=下一页），验证点按翻页的分区逻辑
        if (arg === 'L') this.prevPage()
        else this.nextPage()
      }
    }
  }
}
</script>

<style>
/* ===== 基础 ===== */
.app {
  /* 宽高交给设备：上架全设备后逻辑分辨率有 936×280 / 960×266 等多档，
     写死任何一档都会在别的机型上裁切。各容器高度由 applyGeo() 内联注入。 */
  width: 100vw;
  height: 100vh;
  background-color: #0b0b0e;
  flex-direction: column;
}

.hdr {
  height: 32px;
  flex-direction: row;
  align-items: flex-end;
  padding-left: 16px;
  padding-right: 16px;
  padding-bottom: 5px;
}
.ht {
  font-size: 17px;
  color: #f2f2f5;
  font-weight: bold;
  flex: 1;
}
.hm {
  font-size: 12px;
  color: #7d7d88;
}
.hair {
  height: 1px;
  background-color: #1e1e26;
}

.bd {
  /* height 由 bdStyle 内联注入（= 屏高 - 顶栏 33 - 底栏 30） */
  padding-left: 14px;
  padding-right: 14px;
  padding-top: 8px;
  padding-bottom: 8px;
  flex-direction: column;
}

/* ===== 通用按钮 ===== */
.btn {
  height: 26px;
  padding-left: 12px;
  padding-right: 12px;
  margin-right: 8px;
  border-radius: 6px;
  background-color: #1c1c24;
  justify-content: center;
  align-items: center;
}
.bt {
  font-size: 13px;
  color: #e6e6ea;
  line-height: 26px;
}
/* 缓存按钮：主文案 + 进度小字，两行挤在 26px 的按钮里 */
.dlbtn2 {
  flex-direction: column;
}
.bt3 {
  line-height: 14px;
  font-size: 12px;
}
.bt2 {
  font-size: 9px;
  color: #cfd6e6;
  line-height: 11px;
}
/* 底部等分按钮：这个框架里行内第一个 flex 子项会被撑开，显式 flex:1 让所有按钮等分 */
.pbtn {
  flex: 1;
  height: 26px;
  margin-right: 8px;
  border-radius: 6px;
  background-color: #1c1c24;
  justify-content: center;
  align-items: center;
}

/* ===== 首页 ===== */
.home {
  justify-content: center;
}
.hrow {
  flex-direction: row;
}
.card {
  background-color: #15151b;
  border-radius: 10px;
  padding: 12px 14px;
  justify-content: center;
}
.cardMain {
  flex: 1;
  margin-right: 10px;
}
.hcol {
  width: 196px;
  margin-right: 10px;
  flex-direction: column;
}
.cardSm {
  margin-bottom: 10px;
}
.k {
  font-size: 13px;
  color: #6f6f7c;
  margin-bottom: 6px;
}
.t {
  font-size: 22px;
  color: #f4f4f8;
  font-weight: bold;
  margin-bottom: 8px;
}
.s {
  font-size: 13px;
  color: #8b8b98;
}

/* ===== 搜索 ===== */
.srow {
  flex-direction: row;
  align-items: center;
  height: 44px;
}
.inp {
  flex: 1;
  height: 32px;
  background-color: #17171e;
  border-radius: 6px;
  color: #f0f0f4;
  font-size: 15px;
  padding-left: 10px;
  padding-right: 10px;
  margin-right: 10px;
}
/* 伪输入框：点击唤起系统输入法（自定义输入法不能继承 .inp 的 color/font-size） */
.fakeinp {
  flex: 1;
  height: 32px;
  flex-direction: row;
  align-items: center;
  background-color: #17171e;
  border-radius: 6px;
  padding-left: 10px;
  padding-right: 10px;
  margin-right: 10px;
}
.fakeText {
  flex: 1;
  font-size: 15px;
  color: #f0f0f4;
}
.fakeHint {
  font-size: 11px;
  color: #6f6f7c;
  margin-left: 8px;
}
.hotrow {
  flex-direction: row;
  align-items: center;
  height: 40px;
}
.histrow {
  flex-direction: row;
  align-items: center;
  height: 36px;
}
/* 标签固定宽度：触摸注入在逻辑 x<65 时会被设备静默丢弃，
   标签若只有文字宽，第一个 chip 会落在死区里点不动（热词之前就是这个毛病）。 */
.hotlab {
  width: 50px;
  font-size: 12px;
  color: #666673;
  margin-right: 8px;
}
.clrchip {
  background-color: #2a1c1c;
}
.clrt {
  color: #d98a8a;
}
.chip {
  height: 24px;
  padding-left: 10px;
  padding-right: 10px;
  background-color: #1b1b23;
  border-radius: 12px;
  margin-right: 8px;
  justify-content: center;
  align-items: center;
}
.chipt {
  font-size: 12px;
  color: #b9b9c6;
  line-height: 24px;
}
.tiprow {
  padding-top: 10px;
}
.tipt {
  font-size: 13px;
  color: #6f6f7c;
}

/* ===== 结果 ===== */
.res {
  height: 52px;
  flex-direction: row;
  align-items: center;
  background-color: #14141a;
  border-radius: 8px;
  padding-left: 12px;
  padding-right: 12px;
  margin-bottom: 3px;
}
.resmain {
  flex: 1;
  flex-direction: column;
}
.rest {
  font-size: 16px;
  color: #f2f2f6;
  font-weight: bold;
  margin-bottom: 1px;
}
.ress {
  font-size: 11px;
  color: #7b7b88;
  margin-bottom: 1px;
}
.resd {
  font-size: 11px;
  color: #5e5e6b;
}
.resgo {
  font-size: 13px;
  color: #4f8fe0;
  margin-left: 10px;
}
/* 空结果提示：占住列表区，避免只剩一条分页条 */
.emptybox {
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.emptyt {
  font-size: 15px;
  color: #c9c9d4;
  margin-bottom: 8px;
}
.emptys {
  font-size: 12px;
  color: #6f6f7c;
}

/* ===== 翻页条 ===== */
.pager {
  flex-direction: row;
  align-items: center;
  height: 30px;
  padding-right: 18px;
}
.pg {
  font-size: 12px;
  color: #8a8a97;
  margin-right: 10px;
}
.pgrow {
  font-size: 12px;
  color: #66667a;
  flex: 1;
  margin-left: 4px;
}

/* ===== 目录 ===== */
.toc {
  flex-direction: column;
}
.tocrow {
  height: 22px;
  flex-direction: row;
  align-items: center;
}
.tocidx {
  width: 52px;
  font-size: 11px;
  color: #55556a;
}
.toct {
  flex: 1;
  font-size: 15px;
  color: #dcdce4;
}
.tocd {
  font-size: 10px;
  color: #3f7a4a;
  margin-left: 6px;
}

/* ===== 跳转键盘 ===== */
.jump {
  flex-direction: row;
  padding-top: 10px;
}
.jleft {
  width: 300px;
  flex-direction: column;
  margin-right: 16px;
}
.jlab {
  font-size: 13px;
  color: #7d7d8a;
  margin-bottom: 8px;
}
.jbox {
  height: 58px;
  background-color: #15151c;
  border-radius: 8px;
  justify-content: center;
  align-items: center;
  margin-bottom: 8px;
}
.jnum {
  font-size: 34px;
  color: #f5f5f8;
  font-weight: bold;
}
.jhint {
  font-size: 12px;
  color: #6d6d7a;
  margin-bottom: 10px;
}
.jrow {
  flex-direction: row;
}
.jright {
  /* 原来是 592px（凑满 936），换宽屏就留一条黑边，用 flex 吃掉剩余 */
  flex: 1;
  flex-direction: column;
}
.krow {
  flex-direction: row;
  height: 44px;
  margin-bottom: 5px;
}
.key {
  flex: 1;
  height: 44px;
  margin-right: 8px;
  background-color: #1a1a22;
  border-radius: 8px;
  justify-content: center;
  align-items: center;
}
.keyt {
  font-size: 18px;
  color: #ececf2;
  line-height: 44px;
}

/* ===== 阅读 ===== */
.read {
  padding-left: 16px;
  padding-right: 16px;
  padding-top: 4px;
  padding-bottom: 2px;
}
.rbody {
  flex-direction: column;
}
.rtap {
  flex-direction: column;
}
/* 滚动模式的裁切窗口：高度由 readCutStyle 注入（框架里 flex:1 不会撑满） */
.rcut {
  overflow: hidden;
}
.rsc {
  flex-direction: column;
}
.ln {
  color: #d8d8de;
}
.loading {
  flex: 1;
  justify-content: center;
  align-items: center;
}
.lt {
  font-size: 15px;
  color: #8a8a98;
}
.ftr {
  height: 30px;
  flex-direction: row;
  align-items: center;
  padding-left: 14px;
  padding-right: 14px;
  padding-bottom: 4px;
}
.fstat {
  width: 104px;
  font-size: 11px;
  color: #5d5d6a;
  text-align: right;
}
/* 划动模式下顶替「上一页/下一页」的提示位 */
.fswipe {
  flex: 2;
  height: 26px;
  font-size: 11px;
  color: #55556a;
  line-height: 26px;
  text-align: center;
  margin-right: 8px;
}

/* ===== 设置 ===== */
.setrow {
  flex-direction: row;
  align-items: center;
  height: 38px;
  margin-bottom: 3px;
}
.setk {
  width: 64px;
  font-size: 13px;
  color: #7b7b88;
}
.setd {
  font-size: 12px;
  color: #5f5f6c;
  margin-left: 6px;
}
/* 日志绝对路径：一行装得下，字号更小、可读但弱化 */
.setpath {
  font-size: 10px;
  color: #8b8b99;
  margin-left: 6px;
}
/* 设置页滚动区：视口 = body - 上下 padding 16 - pager 30，由 setViewStyle 注入 */
.setview {
  overflow: hidden;
}
.setinner {
  flex-direction: column;
}
.setpull {
  font-size: 11px;
  color: #45454f;
}
.jscope {
  flex-direction: row;
  margin-bottom: 8px;
}

/* ===== 书源 / CDN 列表 ===== */
/* 26(lbar) + 3 + lst(139，随屏高伸缩) + 30(pager) 落在可用高度内 */
.lbar {
  flex-direction: row;
  align-items: center;
  height: 26px;
  margin-bottom: 3px;
}
.lbtn {
  width: 50px;
  /* 有消息文字时原来会被撑宽/挤压，导致按钮位置漂移（点「更新书源」点到「全选」） */
  flex-shrink: 0;
  height: 22px;
  margin-right: 5px;
  border-radius: 5px;
  background-color: #1c1c24;
  justify-content: center;
  align-items: center;
}
.lbt {
  font-size: 11px;
  color: #d8d8e0;
  line-height: 22px;
}
.lmsg {
  /* 固定宽度而不是 flex:1：长消息参与 flex 增长会把前面的按钮挤变形 */
  width: 545px;
  font-size: 11px;
  color: #6f6f7c;
  margin-left: 2px;
}

/* ===== 登录 Cookie ===== */
.lmsgrow {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 34px;
  padding-left: 6px;
  padding-right: 6px;
}
.ckh {
  font-size: 15px;
  color: #f0f0f4;
  font-weight: bold;
}
.ckm {
  flex: 1;
  font-size: 11px;
  color: #9a9aa8;
  margin-left: 10px;
}
.ckbox {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 38px;
  margin-left: 6px;
  margin-right: 6px;
  margin-bottom: 6px;
  padding-left: 10px;
  padding-right: 10px;
  background-color: #16161c;
  border-radius: 8px;
}
.cklab {
  font-size: 12px;
  color: #7f7f8c;
  width: 60px;
}
.ckval {
  flex: 1;
  font-size: 12px;
  color: #d8d8e0;
}
.cknote {
  margin: 4px 6px;
  padding: 8px 10px;
  background-color: #131318;
  border-radius: 8px;
}
.ckt {
  font-size: 11px;
  color: #77778a;
  line-height: 17px;
}
.lst {
  overflow: hidden;
}
.lstinner {
  flex-direction: column;
}
.lrow {
  height: 34px;
  flex-direction: row;
  align-items: center;
  background-color: #14141a;
  border-radius: 6px;
  padding-left: 8px;
  padding-right: 6px;
  margin-bottom: 1px;
}
.lname {
  flex: 1;
  font-size: 13px;
  color: #cfcfd8;
}
.lmeta {
  width: 200px;
  font-size: 11px;
  color: #8a8a97;
}
/* 来源选择页：整行可点，右侧一个「读」 */
.lgo {
  width: 22px;
  font-size: 12px;
  color: #4ec97a;
}
.pickh {
  height: 26px;
  flex-direction: row;
  align-items: center;
  margin-bottom: 3px;
}
.pickt {
  font-size: 14px;
  color: #e6e6ea;
  margin-right: 8px;
}
.picks {
  flex: 1;
  font-size: 11px;
  color: #6f6f7c;
}

/* ===== 读写自检 ===== */
.drow {
  flex-direction: row;
  align-items: center;
  height: 22px;
}
.dnote {
  font-size: 10px;
  color: #7d7d8c;
  margin-top: 4px;
}
.dflag {
  width: 34px;
  font-size: 12px;
}
.dk {
  width: 88px;
  font-size: 12px;
  color: #9b9baa;
}
.dv {
  font-size: 12px;
  color: #d8d8e2;
  flex: 1;
}
.distat {
  height: 20px;
  justify-content: center;
}
.ditext {
  font-size: 12px;
  color: #7b7b88;
}

/* ===== 下载进度条（常驻顶栏下方） ===== */
.dlbar {
  height: 18px;
  flex-direction: row;
  align-items: center;
  padding-left: 14px;
  padding-right: 14px;
  background-color: #101016;
}
.dltrack {
  flex: 1;
  height: 8px;
  background-color: #1e1e28;
  border-radius: 4px;
  margin-right: 10px;
}
.dlfill {
  height: 8px;
  background-color: #2f6fd0;
  border-radius: 4px;
}
.dlt {
  width: 210px;
  font-size: 11px;
  color: #8fa3bd;
}
/* 暂停按钮要显眼：宽 92px、有底色，比原来 64px 的灰块明显得多 */
.dlbtn {
  width: 92px;
  height: 18px;
  border-radius: 5px;
  background-color: #8a5b1c;
  justify-content: center;
  align-items: center;
}
.dlbt {
  font-size: 12px;
  color: #ffffff;
  line-height: 18px;
  font-weight: bold;
}

/* ===== 缓存 ===== */
/* 单行：两行摘要 + 4 行列表 + pager 会把底部按钮顶出可视区 */
.csum {
  flex-direction: row;
  align-items: center;
  height: 26px;
  margin-bottom: 3px;
}
.cbig {
  font-size: 19px;
  color: #f2f2f6;
  font-weight: bold;
  margin-right: 10px;
}
.csub {
  flex: 1;
  font-size: 12px;
  color: #6d6d7a;
}
.crow {
  height: 25px;
  flex-direction: row;
  align-items: center;
  background-color: #14141a;
  border-radius: 6px;
  padding-left: 10px;
  padding-right: 10px;
  margin-bottom: 1px;
}
.cname {
  flex: 1;
  font-size: 13px;
  color: #cfcfd8;
}
/* ===== 说明页（类名带 2，避免覆盖首页 .hrow） ===== */
.help2 {
  flex-direction: column;
}
/* 7 行 × 24 + pager 30 = 198，正好落在 201px 可用高度内 */
.hrow2 {
  height: 24px;
  flex-direction: row;
  align-items: center;
}
.hk2 {
  width: 54px;
  font-size: 12px;
  color: #7d7d8a;
}
.hv2 {
  flex: 1;
  font-size: 12px;
  color: #bcbcc8;
}
.ccount {
  font-size: 12px;
  color: #6d6d7a;
  margin-right: 8px;
}
.cgo {
  width: 20px;
  font-size: 12px;
  color: #5b8ec9;
  text-align: right;
}
.cdel {
  width: 60px;
  font-size: 12px;
  color: #d06a6a;
  text-align: right;
}
</style>
