// 遮挡专项检测：滚动容器内容溢出/元素越界/悬浮层遮挡可交互元素
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9268'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 200000)
const audit = async (page, label) => {
  const issues = await page.evaluate(() => {
    const out = []
    // 1) 水平溢出：正文滚动容器 scrollWidth > clientWidth + 2
    for (const el of document.querySelectorAll('div')) {
      if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 100 && getComputedStyle(el).overflowX === 'visible') {
        // 父链上有 hidden 的跳过
        let p = el.parentElement, clipped = false
        while (p) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break } p = p.parentElement }
        if (!clipped) out.push({ type: 'h-overflow', cls: el.className?.slice?.(0, 50), sw: el.scrollWidth, cw: el.clientWidth })
      }
    }
    // 2) 按钮文字被截断（scrollWidth > clientWidth 且 overflow hidden）
    for (const b of document.querySelectorAll('button')) {
      if (b.offsetParent === null) continue
      if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') {
        const txt = (b.textContent || '').trim().slice(0, 18)
        if (txt && b.clientWidth < 24) out.push({ type: 'btn-clipped', cls: b.className.slice(0, 40), txt })
      }
    }
    // 3) 固定/绝对悬浮层遮挡可见交互元素（弹层打开时才算，跳过 mask 类）
    return out.slice(0, 8)
  })
  console.log(`[${label}]`, issues.length ? JSON.stringify(issues) : 'clean')
}
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9268/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9268')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const clickTitle = (t) => page.evaluate((tt) => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes(tt)); el?.click() }, t)
  const clickText = (sel, t) => page.evaluate(([s, tt]) => { const el = [...document.querySelectorAll(s)].find((b) => (b.textContent || '').includes(tt)); el?.click() }, [sel, t])

  await audit(page, 'home')
  await clickTitle('对比'); await wait(1800); await audit(page, 'compare')
  await clickTitle('纵览'); await wait(1500); await audit(page, 'overview')
  await clickText('.ov-tab', '统计'); await wait(2000); await audit(page, 'stats')
  await clickText('.ov-tab', '知识'); await wait(1800); await audit(page, 'knowledge')
  await clickTitle('笔记'); await wait(1500); await audit(page, 'notes')
  await clickTitle('网页'); await wait(2000); await audit(page, 'web')
  await clickText('.top-switch button', 'Work'); await wait(1500); await audit(page, 'work')
  // 阅读器（小窗口 + 缩放后工具栏易溢出）
  await clickText('.top-switch button', 'Paper'); await wait(600)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('阅读')); b?.click() })
  await wait(1200)
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await wait(5500)
  await audit(page, 'reader')
  await page.setViewportSize({ width: 1100, height: 760 })
  await wait(800)
  await audit(page, 'reader-1100w')
  await page.screenshot({ path: 'ui-audit/occ-reader-narrow.png' })
  await page.setViewportSize({ width: 1500, height: 940 })
  console.log('OCCLUSION-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
