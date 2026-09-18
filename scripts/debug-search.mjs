import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9232'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9232/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9232')
  let page = null
  for (let i = 0; i < 40; i++) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      try { if (await p.locator('.searchbox').count()) { page = p; break } } catch {}
    }
    if (page) break
    await wait(500)
  }
  if (!page) throw new Error('no window')
  page.on('console', (m) => { if (m.text().includes('[deep-debug]')) console.log('[c]', m.text()) })
  await page.locator('.searchbox').fill('韧性')
  await wait(2000)
  console.log('韧性 snips:', await page.locator('.deep-snip').count())
  await page.locator('.searchbox').fill('蒙特卡洛')
  await wait(4000)
  const r = await page.evaluate(() => ({ sections: [...document.querySelectorAll('.lib-section')].map((x) => x.textContent), rows: document.querySelectorAll('.paper-item.deep').length }))
  console.log('蒙特卡洛 UI:', JSON.stringify(r))
} catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
