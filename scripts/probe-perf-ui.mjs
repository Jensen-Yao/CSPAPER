// UI 性能：阅读器首屏渲染耗时 / 卡片墙滚动帧 / Work 流式渲染
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9276'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 180000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9276/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9276')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  // 阅读器首屏：dblclick 到第 1 页 canvas 出现的耗时
  const t0 = Date.now()
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await page.waitForSelector('.page-wrap canvas', { timeout: 20000 })
  const firstPage = Date.now() - t0
  await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length >= 3, { timeout: 20000 }).catch(() => {})
  const threePages = Date.now() - t0
  console.log(`reader: first-canvas ${firstPage}ms, 3-pages ${threePages}ms`)
  // 长文档滚动流畅度：滚 5 屏的主线程阻塞感（粗暴测 scrollHeight 变化响应）
  const scrollT0 = Date.now()
  await page.evaluate(() => { const el = document.querySelector('.viewer-scroll'); if (el) el.scrollTop = el.scrollHeight })
  await wait(500)
  console.log('scroll-to-end ack:', Date.now() - scrollT0, 'ms')
  // 卡片墙滚动
  await page.evaluate(() => { const b = [...document.querySelectorAll('.top-switch button')].find((x) => x.textContent.includes('Paper')); b?.click() })
  await wait(600)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('阅读')); b?.click() })
  await wait(1000)
  const cT0 = Date.now()
  await page.evaluate(() => { const el = document.querySelector('.libhome'); if (el) el.scrollTop = el.scrollHeight })
  await wait(400)
  console.log('cards scroll ack:', Date.now() - cT0, 'ms')
  console.log('PERF-UI-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
