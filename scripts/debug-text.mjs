import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9225'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9225/json/version'); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 400)))
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)))
  await wait(6000)
  console.log('URL:', page.url())
  console.log('BODY:', (await page.evaluate(() => document.body.innerText.slice(0, 300))))
  await page.screenshot({ path: 'F:/tmp/debug-state.png' })
} catch (e) { console.error('FAIL', String(e).slice(0, 300)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
