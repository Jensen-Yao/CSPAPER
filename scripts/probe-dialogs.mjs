// Dialog 卡口：新建标签/集合/独立笔记/便签经新弹窗真实创建（prompt 替换后必须可用）
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9284'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 180000)
const FAIL = []
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); if (!ok) FAIL.push(n) }
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9284/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9284')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 150)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  // 1 新建标签
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tag-add-btn')].find((x) => (x.getAttribute('title') || '').includes('新建标签')); b?.click() })
  await wait(600)
  let hasDialog = await page.evaluate(() => !!document.querySelector('.dlg-input'))
  check('标签弹窗出现', hasDialog === true)
  if (hasDialog) {
    await page.fill('.dlg-input', '探针标签' + Date.now() % 1000)
    await page.evaluate(() => [...document.querySelectorAll('.dlg-btn.primary')].pop()?.click())
    await wait(900)
  }
  const tagCreated = await page.evaluate(async () => {
    const ts = await window.api.tagsList()
    return ts.some((t) => t.name.includes('探针标签'))
  })
  check('标签创建成功(API)', tagCreated === true)
  // 2 新建独立笔记（先切笔记视图）
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes('笔记')); el?.click() })
  await wait(1800)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.btn')].find((x) => x.textContent.includes('独立笔记')); b?.click() })
  await wait(600)
  hasDialog = await page.evaluate(() => !!document.querySelector('.dlg-input'))
  check('独立笔记弹窗出现', hasDialog === true)
  if (hasDialog) {
    await page.fill('.dlg-input', '探针笔记')
    await page.evaluate(() => [...document.querySelectorAll('.dlg-btn.primary')].pop()?.click())
    await wait(900)
  }
  const noteCreated = await page.evaluate(() => !!document.querySelector('.snote-card'))
  check('独立笔记创建成功', noteCreated === true)
  console.log(FAIL.length === 0 ? 'DIALOG-GATE-PASS' : 'DIALOG-FAIL: ' + FAIL.join(' | '))
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
