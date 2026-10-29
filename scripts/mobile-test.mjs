// 移动端 Web 真浏览器实测（Edge 无头）：内存生成 cspack → 打开论文 → pdf.js 渲染。
import { chromium } from 'playwright-core'
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createSamplePack } from './make-mobile-fixture.mjs'

const MOBILE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'mobile')
const FIXTURE_PACK = createSamplePack()
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cspack': 'application/octet-stream', '.png': 'image/png' }
const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/__fixture.cspack') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': FIXTURE_PACK.length })
    return res.end(FIXTURE_PACK)
  }
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
await new Promise((resolve) => server.listen(8123, '127.0.0.1', resolve))

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 420, height: 860 } })
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-mobile-'))
const errors = []
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${name}: ${ok ? 'PASS' : 'FAIL'}${ok || !detail ? '' : ` (${detail})`}`)
  if (!ok) failures.push(name)
}
page.on('pageerror', (error) => errors.push('pageerror: ' + String(error).slice(0, 200)))
page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 200)) })

// 翻译接口在测试中固定响应，避免公共免费通道限流导致移动端回归抖动。
await page.route(/https:\/\/translate\.googleapis\.com\/.*/, async route => {
  const body = JSON.stringify([[['移动端对照翻译回归结果。', null, null, null]], null, 'en'])
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body })
})
await page.route(/https:\/\/api\.mymemory\.translated\.net\/.*/, async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ responseData: { translatedText: '移动端对照翻译回归结果。' } }) })
})

await page.goto('http://127.0.0.1:8123/?pack=__fixture.cspack')
await page.waitForTimeout(6000)
const cards = await page.locator('.paper').count()
check('T-m1 卡片列表', cards >= 6, String(cards))

await page.locator('.paper').first().click()
let canvasOk = true
try {
  await page.waitForSelector('#pages canvas', { timeout: 40000 })
} catch {
  canvasOk = false
}
await page.waitForTimeout(3000)
const canvases = await page.locator('#pages canvas').count()
check('T-m2 PDF 渲染', canvasOk && canvases >= 1, `${canvases} pages`)
await page.screenshot({ path: path.join(shotDir, 'mobile-reader.png') })

const statusText = await page.evaluate(() => document.getElementById('statusBtn').textContent.trim())
check('T-m2b 阅读状态', statusText === '在读', statusText)

await page.locator('#bilBtn').click()
let bilingualOk = true
try {
  await page.waitForFunction(() => {
    const elements = [...document.querySelectorAll('.bil .dst')]
    return elements.length >= 1 && elements.some((element) => (element.textContent ?? '').trim().length > 4)
  }, null, { timeout: 20000 })
} catch {
  bilingualOk = false
}
check('T-m3 全文对照翻译', bilingualOk)

await page.evaluate(() => document.getElementById('aiBtn').click())
await page.waitForTimeout(500)
const aiText = await page.evaluate(() => [...document.querySelectorAll('.sheet')].map((element) => element.innerText).join(' | '))
check('T-m4 AI 问答面板', aiText.includes('未配置') || aiText.includes('AI 问答'), aiText.slice(0, 80))
await page.screenshot({ path: path.join(shotDir, 'mobile-ai.png') })

console.log('console errors:', errors.length ? errors.slice(0, 4) : '无')
if (errors.length) failures.push('renderer errors')
await browser.close()
server.close()
if (failures.length) {
  console.error(`MOBILE_TEST_FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
