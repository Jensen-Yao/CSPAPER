// 页面级截图（不抢焦点）：验证美化后的 UI
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const out = process.argv[2] || 'F:/tmp/ui-check.png'
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9234'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9234/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9234')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      try { if (await p.locator('.shell').count()) { page = p; break } } catch {}
    }
    if (page) break
    await wait(500)
  }
  if (!page) throw new Error('no window')
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.waitForSelector('.pcard', { timeout: 30000 })
  await wait(2500)
  await page.screenshot({ path: out })
  console.log('saved', out)
} catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
