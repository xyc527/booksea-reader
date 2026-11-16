import { fitViewport } from './lib/geo.js'

class App extends $falcon.App {
  constructor() { super() }
  onLaunch(options) {
    super.onLaunch(options)
    this.applyViewPort()
    this.probeCap()
  }

  /**
   * 分辨率适配：官方推荐做法是「px 布局 + setViewPort(设计宽)」，
   * 由框架把虚拟画布等比缩放到真实屏幕（见 POSC 文档 app/css/css-screen.md）。
   *
   * 但 setViewPort 只按「宽」定缩放比，直接传 936 会在更扁的屏（如 960×266）上切底部，
   * 所以这里反解出虚拟宽 V = 真实宽 / min(W/936, H/280)：整张设计稿等比进屏，
   * 比例不同时留一圈底色，任何机型都不裁内容。
   *
   * 结果写到 globalThis.__shVP，页面读它决定「按设计稿布局」还是「按真实高度重排」。
   * 失败（无 env / 无这个方法 / 抛错）时 ok=0，页面自动退回老路线，不影响启动。
   */
  applyViewPort() {
    const st = { ok: 0, v: 0, scale: 1, w: 0, h: 0, why: '' }
    try {
      let W = 0
      let H = 0
      try {
        const env = ($falcon && $falcon.env) || {}
        W = Number(env.deviceWidth || env.width || 0) || 0
        H = Number(env.deviceHeight || env.height || 0) || 0
      } catch (e) {}
      if (!W || !H) {
        st.why = 'noenv'
      } else {
        const fit = fitViewport(W, H)
        if (!fit.ok) {
          st.why = fit.why || 'nofit'
        } else if (typeof this.setViewPort !== 'function') {
          st.why = 'noapi'
        } else {
          this.setViewPort(fit.v)
          st.ok = 1
          st.v = fit.v
          st.scale = fit.scale
          st.w = W
          st.h = H
          st.tall = fit.tall
          st.boxW = fit.boxW
          st.boxH = fit.boxH
        }
      }
    } catch (e) {
      st.ok = 0
      st.why = 'throw'
    }
    try { globalThis.__shVP = st } catch (e) {}
    try { console.warn('[SH] vp ' + JSON.stringify(st)) } catch (e) {}
    return st
  }

  /**
   * 跨设备能力探测：不同运行体与固件缺的 JS 能力不一样（jsapi.storage / fs / global）。
   * 缺了不能白屏，至少留一行日志说明「这台机器有什么、没什么」。只探不改行为。
   */
  probeCap() {
    const cap = { tag: 'SH' }
    try {
      cap.setViewPort = typeof this.setViewPort === 'function' ? 1 : 0
    } catch (e) {
      cap.setViewPort = -1
    }
    try {
      const env = ($falcon && $falcon.env) || null
      cap.env = env ? env.deviceWidth + 'x' + env.deviceHeight : ''
      cap.model = (env && env.deviceModel) || ''
    } catch (e) {
      cap.env = 'err'
    }
    try {
      cap.jsapi = $falcon && $falcon.jsapi ? 1 : 0
      cap.storage = $falcon && $falcon.jsapi && $falcon.jsapi.storage ? 1 : 0
      cap.http = $falcon && $falcon.jsapi && $falcon.jsapi.http ? 1 : 0
    } catch (e) {
      cap.jsapi = -1
    }
    try {
      globalThis.__shCap = cap
    } catch (e) {}
    try {
      console.warn('[SH] cap ' + JSON.stringify(cap))
    } catch (e) {}
    return cap
  }
  onShow() { super.onShow() }
  onHide() { super.onHide() }
  onDestroy() { super.onDestroy() }
}
try { globalThis['window'] = { requestAnimationFrame, cancelAnimationFrame } } catch (e) {}
try { globalThis['process'] = { env: { NODE_ENV: 'production' } } } catch (e) {}
export default App
