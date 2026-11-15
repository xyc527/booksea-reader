class App extends $falcon.App {
  constructor() { super() }
  onLaunch(options) { super.onLaunch(options) }
  onShow() { super.onShow() }
  onHide() { super.onHide() }
  onDestroy() { super.onDestroy() }
}
try { globalThis['window'] = { requestAnimationFrame, cancelAnimationFrame } } catch (e) {}
try { globalThis['process'] = { env: { NODE_ENV: 'production' } } } catch (e) {}
export default App
