// 复现两个 bug（带逐步落盘）：①主题星系卡死 ②卡片详情面板滚不到底
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit', 'probe-bugs.log')
const say = (m) => { const line = `${new Date().toISOString().slice(11, 23)} ${m}`; fs.appendFileSync(OUT, line + '\n'); console.log(line) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
fs.writeFileSync(OUT, '')

const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9244'], {
  cwd: ROOT,
  env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' },
  stdio: 'ignore'
})
setTimeout(() => { say('HARD-TIMEOUT kill'); try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 150000)

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9244/json/version'); if (r.ok) break } catch {} ; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9244')
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => /index\.html/.test(p.url())) ?? null
    if (!page) await wait(300)
  }
  say('page attached: ' + page.url().slice(0, 60))
  page.on('pageerror', (e) => say('[pageerror] ' + String(e).slice(0, 250)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const jsClick = async (sel, text) => {
    say('click ' + text)
    await page.evaluate(([s, t]) => {
      const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t))
      if (el) el.click()
      else throw new Error('not found: ' + t)
    }, [sel, text])
    say('clicked ' + text)
  }

  // ---- Bug 2：卡片 → 详情面板滚动 ----
  const card = page.locator('.pcard').first()
  if (await card.count()) {
    await card.click()
    say('card clicked')
    await wait(1500)
    const m = await page.evaluate(() => {
      const sc = document.querySelector('.pd-scroll')
      if (!sc) return { found: false }
      sc.scrollTop = sc.scrollHeight
      return { found: true, clientH: sc.clientHeight, scrollH: sc.scrollHeight, after: sc.scrollTop }
    })
    say('PD-SCROLL ' + JSON.stringify(m))
    await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'bug2-detail.png') })
    await page.evaluate(() => document.querySelector('.pd-x')?.click())
    await wait(500)
  }

  // ---- Bug 1：主题星系 ----
  await jsClick('.tb-q', '纵览')
  await wait(2000)
  await jsClick('.ov-tab', '知识')
  await wait(2500)
  say('click 主题星系 (fire-and-forget)')
  page
    .evaluate(() => {
      const el = [...document.querySelectorAll('.kv-chip')].find((b) => b.textContent.trim().includes('主题星系'))
      if (el) el.click()
      else throw new Error('not found')
    })
    .then(() => say('galaxy click evaluate RETURNED'))
    .catch((e) => say('galaxy click err ' + String(e).slice(0, 120)))
  await wait(6000)
  say('capturing stack...')
  const cdp = await page.context().newCDPSession(page)
  const stacks = []
  cdp.on('Debugger.paused', async (ev) => {
    const fr = (ev.callFrames ?? []).slice(0, 12).map((f) => {
      const fn = f.functionName || '(anonymous)'
      const loc = `${(f.url || '').split('/').pop()}:${f.location.lineNumber + 1}`
      return `${fn} @ ${loc}`
    })
    stacks.push(fr)
    say('STACK[\n  ' + fr.join('\n  ') + '\n]')
    await cdp.send('Debugger.resume').catch(() => {})
  })
  await cdp.send('Debugger.enable').catch(() => {})
  for (let k = 0; k < 3 && stacks.length === 0; k++) {
    await cdp.send('Debugger.pause').catch(() => {})
    await wait(2000)
  }
  if (!stacks.length) say('no stack captured (pause not delivered?)')
  await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'bug1-galaxy.png') })
  say('PROBE-DONE')
} catch (e) {
  say('PROBE-ERR ' + String(e).slice(0, 250))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  setTimeout(() => process.exit(0), 500)
}
