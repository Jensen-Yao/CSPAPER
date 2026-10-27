// 高亮全链路：真拖选→点高亮→点击高亮→编辑条出现→改色/备注→导出验证
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9278'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 220000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9278/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9278')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await page.waitForSelector('.page-wrap canvas', { timeout: 20000 })
  await wait(2500)
  // textLayer 渲染完成再拖（span > 100）
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.textLayer span').length)
    if (n > 100) break
    await wait(500)
  }
  // 拖选
  const box = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => {
      if (!(s.textContent || '').length) return false
      const r = s.getBoundingClientRect()
      return r.top > 170 && r.bottom < window.innerHeight - 60 && r.width > 4   // 避开工具栏与底栏
    })
    if (spans.length < 8) return null
    const a = spans[2].getBoundingClientRect()
    const b = spans[6].getBoundingClientRect()
    return { x1: a.left + 4, y1: a.top + a.height / 2, x2: b.right - 4, y2: b.top + b.height / 2 }
  })
  console.log('debug box:', JSON.stringify(box), 'spans:', await page.evaluate(() => document.querySelectorAll('.textLayer span').length))
  await page.mouse.move(box.x1, box.y1); await page.mouse.down()
  await page.mouse.move(box.x2, box.y2, { steps: 8 }); await page.mouse.up()
  const selText = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length)
  await wait(700)
  const hasFloat = await page.evaluate(() => !!document.querySelector('.float-bar'))
  console.log('1a sel len after up:', selText)
  console.log('1 float-bar:', hasFloat)
  // 点黄色高亮
  if (hasFloat) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('.fbdot')].find((x) => x.classList.contains('yellow')); b?.click() })
    await wait(1200)
  }
  const hlCount = await page.evaluate(() => document.querySelectorAll('.hl-group').length)
  console.log('2 highlight groups:', hlCount)
  // 点击高亮 → 编辑条
  const hlBox = await page.evaluate(() => {
    const g = document.querySelector('.hl-group')
    if (!g) return null
    const b = g.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  if (hlBox) {
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el ? el.className?.toString().slice(0, 40) : 'none'
    }, [hlBox.x, hlBox.y])
    console.log('3a elementFromPoint:', hit)
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, [hlBox.x, hlBox.y])
    await wait(700)
    const edit = await page.evaluate(() => {
      const e = document.querySelector('.hl-edit')
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { visible: b.width > 0, inViewport: b.top >= 0 && b.bottom <= window.innerHeight, left: Math.round(b.left) }
    })
    console.log('3 edit bar:', JSON.stringify(edit))
    // 改色为蓝
    await page.evaluate(() => { const b = [...document.querySelectorAll('.hl-edit .fbdot')].find((x) => x.classList.contains('blue')); b?.click() })
    await wait(600)
    // 备注输入
    await page.fill('.hl-edit-input', '方法论段落')
    await page.keyboard.press('Enter')
    await wait(800)
    const after = await page.evaluate(() => document.querySelectorAll('.hl-group').length)
    console.log('4 after edit groups:', after, '(still present = not deleted)')
    await page.screenshot({ path: 'ui-audit/hl-edit-flow.png' })
  }
  console.log('HL-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 250)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
