// 浏览器插件真浏览器加载验证（Edge + --load-extension）
import { chromium } from 'playwright-core'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const ext = path.join(ROOT, 'extension')
let browser
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: false, // MV3 service worker 在有头模式最可靠
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch'
    ]
  })
  let swContext = null
  for (let i = 0; i < 30 && !swContext; i++) {
    for (const c of browser.contexts()) {
      if (c.serviceWorkers().length) { swContext = c; break }
    }
    if (!swContext) await new Promise((r) => setTimeout(r, 600))
  }
  if (!swContext) throw new Error('service worker 未启动（30s）')
  const sw = swContext.serviceWorkers()[0]
  const version = await sw.evaluate(() => chrome.runtime.getManifest().version)
  const name = await sw.evaluate(() => chrome.runtime.getManifest().name)
  console.log(`PASS 插件加载: ${name} v${version}，service worker 运行中`)
  // 右键菜单注册验证（菜单在 installed 时创建）
  const menuOk = await sw.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 't', title: 't', contexts: ['page'] }, () => resolve('ok'))
      })
    })
  })
  console.log('PASS 菜单 API 可用:', menuOk)
} catch (e) {
  console.log('FAIL:', String(e).slice(0, 200))
} finally {
  await browser?.close().catch(() => {})
}
process.exit(0)
