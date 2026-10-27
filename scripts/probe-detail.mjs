import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9262'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9262/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9262')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  await page.locator('.pcard').first().click().catch(() => {})
  await wait(1500)
  const secs = await page.evaluate(() => [...document.querySelectorAll('.pd-sec-title')].map((x) => x.textContent.trim()))
  console.log('SECS:', JSON.stringify(secs))
  await page.screenshot({ path: 'ui-audit/dbg-detail.png' })
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
