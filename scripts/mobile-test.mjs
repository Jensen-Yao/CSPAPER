// 移动端 Web 真浏览器实测（Edge 无头）：加载 cspack → 打开论文 → pdf.js 渲染
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 860 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
await page.goto('http://127.0.0.1:8123/?pack=sample.cspack')
await page.waitForTimeout(3000)
const cards = await page.locator('.paper').count()
console.log('T-m1 卡片列表:', cards >= 6 ? 'PASS (' + cards + ')' : 'FAIL (' + cards + ')')
await page.locator('.paper').first().click()
let canvasOk = true
try {
  await page.waitForSelector('#pages canvas', { timeout: 40000 })
} catch { canvasOk = false }
await page.waitForTimeout(3000)
const canvases = await page.locator('#pages canvas').count()
console.log('T-m2 PDF 渲染:', canvasOk && canvases >= 1 ? `PASS (${canvases} 页)` : 'FAIL')
await page.screenshot({ path: 'F:/tmp/mobile-reader.png' })
console.log('console errors:', errs.length ? errs.slice(0, 4) : '无')
await browser.close()
process.exit(0)
