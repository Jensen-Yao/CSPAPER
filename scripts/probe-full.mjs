// 全面巡检：斜杠命令 / 全视图切换 / 详情分区 / pageerror 收集
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'ui-audit', 'probe-full.log')
const say = (m) => { const l = `${new Date().toISOString().slice(11, 23)} ${m}`; fs.appendFileSync(OUT, l + '\n'); console.log(l) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
fs.writeFileSync(OUT, '')
const FAIL = []
const check = (name, ok) => { say(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) FAIL.push(name) }

const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--remote-debugging-port=9248'], {
  cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }, stdio: 'ignore'
})
setTimeout(() => { say('HARD-TIMEOUT'); try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}; process.exit(2) }, 180000)
// 该探针不动用户配置：测试库 F:/tmp/cspaper-data 有自己的 settings（避免动用户库）

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9248/json/version'); if (r.ok) break } catch {}; await wait(400) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9248')
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    const ctx = browser.contexts()[0]; const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => /index\.html/.test(p.url())) ?? null; if (!page) await wait(300)
  }
  page.on('pageerror', (e) => say('[pageerror] ' + String(e).slice(0, 250)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)
  const ev = async (fn) => await Promise.race([page.evaluate(fn), new Promise((r) => setTimeout(() => r(null), 5000))])
  const jsClick = async (sel, text) => {
    await page.evaluate(([s, t]) => {
      const el = [...document.querySelectorAll(s)].find((b) => (b.textContent || '').trim().includes(t) || (b.getAttribute('title') || '').includes(t))
      if (el) el.click(); else throw new Error('not found: ' + t)
    }, [sel, text])
  }

  // ---------- Work 斜杠命令 ----------
  await jsClick('.top-switch button', 'Work')
  await wait(1200)
  await page.fill('.wb-compose-input', '/')
  await wait(500)
  let n = await ev(() => document.querySelectorAll('.wb-slash-item').length)
  check('slash: 菜单弹出条数>5', n != null && n > 5)

  await page.fill('.wb-compose-input', '/deep high')
  await page.keyboard.press('Enter')
  await wait(600)
  let pill = await ev(() => [...document.querySelectorAll('.wb-pill')].map((b) => b.textContent.trim()).join('|'))
  check('slash: /deep high 生效(深度=高)', pill != null && /高/.test(pill))

  await page.fill('.wb-compose-input', '/goal 测试长期目标ABC')
  await page.keyboard.press('Enter')
  await wait(800)
  let heroGoal = await ev(() => document.querySelector('.wb-hero-goal')?.textContent ?? '')
  check('slash: /goal 显示在 hero', heroGoal != null && heroGoal.includes('ABC'))

  await page.fill('.wb-compose-input', '/tpl 精读')
  await page.keyboard.press('Enter')
  await wait(500)
  let v = await ev(() => document.querySelector('.wb-compose-input')?.value ?? '')
  check('slash: /tpl 填充模板', v != null && v.includes('精读'))

  await page.fill('.wb-compose-input', '/help')
  await page.keyboard.press('Enter')
  await wait(500)
  let notice = await ev(() => document.querySelector('.wb-notice')?.textContent ?? '')
  check('slash: /help notice', notice != null && notice.includes('/plan'))

  await page.fill('.wb-compose-input', '/skills')
  await page.keyboard.press('Enter')
  await wait(800)
  let skillPane = await ev(() => document.querySelector('.wb-pane-head')?.textContent ?? '')
  check('slash: /skills 跳面板', skillPane != null && skillPane.includes('技能'))
  await jsClick('.wb-nav-item', '新建任务')
  await wait(400)

  // ---------- 详情面板 ----------
  await jsClick('.top-switch button', 'Paper')
  await wait(1200)
  await page.locator('.pcard').first().click().catch(() => {})
  await wait(1500)
  let secs = await ev(() => [...document.querySelectorAll('.pd-sec-title')].map((x) => x.textContent.trim()))
  check('detail: 分区齐全(10)', secs != null && secs.length >= 10 && secs.includes('深度解读') && secs.includes('相关文献'))
  let sc = await ev(() => { const el = document.querySelector('.pd-scroll'); if (!el) return null; el.scrollTop = el.scrollHeight; return { c: el.clientHeight, s: el.scrollHeight, a: el.scrollTop } })
  check('detail: 可滚到底', sc != null && sc.s > sc.c && sc.a > 0)
  await page.evaluate(() => document.querySelector('.pd-x')?.click())
  await wait(400)

  // ---------- 知识 5 子视图（逐个防卡死） ----------
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes('纵览')); el?.click() })
  await wait(1500)
  await jsClick('.ov-tab', '知识')
  await wait(2000)
  for (const t of ['相似网络', '关键词共现', '作者合作', '主题星系', '知识库']) {
    await jsClick('.kv-chip', t).catch(() => {})
    await wait(1800)
    const alive = await Promise.race([ev(() => true), new Promise((r) => setTimeout(() => r(false), 4000))])
    check(`knowledge: ${t} 不卡死`, alive === true)
  }

  // ---------- 统计 / 笔记 / 网页 ----------
  await jsClick('.ov-tab', '统计').catch(() => {})
  await wait(2000)
  let stats = await ev(() => document.body.textContent.includes('词云') || document.body.textContent.includes('阅读'))
  check('stats: 统计视图渲染', stats === true)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes('笔记')); el?.click() })
  await wait(1500)
  let notesOk = await ev(() => !!document.querySelector('.note-list') || document.body.textContent.includes('笔记'))
  check('notes: 笔记视图', notesOk === true)
  await page.evaluate(() => { const el = [...document.querySelectorAll('.tb-q')].find((b) => (b.getAttribute('title') || '').includes('网页')); el?.click() })
  await wait(2000)
  let webOk = await ev(() => document.body.textContent.includes('检索') || document.body.textContent.includes('站点'))
  check('web: 网页视图', webOk === true)

  // ---------- 对话斜杠 ----------
  await jsClick('.top-switch button', 'Paper').catch(() => {})
  await wait(500)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.mode-toggle button')].find((x) => x.textContent.includes('对话')); b?.click() })
  await wait(1200)
  const chatTa = page.locator('.hero-textarea, .chat-view-input textarea').first()
  if (await chatTa.count()) {
    await chatTa.fill('/help')
    await chatTa.press('Enter')
    await wait(600)
    let cn = await ev(() => document.querySelector('.wb-notice')?.textContent ?? '')
    check('chat: /help 命令', cn != null && cn.length > 3)
  } else check('chat: 输入框存在', false)

  say(FAIL.length === 0 ? 'ALL-PASS' : 'FAILURES: ' + FAIL.join(' | '))
} catch (e) {
  say('PROBE-ERR ' + String(e).slice(0, 300))
} finally {
  try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
  setTimeout(() => process.exit(0), 400)
}
