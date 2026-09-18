// 分步状态探针：每步截图+DOM统计，定位全文翻译依赖的文本层问题
import { chromium } from 'playwright-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }
const stats = () => page.evaluate(() => ({
  pcard: document.querySelectorAll('.pcard').length,
  canvas: document.querySelectorAll('canvas').length,
  wraps: document.querySelectorAll('.page-wrap').length,
  tl: [...document.querySelectorAll('.textLayer')].map((e) => (e.textContent || '').length),
  tabs: [...document.querySelectorAll('.tab-title')].map((e) => e.textContent?.slice(0, 20)),
  err: document.querySelector('.empty-viewer')?.textContent?.slice(0, 120) ?? null
}))

let page = null
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const electron = spawn(electronBin, ['.', '--remote-debugging-port=9224'], { cwd: ROOT, env, stdio: 'ignore' })
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9224/json/version'); if (r.ok) break } catch {}
    await wait(500)
  }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224')
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 200)))
  page.on('pageerror', (e) => console.log('[err]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.waitForSelector('.pcard', { timeout: 30000 })
  await wait(6000)
  console.log('A home:', JSON.stringify(await stats()))
  await page.locator('.pcard').first().click()
  await wait(1000); console.log('B +1s:', JSON.stringify(await stats()))
  await wait(3000); console.log('C +4s:', JSON.stringify(await stats()))
  await wait(6000); console.log('D +10s:', JSON.stringify(await stats()))
  await page.screenshot({ path: 'F:/tmp/probe-reader.png' })
  // 若正文已渲染，尝试全文翻译
  await page.screenshot({ path: 'F:/tmp/probe-reader.png' })
  await page.locator('.side-tab', { hasText: '全文' }).click()
  await wait(400)
  const btn = page.locator('button', { hasText: '翻译本页' }).first()
  const enabled = await btn.isEnabled()
  console.log('E: 翻译本页 enabled =', enabled)
  if (enabled) {
    await btn.click()
    await wait(20000)
    console.log('F bil:', await page.evaluate(() => [...document.querySelectorAll('.bil-dst')].map((e) => e.textContent?.slice(0, 24))))
    await page.screenshot({ path: 'F:/tmp/probe-bil.png' })
  }
  // 划词选择层检查
  console.log('G tlinfo:', await page.evaluate(() => {
    const t = document.querySelector('.textLayer')
    return { children: t?.children.length, html: t?.innerHTML?.slice(0, 120) }
  }))
} catch (e) {
  console.error('FAIL', String(e).slice(0, 300))
  try { await page.screenshot({ path: 'F:/tmp/probe-fail.png' }) } catch {}
} finally {
  try { execSync(`taskkill /pid ${electron.pid} /T /F`, { stdio: 'ignore' }) } catch {}
}
process.exit(0)
