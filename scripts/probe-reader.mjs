import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9266'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9266/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9266')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  for (let i = 0; i < 10; i++) { if (await page.locator('.pcard').count()) break; await wait(500) }
  console.log('cards:', await page.locator('.pcard').count())
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await wait(6000)
  console.log('tabs:', await page.evaluate(() => [...document.querySelectorAll('.tab')].length))
  console.log('page-wrap:', await page.evaluate(() => document.querySelectorAll('.page-wrap').length))
  console.log('main-win class:', await page.evaluate(() => document.querySelector('.main-win')?.className ?? 'none'))
  console.log('tabs-bar:', await page.evaluate(() => !!document.querySelector('.tabs-bar, .pdf-tabs')))
  console.log('main-win inner (200):', await page.evaluate(() => document.querySelector('.main-win')?.innerHTML?.slice(0, 200) ?? 'EMPTY'))
  console.log('viewer children:', await page.evaluate(() => { const el = document.querySelector('.main-win'); return el ? el.querySelectorAll('*').length : -1 }))
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await wait(1500)
  console.log('pd-edit-input:', await page.evaluate(() => document.querySelectorAll('.pd-edit-input').length))
  console.log('pd-panel:', await page.evaluate(() => !!document.querySelector('.pd-panel')))
  console.log('pd-sec:', await page.evaluate(() => document.querySelectorAll('.pd-sec-title').length))
  await page.screenshot({ path: 'ui-audit/dbg-detail2.png' })
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
