// 全界面截图审计：覆盖所有主要屏（含此前未审的设置/统计形态/对比/笔记/网页）
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit')
fs.mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9252'], {
  cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore'
})
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 200000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9252/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9252')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') }).then(() => console.log('shot', n))
  const clickTitle = async (t) => { await page.evaluate((tt) => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes(tt)); el?.click() }, t) }
  const clickText = async (sel, t) => { await page.evaluate(([s, tt]) => { const el = [...document.querySelectorAll(s)].find((b) => (b.textContent || '').trim().includes(tt)); el?.click() }, [sel, t]) }

  await shot('f01-home')
  await page.locator('.pcard').first().click().catch(() => {})
  await wait(1400); await shot('f02-detail')
  await page.evaluate(() => document.querySelector('.pd-x')?.click()); await wait(300)
  // 设置（逐分区截 2 屏）
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].pop()?.click()); await wait(1600)
  await shot('f03-settings-top')
  await clickText('.set-nav-item, .set-nav button, nav button', '模型服务').catch(() => {})
  await wait(700); await shot('f04-settings-model')
  await page.keyboard.press('Escape'); await wait(400)
  // 对比
  await clickTitle('对比'); await wait(2200); await shot('f05-compare')
  // 纵览表格
  await clickTitle('纵览'); await wait(2000); await shot('f06-overview')
  // 统计各形态
  await clickText('.ov-tab', '统计'); await wait(2500); await shot('f07-stats-cloud')
  for (const form of ['气泡', '时间线', '热力']) {
    await clickText('.st2-chip, .chip, button', form).catch(() => {})
    await wait(1600); await shot('f08-stats-' + form)
  }
  // 知识
  await clickText('.ov-tab', '知识'); await wait(2000)
  await clickText('.kv-chip', '主题星系'); await wait(2500); await shot('f09-galaxy')
  // 笔记
  await clickTitle('笔记'); await wait(2000); await shot('f10-notes')
  // 网页
  await clickTitle('网页'); await wait(2500); await shot('f11-web')
  // 阅读器
  await clickTitle('纵览').catch(() => {})
  await page.evaluate(() => { const b = [...document.querySelectorAll('.top-switch button')].find((x) => x.textContent.includes('Paper')); b?.click() })
  await page.locator('.pcard').first().dblclick().catch(() => {})
  await wait(5000); await shot('f12-reader')
  // Work
  await clickText('.top-switch button', 'Work'); await wait(1800); await shot('f13-work')
  // 深色主题轮：核心屏重截
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await wait(600)
  await shot('d01-home')
  await page.locator('.pcard').first().click().catch(() => {})
  await wait(1200); await shot('d02-detail')
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes('纵览')); el?.click() })
  await wait(1500); await shot('d06-overview')
  await clickText('.ov-tab', '统计'); await wait(2000); await shot('d07-stats')
  await clickText('.top-switch button', 'Work'); await wait(1500); await shot('d13-work')
  console.log('DARK-ROUND-DONE')
} catch (e) { console.log('ERR', String(e).slice(0, 200)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
