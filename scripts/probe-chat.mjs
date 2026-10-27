import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = 'F:/SelfSoftware/cspaper/cspaper-main'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9249'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9249/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9249')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  // 切对话模式
  const modeInfo = await page.evaluate(() => [...document.querySelectorAll('.mode-toggle button')].map((b) => b.textContent.trim() + ':' + b.className))
  console.log('mode buttons:', JSON.stringify(modeInfo))
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('对话')); b?.click() })
  await wait(1500)
  const ta = page.locator('.hero-textarea, .chat-view-input textarea').first()
  console.log('ta count:', await ta.count(), 'visible:', await ta.isVisible().catch(() => 'err'))
  await ta.fill('/help')
  await ta.press('Enter')
  await wait(700)
  console.log('notice:', await page.evaluate(() => document.querySelector('.wb-notice')?.textContent ?? '(none)'))
  console.log('input value:', await page.evaluate(() => document.querySelector('.hero-textarea')?.value ?? document.querySelector('.chat-view-input textarea')?.value ?? '(none)'))
  await page.screenshot({ path: 'F:/tmp/probe-chat.png' })
} catch (e) { console.log('ERR', String(e).slice(0, 250)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
