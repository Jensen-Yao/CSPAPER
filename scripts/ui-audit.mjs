// UI 巡检：启动应用逐视图截图到 ui-audit/ 目录
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit')
fs.mkdirSync(OUT, { recursive: true })
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9227'], { cwd: ROOT, env, stdio: 'ignore' })

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9227/json/version'); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9227')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)

  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name) }

  await shot('01-home')

  // 打开一篇 PDF（双击卡片）
  const card = page.locator('.pcard').first()
  if (await card.count()) {
    await card.dblclick()
    await wait(5000)
    await shot('02-reader')
    // 侧栏详情 tab
    const infoTab = page.locator('.side-tab', { hasText: '详情' })
    if (await infoTab.count()) { await infoTab.click(); await wait(1500); await shot('03-detail') }
    const refsTab = page.locator('.side-tab', { hasText: '文献' })
    if (await refsTab.count()) { await refsTab.click(); await wait(1200); await shot('04-refs') }
    const notesTab = page.locator('.side-tab', { hasText: '标注' })
    if (await notesTab.count()) { await notesTab.click(); await wait(1000); await shot('05-highlights') }
  }

  // 纵览-表格
  await page.locator('.mode-toggle button', { hasText: '纵览' }).click()
  await wait(2500)
  await shot('06-table')
  // 纵览-知识网络
  await page.locator('.ov-tab', { hasText: '知识网络' }).click()
  await wait(3500)
  await shot('07-graph')
  // 纵览-统计
  await page.locator('.ov-tab', { hasText: '统计' }).click()
  await wait(2500)
  await shot('08-stats')

  // 笔记中心
  await page.locator('.mode-toggle button', { hasText: '笔记' }).click()
  await wait(3000)
  await shot('09-notes')

  // 设置页
  await page.locator('.icon-btn[title="设置"]').click()
  await wait(1500)
  await shot('10-settings')
  const navTranslators = page.locator('.set-nav >> text=在线获取')
  if (await navTranslators.count()) { await navTranslators.click(); await wait(1500); await shot('11-settings-translators') }
  const navCites = page.locator('.set-nav >> text=引文样式')
  if (await navCites.count()) { await navCites.click(); await wait(1500); await shot('12-settings-cites') }
  await page.keyboard.press('Escape')
  await wait(500)

  console.log('AUDIT-DONE')
} catch (e) {
  console.log('AUDIT-ERR', String(e).slice(0, 300))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  process.exit(0)
}
