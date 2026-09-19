// v0.7 视图复验截图（干净版）
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9231'], { env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9231/json/version'); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9231')
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
  const shot = async (n) => { await page.screenshot({ path: path.join(ROOT, 'ui-audit', n + '.png') }); console.log('shot', n) }
  const clickText = async (sel, text) => { await page.evaluate(([s, t]) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t)); if (el) el.click(); else throw new Error('not found: ' + t) }, [sel, text]) }

  await clickText('.mode-toggle button', '纵览')
  await wait(2000)
  await clickText('.ov-tab', '知识')
  await wait(3000)
  await shot('v2-knowledge-sim')
  await clickText('.kv-chip', '关键词共现')
  await wait(2500)
  await shot('v2-knowledge-kw')
  await clickText('.kv-chip', '作者合作')
  await wait(2500)
  await shot('v2-knowledge-authors')
  await clickText('.kv-chip', '主题星系')
  await wait(2000)
  await shot('v2-knowledge-topics')
  await clickText('.kv-chip', '知识库')
  await wait(1500)
  await shot('v2-knowledge-base')
  await clickText('.ov-tab', '统计')
  await wait(2500)
  await shot('v2-stats')
  await clickText('[class*=st2]', '气泡')
  await wait(1500)
  await shot('v2-stats-bubble')
  await clickText('[class*=st2]', '热力')
  await wait(1500)
  await shot('v2-stats-heat')
  await clickText('.mode-toggle button', '网页')
  await wait(8000)
  await shot('v2-web')

  console.log('AUDIT2-DONE')
} catch (e) {
  console.log('ERR', String(e).slice(0, 250))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  process.exit(0)
}
