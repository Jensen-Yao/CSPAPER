import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9260'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9260/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9260')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  // 打开设置（点最后一个 icon-btn = 齿轮）
  await page.evaluate(() => { const btn = [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('title') === '设置'); btn?.click() })
  await wait(1500)
  // 点「模型服务」导航
  await page.evaluate(() => { const el = [...document.querySelectorAll('.set-nav-item')].find((b) => b.textContent.includes('模型服务')); el?.click() })
  await wait(1000)
  await page.screenshot({ path: 'ui-audit/m1-prov-list.png' })
  const listInfo = await page.evaluate(() => ({ rows: document.querySelectorAll('.prov-row').length, hasReasoning: document.body.textContent.includes('思考深度') }))
  console.log('LIST:', JSON.stringify(listInfo))
  // 进第一个供应商详情
  await page.evaluate(() => document.querySelector('.prov-row')?.click())
  await wait(800)
  await page.screenshot({ path: 'ui-audit/m2-prov-detail.png' })
  const det = await page.evaluate(() => ({
    hasCaps: document.querySelectorAll('.mcaps').length,
    hasFetch: document.body.textContent.includes('拉取列表'),
    hasBack: document.body.textContent.includes('模型能力')
  }))
  console.log('DETAIL:', JSON.stringify(det))
  console.log('MODEL-PAGE-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
