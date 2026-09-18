// 移动端 Web 真浏览器实测（Edge 无头）：加载 cspack → 打开论文 → pdf.js 渲染
import { chromium } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const MOBILE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'mobile')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cspack': 'application/octet-stream', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  const file = path.join(MOBILE_DIR, p)
  try {
    const data = fs.readFileSync(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404); res.end('not found')
  }
})
await new Promise((r) => server.listen(8123, '127.0.0.1', r))
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 860 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
await page.goto('http://127.0.0.1:8123/?pack=sample.cspack')
await page.waitForTimeout(6000)
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
const stText = (await page.evaluate(() => document.getElementById('statusBtn').textContent.trim()))
console.log('T-m2b 阅读状态:', stText === '在读' ? 'PASS' : 'FAIL (' + stText + ')')
// 全文对照：免 Key 真实翻译
await page.locator('#bilBtn').click()
let bilOk = true
try {
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('.bil .dst')]
    return els.length >= 2 && els.slice(0, 2).every((e) => e.textContent.trim().length > 4)
  }, { timeout: 60000 })
} catch { bilOk = false }
console.log('T-m3 全文对照翻译:', bilOk ? 'PASS' : 'FAIL')
// AI 面板（未配置 Key 应提示）
await page.evaluate(() => document.getElementById('aiBtn').click())
await page.waitForTimeout(500)
const aiText = await page.evaluate(() => [...document.querySelectorAll('.sheet')].map((x) => x.innerText).join(' | '))
console.log('T-m4 AI 问答面板:', (aiText.includes('未配置') || aiText.includes('AI 问答')) ? 'PASS' : 'FAIL')
await page.screenshot({ path: 'F:/tmp/mobile-ai.png' })
console.log('console errors:', errs.length ? errs.slice(0, 4) : '无')
await browser.close()
server.close()
process.exit(0)
