// 交互链专项：拖拽导入模拟 / 右键菜单 / 高亮编辑条 / 浮动条
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9274'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 220000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9274/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9274')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  // 1 右键卡片菜单（原生菜单无法 DOM 检查，验证 IPC 不崩）
  await page.locator('.pcard').first().click({ button: 'right' }).catch(() => {})
  await wait(700)
  console.log('right-click ok')
  // 2 打开阅读器 → 选词高亮浮动条
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await wait(5500)
  // 真实鼠标拖选（浮动条由 React onMouseUp 触发，合成 selection 不够）
  const box = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => (s.textContent || '').length > 0)
    if (spans.length < 6) return null
    const a = spans[1].getBoundingClientRect()
    const b = spans[5].getBoundingClientRect()
    return { x1: a.left + 4, y1: a.top + a.height / 2, x2: b.right - 4, y2: b.top + b.height / 2 }
  })
  let float = false
  if (box) {
    await page.mouse.move(box.x1, box.y1)
    await page.mouse.down()
    await page.mouse.move(box.x2, box.y2, { steps: 8 })
    await page.mouse.up()
    await wait(600)
    float = await page.evaluate(() => !!document.querySelector('.float-bar'))
  }
  console.log('drag-box:', JSON.stringify(box), 'float-bar visible:', float)
  await page.screenshot({ path: 'ui-audit/int-reader.png' })
  console.log('INTERACT-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
