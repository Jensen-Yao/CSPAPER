import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9237'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9237/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9237')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      try { if (await p.locator('.shell').count()) { page = p; break } } catch {}
    }
    if (page) break
    await wait(500)
  }
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.waitForSelector('.pcard', { timeout: 30000 })
  await page.locator('button[title="设置"]').click()
  await page.waitForSelector('.set-side', { timeout: 10000 })
  const geo = await page.evaluate(() => {
    const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) } }
    return {
      modal: g('.modal'), side: g('.set-side'), main: g('.set-main'),
      head: g('.set-main .modal-head'), scroll: g('.set-main .modal-scroll'),
      actions: g('.set-main .modal-actions'),
      headDisplay: getComputedStyle(document.querySelector('.set-main .modal-head')).display
    }
  })
  console.log(JSON.stringify(geo, null, 1))
} catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
