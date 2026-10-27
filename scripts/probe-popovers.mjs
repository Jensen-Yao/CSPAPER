// 弹层边界检测：打开各弹层后检查是否越出视口/遮挡关键操作
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9272'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 200000)
const checkPop = async (page, label) => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const bad = []
    for (const sel of ['.modal', '.wb-pop', '.wb-slash', '.wb-templates-pop', '.palette']) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'absolute') continue
        const b = el.getBoundingClientRect()
        if (b.width === 0) continue
        if (b.left < -4 || b.top < -4 || b.right > vw + 4 || b.bottom > vh + 4) {
          bad.push({ sel, box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], vw, vh })
        }
      }
    }
    return bad
  })
  console.log(`[${label}]`, r.length ? JSON.stringify(r) : 'in-bounds')
}
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9272/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9272')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1180, height: 720 })
  await wait(4000)
  // 设置弹窗
  await page.evaluate(() => { const btn = [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('title') === '设置'); btn?.click() })
  await wait(1200); await checkPop(page, 'settings')
  await page.keyboard.press('Escape'); await wait(400)
  // 命令面板
  await page.keyboard.press('Control+k'); await wait(900); await checkPop(page, 'palette')
  await page.keyboard.press('Escape'); await wait(400)
  // Work 弹层（模型/推理下拉 + 斜杠菜单）
  await page.evaluate(() => { const b = [...document.querySelectorAll('.top-switch button')].find((x) => x.textContent.includes('Work')); b?.click() })
  await wait(1200)
  await page.fill('.wb-compose-input', '/')
  await wait(500); await checkPop(page, 'wb-slash')
  await page.fill('.wb-compose-input', '')
  await page.evaluate(() => { const b = [...document.querySelectorAll('.wb-pill')].find((x) => x.textContent.includes('推理') || x.textContent.includes('深度')); b?.click() })
  await wait(500); await checkPop(page, 'wb-pop')
  await page.keyboard.press('Escape')
  console.log('POPOVER-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
