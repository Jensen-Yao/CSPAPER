import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9241'], { env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9241/json/version'); if (r.ok) break } catch {}; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9241')
  let page = null
  for (let i = 0; i < 30 && !page; i++) { const ctx = browser.contexts()[0]; const ps = ctx ? ctx.pages() : []; page = ps.find((p) => !p.url().startsWith('devtools')) ?? null; if (!page) await wait(500) }
  page.on('console', (m) => console.log('[console.' + m.type() + ']', m.text().slice(0, 200)))
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(3500)
  const clickText = async (sel, text) => { await page.evaluate(([s, t]) => { const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t)); if (el) el.click(); else throw new Error('not found: ' + t) }, [sel, text]) }
  await clickText('.mode-toggle button', '纵览'); await wait(1500)
  await clickText('.ov-tab', '知识'); await wait(2000)
  await clickText('.kv-chip', '主题星系')
  console.log('[click] 主题星系 已派发')
  for (let i = 0; i < 4; i++) {
    const alive = await Promise.race([
      page.evaluate(() => ({ pinned: document.body.dataset.pinned ?? '', topics: !!document.querySelector('.kv-gal, [class*=gal]'), now: Date.now() })),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 卡死 ' + (i + 1)))), 8000)
    ]).catch((e) => 'DEAD: ' + String(e).slice(0, 60))
    console.log('[probe', i + 1 + ']', JSON.stringify(alive))
    await wait(2000)
  }
  await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'debug-topic.png') })
  console.log('DEBUG-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) } finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {} ; process.exit(0) }
