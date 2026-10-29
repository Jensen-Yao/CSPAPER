// 落地页渲染验证（本地服务 + Edge 无头截图）
import { chromium } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'docs')
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/') p = '/index.html'
  try {
    const data = fs.readFileSync(path.join(DOCS, p))
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' })
    res.end(data)
  } catch { res.writeHead(404); res.end() }
})
await new Promise((r) => server.listen(8124, '127.0.0.1', r))
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const broken = []
page.on('response', (r) => { if (r.status() >= 400) broken.push(r.url().split('/').pop()) })
await page.goto('http://127.0.0.1:8124/')
await page.waitForTimeout(1200)
await page.screenshot({ path: 'F:/tmp/landing-hero.png' })
await page.evaluate(() => document.getElementById('features')?.scrollIntoView())
await page.waitForTimeout(600)
await page.screenshot({ path: 'F:/tmp/landing-features.png' })
await page.evaluate(() => document.getElementById('download')?.scrollIntoView())
await page.waitForTimeout(600)
await page.screenshot({ path: 'F:/tmp/landing-download.png' })
await page.goto('http://127.0.0.1:8124/demo.html')
await page.waitForTimeout(800)
const demoOk = (await page.locator('#demoBanner').count()) > 0
await page.getByRole('button', { name: '⚡ Work' }).click()
await page.waitForSelector('#workTodayView:visible')
const todayOk = await page.getByRole('heading', { name: '今日科研', exact: true }).isVisible()
await page.locator('[data-work-view="calendar"]').first().click()
await page.waitForSelector('#workCalendarView:visible')
const calendarOk = await page.getByRole('heading', { name: '科研日历' }).isVisible()
await page.locator('[data-work-view="task"]').first().click()
await page.waitForSelector('#workTaskView:visible')
const taskOk = await page.getByRole('heading', { name: 'AI 任务' }).isVisible()
await page.locator('[data-work-view="today"]').first().click()
await page.screenshot({ path: 'F:/tmp/landing-work.png' })
if (!demoOk || !todayOk || !calendarOk || !taskOk) throw new Error(`demo Work views missing: banner=${demoOk}, today=${todayOk}, calendar=${calendarOk}, task=${taskOk}`)
console.log('hero/features/download 截图完成 | demo Work 今日/日历/任务: OK | 404 资源:', broken.length ? broken.join(',') : '无')
await browser.close()
server.close()
process.exit(0)
