import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9236'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9236/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9236')
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
  await page.locator('.set-nav-item', { hasText: '模型服务' }).click()
  await page.waitForSelector('.profile-card', { timeout: 10000 })
  await wait(600)
  await page.screenshot({ path: 'F:/tmp/set-model.png' })
  // 服务商选择器
  await page.locator('.profile-add', { hasText: '从服务商库添加' }).click()
  await page.waitForSelector('.picker-grid', { timeout: 10000 })
  await wait(500)
  await page.screenshot({ path: 'F:/tmp/set-picker.png' })
  console.log('settings shots ok')
} catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
