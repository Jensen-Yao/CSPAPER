// 排查：阅读器目录面板的视觉问题
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9238'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9238/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9238')
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
  await page.locator('.pcard').first().dblclick()
  await page.waitForSelector('canvas', { timeout: 30000 })
  await wait(2500)
  // 打开目录面板
  await page.locator('button[title="目录 / 书签"]').click()
  await wait(1500)
  const info = await page.evaluate(() => {
    const navi = document.querySelector('.pdf-navi')
    return {
      items: document.querySelectorAll('.pdf-toc-item').length,
      naviHTML: navi ? navi.innerHTML.slice(0, 300) : '无面板',
      naviSize: navi ? [navi.offsetWidth, navi.offsetHeight] : null
    }
  })
  console.log('TOC 状态:', JSON.stringify(info, null, 1))
  await page.screenshot({ path: 'F:/tmp/outline-check.png' })
} catch (e) { console.error('FAIL', String(e).slice(0, 200)) }
finally { try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
process.exit(0)
