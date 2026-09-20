// 诊断：点击 Work 后 DOM 状态探针
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const dataDir = fs.mkdtempSync(path.join(process.env.TEMP, 'cspaper-probe-'))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9241'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: dataDir }, stdio: 'ignore' })

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9241/json/version'); if (r.ok) break } catch {} ; await wait(200) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9241')
  let page = null
  for (let i = 0; i < 60 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    if (pages.length) console.log('[pages]', pages.map((p) => p.url().slice(0, 90)).join(' | '))
    page =
      pages.find((p) => /index\.html|localhost:51\d\d|out\/renderer/.test(p.url())) ??
      pages.find((p) => !p.url().startsWith('devtools') && !p.url().startsWith('chrome-extension')) ??
      null
    if (!page) await wait(200)
  }
  // 尽早挂上错误监听（首启崩溃可能发生在连接前，这里尽量抢在加载完成前）
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 600)))
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 400)) })
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(8000)

  const probe = async (label) => {
    const info = await page.evaluate(() => ({
      topSwitches: [...document.querySelectorAll('.top-switch button')].map((b) => b.textContent.trim()),
      topSwitchOn: [...document.querySelectorAll('.top-switch button')].map((b) => b.className),
      wbHost: !!document.querySelector('.wb-host'),
      navItems: [...document.querySelectorAll('.wb-nav-item')].map((b) => b.textContent.trim()).slice(0, 8),
      rootChildren: document.querySelector('.shell')?.children.length ?? -1
    }))
    console.log(label, JSON.stringify(info))
  }
  await probe('before:')
  const res = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.top-switch button')].find((b) => b.textContent.includes('Work'))
    if (!btn) return 'no-work-btn'
    btn.click()
    return 'clicked:' + btn.className
  })
  console.log('click =>', res)
  await wait(2000)
  await probe('after:')
  await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'probe-work.png') })
} catch (e) {
  console.log('PROBE-ERR', String(e).slice(0, 300))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  process.exit(0)
}
