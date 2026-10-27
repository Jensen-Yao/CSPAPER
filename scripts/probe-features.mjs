// 第 5 轮真机功能探针：周报/查重/便签/独立笔记/集合/回收站/元数据编辑 全链路
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit', 'probe-features.log')
const say = (m) => { fs.appendFileSync(OUT, m + '\n'); console.log(m) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
fs.writeFileSync(OUT, '')
const FAIL = []
const check = (n, ok) => { say(`${ok ? 'PASS' : 'FAIL'} ${n}`); if (!ok) FAIL.push(n) }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9264'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore' })
setTimeout(() => { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 240000)
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9264/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9264')
  let page = null
  for (let i = 0; i < 40 && !page; i++) { const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []; page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300) }
  page.on('pageerror', (e) => say('[pageerror] ' + String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const ev = async (fn) => await Promise.race([page.evaluate(fn), new Promise((r) => setTimeout(() => r(null), 6000))])
  const clickTitle = async (t) => page.evaluate((tt) => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes(tt)); el?.click() }, t)

  // 1 周报
  await clickTitle('纵览'); await wait(1200)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.ov-tab')].find((b) => b.textContent.includes('统计')); el?.click() })
  await wait(2200)
  let weekly = await ev(() => { const b = [...document.querySelectorAll('.st2-chip')].find((x) => x.textContent.includes('本周周报')); if (!b) return null; b.click(); return 'clicked' })
  await wait(900)
  let notice = await ev(() => document.querySelector('.st2-weekly-msg')?.textContent ?? '')
  check('周报：生成并提示', typeof notice === 'string' && notice.length > 0)

  // 2 查重（库内可能有/无重复，验证弹窗打开与列表渲染不崩）
  await page.evaluate(() => { const el = [...document.querySelectorAll('.ov-tab')].find((b) => b.textContent.includes('文献表格')); el?.click() })
  await wait(1200)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.btn')].find((x) => x.textContent.trim() === '查重'); b?.click() })
  await wait(800)
  let dup = await ev(() => ({ open: !!document.querySelector('.modal-pad h2'), text: document.querySelector('.modal-pad')?.textContent?.slice(0, 60) ?? '' }))
  check('查重：弹窗渲染', dup != null && dup.open === true)
  await page.keyboard.press('Escape'); await wait(400)

  // 3 补全元数据按钮存在
  let enrich = await ev(() => [...document.querySelectorAll('.btn')].some((b) => b.textContent.includes('补全元数据')))
  check('补全元数据按钮存在', enrich === true)


  // 5 独立笔记（笔记中心新建）
  await clickTitle('笔记'); await wait(1800)
  let snBtn = await ev(() => [...document.querySelectorAll('.btn')].some((b) => b.textContent.includes('独立笔记')))
  check('独立笔记入口存在', snBtn === true)

  // 6 集合区 + 回收站入口（左栏）
  let sidebar = await ev(() => ({ coll: document.body.textContent.includes('集合'), trash: !!document.querySelector('.lib-trash-btn') }))
  check('左栏集合区 + 回收站入口', sidebar != null && sidebar.coll && sidebar.trash)

  // 7 详情面板行内编辑字段（DOI/卷/期）
  await clickTitle('纵览'); await wait(1000)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.ov-tab')].find((b) => b.textContent.includes('文献表格')); el?.click() })
  await wait(1000)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.top-switch button')].find((x) => x.textContent.includes('Paper')); b?.click() })
  await wait(800)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('阅读')); b?.click() })
  await wait(1200)
  for (let i = 0; i < 10; i++) { if (await page.locator('.pcard').count()) break; await wait(500) }
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await wait(1800)
  let editable = await ev(() => document.querySelectorAll('.pd-edit-input').length)
  check('详情元数据行内编辑 ≥6 字段', typeof editable === 'number' && editable >= 6)

  // 4 便签（阅读器双击）——先回 Paper 阅读模式（卡片墙）再双击
  await page.evaluate(() => { const b = [...document.querySelectorAll('.top-switch button')].find((x) => x.textContent.includes('Paper')); b?.click() })
  await wait(800)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('阅读')); b?.click() })
  await wait(1200)
  for (let i = 0; i < 10; i++) { if (await page.locator('.pcard').count()) break; await wait(500) }
  await page.evaluate(() => { const c = document.querySelector('.pcard'); c?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  await wait(5000)
  const readerAlive = await ev(() => !!document.querySelector('.page-wrap'))
  check('阅读器打开', readerAlive === true)

  say(FAIL.length === 0 ? 'FEATURES-ALL-PASS' : 'FEATURE-FAILURES: ' + FAIL.join(' | '))
} catch (e) { say('ERR ' + String(e).slice(0, 250)) }
finally { try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; setTimeout(() => process.exit(0), 400) }
