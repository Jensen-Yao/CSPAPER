import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9270'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 160000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9270/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9270')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1100, height: 760 })
  await wait(4000)
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await wait(5000)
  await page.screenshot({ path: 'ui-audit/occ2-narrow-fixed.png' })
  // 工具栏溢出复查
  const tb = await page.evaluate(() => {
    const bar = document.querySelector('.viewer-toolbar')
    if (!bar) return null
    return { sw: bar.scrollWidth, cw: bar.clientWidth, wrapped: getComputedStyle(bar).flexWrap }
  })
  console.log('toolbar:', JSON.stringify(tb))
  // 顶栏溢出复查
  const top = await page.evaluate(() => {
    const t = document.querySelector('.titlebar')
    return t ? { sw: t.scrollWidth, cw: t.clientWidth } : null
  })
  console.log('titlebar:', JSON.stringify(top))
  console.log('OCC2-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
