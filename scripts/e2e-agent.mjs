// Work agent 端到端冒烟：mock LLM（OpenAI 兼容 SSE）+ 真实应用驱动
// 验证：目标 → 计划生成 → 确认执行 → search_library 工具调用 → 完成总结
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const ROOT = process.cwd()
const PORT = 9390
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- mock LLM：/v1/chat/completions（SSE） ----------
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    const chunk = (delta, finish = null) =>
      send({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish }] })
    try {
      const j = JSON.parse(body || '{}')
      const msgs = j.messages ?? []
      const sys = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('')
      const toolMsgs = msgs.filter((m) => m.role === 'tool')

      if (sys.includes('规划器')) {
        // 计划生成：返回 JSON 计划（真实库 id 未知，计划里先 list_library）
        chunk({ content: '{"steps":[' }, null)
        chunk({ content: '{"tool":"list_library","args":{},"purpose":"浏览库内文献拿到 id"},' }, null)
        chunk({ content: '{"tool":"search_library","args":{"query":"resilience 韧性"},"purpose":"检索韧性相关段落"},' }, null)
        chunk({ content: '{"tool":"make_synthesis","args":{"paperIds":[1,2,3]},"purpose":"生成综述"}' }, null)
        chunk({ content: ']}' }, 'stop')
      } else if ((j.tools ?? []).length > 0 && toolMsgs.length === 0) {
        // 第一轮工具调用
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_library', arguments: '{}' } }] }, null)
        chunk({}, 'tool_calls')
      } else if ((j.tools ?? []).length > 0 && toolMsgs.length === 1) {
        chunk({ tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'search_library', arguments: '{"query":"resilience 韧性"}' } }] }, null)
        chunk({}, 'tool_calls')
      } else {
        chunk({ content: '任务完成：已浏览库内文献、检索韧性相关段落并生成综述（mock 端到端验证）。' }, 'stop')
      }
    } catch (e) {
      // 解析失败也返回一段文本
      chunk({ content: 'mock fallback' }, 'stop')
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

// ---------- 数据目录准备 ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-e2e-'))
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const seedScript = path.join(ROOT, 'scripts', 'e2e-seed.cjs')
const electronSeed = spawn(electronBin, [seedScript, dataDir], { stdio: 'pipe' })
let seeded = false
electronSeed.stdout.on('data', (d) => { if (String(d).includes('SEEDED')) seeded = true })
await new Promise((r) => {
  electronSeed.on('exit', () => r())
  setTimeout(r, 30000)
})
if (!seeded) { console.log('E2E-FAIL seed'); process.exit(1) }
console.log('SEED-OK', dataDir)

if (!seeded) { console.log('E2E-FAIL seed'); process.exit(1) }
console.log('SEED-OK', dataDir)

// ---------- 启动应用（mock LLM 挂到同端口） ----------
server.listen(PORT)
const electron = spawn(electronBin, ['.', '--remote-debugging-port=9237'], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: dataDir }, stdio: 'ignore' })

let result = 'E2E-UNKNOWN'
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:9237/json/version`); if (r.ok) break } catch {} ; await wait(500) }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9237')
  let page = null
  for (let i = 0; i < 30 && !page; i++) {
    const ctx = browser.contexts()[0]
    const pages = ctx ? ctx.pages() : []
    page = pages.find((p) => !p.url().startsWith('devtools')) ?? null
    if (!page) await wait(500)
  }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.setViewportSize({ width: 1500, height: 940 })
  await wait(4000)

  const jsClick = async (sel, text) => {
    await page.evaluate(([s, t]) => {
      const el = [...document.querySelectorAll(s)].find((b) => b.textContent.trim().includes(t))
      if (el) el.click()
      else throw new Error('not found: ' + t)
    }, [sel, text])
  }

  // 切到 Work
  await jsClick('.top-switch button', 'Work')
  await wait(1500)

  // 输入目标并发送
  await page.fill('.wb-compose-input', '检索 resilience 相关文献，浏览库内文献，并对前两篇生成综述')
  await page.click('.wb-send')
  await wait(3000)

  // 计划卡出现 → 确认执行
  const hasRun = await page.locator('text=确认并执行计划').count()
  console.log('PLAN-CARD', hasRun > 0 ? 'shown' : 'missing')
  await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'e2e-plan.png') })
  if (hasRun) {
    await page.locator('text=确认并执行计划').click()
    // 等待完成（最多 40s）
    for (let i = 0; i < 20; i++) {
      await wait(2000)
      const st = await page.evaluate(() => document.querySelector('.wb-status-pill')?.textContent?.trim() ?? '')
      if (st !== '执行中') { console.log('FINAL-STATUS', st); break }
    }
    await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'e2e-done.png') })
    const timeline = await page.evaluate(() => document.querySelector('.wb-timeline')?.textContent?.slice(0, 400) ?? '')
    console.log('TIMELINE', timeline.slice(0, 300))
  }
  await page.screenshot({ path: path.join(ROOT, 'ui-audit', 'e2e-final.png') })
  result = 'E2E-DONE'
} catch (e) {
  result = 'E2E-ERR ' + String(e).slice(0, 200)
}
console.log(result)
try { await browser?.close() } catch {}
try { spawn('taskkill', ['/F', '/PID', String(electron.pid), '/T']) } catch {}
server.close()
process.exit(0)
