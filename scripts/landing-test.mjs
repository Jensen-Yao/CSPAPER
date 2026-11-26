// 落地页与在线演示验证：本地静态服务 + Edge 无头。
// 检查首页关键区块、字体与图片加载、窄屏溢出、在线演示七个视图的交互，以及旧 /demo.html 的跳转。
import { chromium } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DOCS = path.resolve('docs')
const OUT = path.resolve('ui-audit/landing')
fs.mkdirSync(OUT, { recursive: true })
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  let target = decodeURIComponent(req.url.split('?')[0])
  if (target.endsWith('/')) target += 'index.html'
  const file = path.join(DOCS, target)
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(resolve => server.listen(8124, '127.0.0.1', resolve))
const BASE = 'http://127.0.0.1:8124'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const broken = []
const errors = []
let passed = 0
const check = (name, value) => { if (!value) throw new Error('FAIL ' + name); passed++; console.log('PASS ' + name) }
const settle = page => page.waitForLoadState('networkidle').catch(() => {})
const overflow = page => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('response', response => { if (response.status() >= 400) broken.push(response.status() + ' ' + response.url().replace(BASE, '')) })
  page.on('pageerror', error => errors.push(String(error)))

  // ---------- 首页 ----------
  await page.goto(BASE + '/')
  await settle(page)
  check('landing renders the hero headline', (await page.locator('h1').first().innerText()).includes('文献读完'))
  check('landing bundles its own webfonts', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 40px "CSP Serif"') && document.fonts.check('400 14px "CSP Sans"') && document.fonts.check('12px "CSP Mono"') }))
  await page.screenshot({ path: path.join(OUT, 'landing-hero.png') })
  const sections = ['#capabilities', '#workflow', '#work', '#gallery', '#principles', '#download', '#faq']
  for (const id of sections) {
    await page.locator(id).scrollIntoViewIfNeeded()
    await page.waitForTimeout(450)
  }
  await page.waitForTimeout(500)
  const images = await page.evaluate(() => [...document.images].map(image => ({ src: image.currentSrc.split('/').pop(), ok: image.complete && image.naturalWidth > 0 })))
  check('landing loads every screenshot', images.length >= 8 && images.every(image => image.ok))
  check('landing has no horizontal overflow at 1440', (await overflow(page)) <= 1)
  await page.evaluate(() => document.getElementById('work').scrollIntoView())
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'landing-work.png') })
  await page.evaluate(() => document.getElementById('gallery').scrollIntoView())
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'landing-gallery.png') })
  await page.evaluate(() => document.getElementById('download').scrollIntoView())
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, 'landing-download.png') })
  const demoLink = await page.locator('a[href="./demo/"]').count()
  check('landing links to the new online demo', demoLink >= 2)
  await page.close()

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.goto(BASE + '/')
  await settle(phone)
  check('landing has no horizontal overflow at 390', (await overflow(phone)) <= 1)
  await phone.screenshot({ path: path.join(OUT, 'landing-mobile.png') })
  await phone.close()

  // ---------- 在线演示 ----------
  const demo = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  demo.on('pageerror', error => errors.push('demo: ' + String(error)))
  demo.on('response', response => { if (response.status() >= 400) broken.push(response.status() + ' ' + response.url().replace(BASE, '')) })
  await demo.goto(BASE + '/demo/')
  await settle(demo)
  check('demo opens on the research hub', await demo.locator('.research-hub .rh-hero h1').isVisible() && (await demo.locator('.rh-metrics > div').count()) === 4)
  check('demo offers seven views', (await demo.locator('.demo-tabs button').count()) === 7)
  await demo.screenshot({ path: path.join(OUT, 'demo-hub.png') })
  await demo.getByRole('button', { name: '快速记录', exact: true }).click()
  await demo.locator('form[data-form="capture"] textarea').fill('演示里记下的一条想法')
  await demo.locator('form[data-form="capture"] button[type=submit]').click()
  check('demo quick capture saves a note', await demo.locator('.rh-row').filter({ hasText: '演示里记下的一条想法' }).count() === 1)

  await demo.locator('.demo-tabs button[data-view=reader]').click()
  await demo.locator('.page .s').first().waitFor()
  check('demo reader renders the paper and highlights', (await demo.locator('.page .s').count()) > 25 && (await demo.locator('.page .s.hl-y').count()) === 1)
  await demo.locator('.msg.ai .cite').first().click()
  await demo.waitForTimeout(500)
  check('demo citation jumps back to the sentence', (await demo.locator('.page .s.hit').count()) === 1)
  await demo.screenshot({ path: path.join(OUT, 'demo-reader.png') })
  await demo.locator('.doc-tools .pages button').last().click()
  check('demo reader turns to page two', (await demo.locator('.doc-tools .pages span').innerText()) === '2 / 2')
  await demo.locator('.doc-tools .pages button').first().click()

  await demo.locator('.demo-tabs button[data-view=chat]').click()
  await demo.locator('.chat-inner .msg').first().waitFor()
  const before = await demo.locator('.chat-inner .msg').count()
  await demo.locator('.quick button').filter({ hasText: '对比方法' }).click()
  await demo.waitForFunction(count => document.querySelectorAll('.chat-inner .msg').length >= count + 2, before)
  check('demo chat quick prompt returns a scripted answer', await demo.locator('.chat-inner .msg.ai table').count() >= 1)
  check('demo chat keeps conversations in sync in the sidebar', await demo.locator('.demo-tabs button[data-view=chat]').getAttribute('aria-selected') === 'true')

  await demo.locator('.demo-tabs button[data-view=work]').click()
  await demo.locator('.run').waitFor()
  check('demo work shows plan, tool calls and the report', (await demo.locator('.run .step').count()) === 4 && (await demo.locator('.msg.ai').filter({ hasText: '已完成' }).count()) === 1)

  await demo.locator('.demo-tabs button[data-view=projects]').click()
  await demo.locator('.task-card').first().waitFor()
  const todoBefore = await demo.locator('.task-column[data-status=todo] .task-card').count()
  await demo.locator('.task-column[data-status=todo] .task-check').first().click()
  check('demo board completes a task', (await demo.locator('.task-column[data-status=done] .task-card').count()) >= 1 && (await demo.locator('.task-column[data-status=todo] .task-card').count()) === todoBefore - 1)
  await demo.screenshot({ path: path.join(OUT, 'demo-projects.png') })

  await demo.locator('.demo-tabs button[data-view=compare]').click()
  await demo.locator('.cmp-table').waitFor()
  const rowsBefore = await demo.locator('.cmp-table tbody tr:not(.off)').count()
  await demo.locator('.cmp-bar input[data-dim="局限"]').uncheck()
  check('demo comparison toggles dimensions', (await demo.locator('.cmp-table tbody tr:not(.off)').count()) === rowsBefore - 1)

  await demo.locator('.demo-tabs button[data-view=notes]').click()
  await demo.locator('.note-view article').waitFor()
  check('demo opens the captured note in the notes centre', (await demo.locator('.note-view h1').innerText()).includes('演示里记下的一条想法'))
  await demo.locator('.note-item').filter({ hasText: '开题思路' }).click()
  await demo.waitForFunction(() => (document.querySelector('.note-view h1')?.textContent || '').includes('开题思路'))
  check('demo notes render markdown', (await demo.locator('.note-view article h4').count()) >= 2 && (await demo.locator('.note-view article ol li').count()) >= 3)
  await demo.locator('.notes-side .rh-mini').click()
  await demo.locator('form[data-form="capture"] textarea').fill('演示里从笔记中心新建的一条笔记')
  await demo.locator('form[data-form="capture"] button[type=submit]').click()
  check('demo notes centre creates a standalone note', (await demo.locator('.note-view h1').innerText()).includes('演示里从笔记中心新建的一条笔记'))
  check('demo has no horizontal overflow at 1440', (await overflow(demo)) <= 1)
  await demo.setViewportSize({ width: 390, height: 844 })
  await demo.locator('.demo-tabs button[data-view=hub]').click()
  await demo.waitForTimeout(300)
  check('demo has no horizontal overflow at 390', (await overflow(demo)) <= 1)
  await demo.screenshot({ path: path.join(OUT, 'demo-mobile.png') })
  await demo.close()

  // ---------- 旧链接兼容 ----------
  const legacy = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await legacy.goto(BASE + '/demo.html')
  await legacy.waitForURL(url => url.pathname.endsWith('/demo/'), { timeout: 10000 })
  check('legacy /demo.html redirects to /demo/', legacy.url().endsWith('/demo/'))
  await legacy.close()

  check('no failed requests', broken.length === 0)
  check('no page errors', errors.length === 0)
  console.log(JSON.stringify({ passed, broken, errors, out: OUT }))
} catch (error) {
  console.error('LANDING_TEST_FAILED ' + String(error.stack || error))
  console.error(JSON.stringify({ broken, errors }))
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
