// UI 巡检：Work/Paper 双模式截图到 ui-audit/
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit')
fs.mkdirSync(OUT, { recursive: true })
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9235'], { cwd: ROOT, env, stdio: 'ignore' })

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9235/json/version'); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9235')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot', n) }
  const jsClick = async (sel, text) => {
    await page.evaluate(([s, t]) => {
      const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t))
      if (el) el.click()
      else throw new Error('not found: ' + t)
    }, [sel, text])
  }

  // Work 模式
  await jsClick('.top-switch button', 'Work')
  await wait(2500)
  await shot('w1-work-hero')
  await jsClick('.wb-nav-item', '技能')
  await wait(2000)
  await shot('w2-work-skills')
  await jsClick('.wb-nav-item', '自动化')
  await wait(1500)
  await shot('w3-work-auto')
  await jsClick('.wb-nav-item', '插件市场')
  await wait(1500)
  await shot('w4-work-mcp')

  // Paper 模式
  await jsClick('.top-switch button', 'Paper')
  await wait(2000)
  await shot('p1-home')
  const card = page.locator('.pcard').first()
  if (await card.count()) {
    await card.dblclick()
    await wait(5000)
    await shot('p2-reader')
  }
  await jsClick('.tb-q', '纵览')
  await wait(2500)
  await shot('p3-overview')
  await jsClick('.ov-tab', '知识')
  await wait(2500)
  await shot('p4-graph')

  console.log('AUDIT-DONE')
} catch (e) {
  console.log('AUDIT-ERR', String(e).slice(0, 250))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  process.exit(0)
}
