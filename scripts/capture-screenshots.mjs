// 生成 README / GitHub Pages 使用的真实产品截图。
// 流程：reportlab 示例论文 → 隔离数据目录 + mock 模型服务 → 启动真实 Electron 构建 →
//      注入示例项目 / 任务 / 日程 / 笔记 / 专注记录 → 逐视图截图 → 转成 WebP。
// 不读取用户的真实文献库、设置或 API Key。截图中的文献、作者与模型输出均为演示数据。
// 依赖：npm run build 已完成；Python 3 + reportlab + Pillow。
// 用法：node scripts/capture-screenshots.mjs
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs', 'screenshots')
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-shots-'))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-shots-data-'))
const LIB = path.join(TMP, 'library')
const DATA = path.join(TMP, 'data')
const WIDTH = 1440
const HEIGHT = 900
const SCALE = 2
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => console.log('[shots] ' + message)
for (const dir of [OUT, DATA]) fs.mkdirSync(dir, { recursive: true })
execFileSync('python', [path.join(ROOT, 'scripts/fixtures/demo_papers.py'), LIB], { stdio: 'ignore' })
log('示例论文已生成')

// ---------- mock 模型服务：只返回演示内容，不代表任何真实模型 ----------
const DIMENSIONS = ['研究问题', '方法', '核心结论']
const state = { paperIds: [] }
const STOP = new Set(['the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'have', 'has', 'was', 'were', 'will', 'can', 'its', 'their', 'than', 'then', 'when', 'what', 'which', 'how', 'why', 'not', 'but', 'all', 'any', 'into', 'over', 'between', 'based', 'using', 'used', 'each', 'per'])
function vector(text) {
  const dims = new Array(32).fill(0)
  for (const word of String(text).toLowerCase().match(/[a-z][a-z-]{2,}/g) || []) {
    if (STOP.has(word)) continue
    let hash = 0
    for (let i = 0; i < word.length; i++) hash = (hash * 31 + word.charCodeAt(i)) >>> 0
    dims[hash % 32] += 1
  }
  const norm = Math.sqrt(dims.reduce((sum, value) => sum + value * value, 0)) || 1
  return dims.map(value => Number((value / norm).toFixed(6)))
}

const RAG_ANSWER = `## 结论

轨迹审计（trajectory audit）能减少不可核实的断言，关键在于它把**每一次工具调用的参数、观察结果与模型状态**都保留下来，使失败可复现、结论可追溯 [1]。

| 维度 | 无审计 | 有轨迹审计 |
| --- | --- | --- |
| 任务成功率 | 57.4% | 68.9% |
| 注入错误后的恢复率 | 29% | 78% |
| 最弱与最强智能体差距 | 52 点 | 14 点 |

**要点**

1. 统一协议固定了工具 schema 与制品级成功判定；环境噪声被控制后，报告中的提升缩水约 38% [1]。
2. 复用过期观察（stale observation）的智能体在多步任务上失败率翻倍；先验证再复用可从 78% 的注入错误中恢复 [1]。
3. 句级忠实度测量显示，不受支持的断言主要来自多跳组合，而不是检索失败 [2]。

**局限**

轨迹日志只保证“可复现”，并不自动保证结论正确；仍需要人工核对或自校验环节来确认证据 [3]。`

const PAPER_ANSWER = `这篇论文用统一协议重新评测了 9 个开源工具智能体，核心发现有三点：

1. **控制环境噪声后，提升明显缩水**：最强与最弱开源智能体之间的差距从 52 个百分点收窄到 14 个百分点 [1]。
2. **恢复行为比工具选择更能区分智能体**：先验证观察再复用的智能体可从 78% 的注入错误中恢复，直接沿用过期状态的只有 29% [1]。
3. **轨迹日志解释了大部分剩余方差**：复用过期观察的智能体在多步任务上失败率翻倍 [1]。

**实验设置**：420 个任务、8 个工具，并以 10% 的概率注入工具错误；成功由制品的 schema 有效性、断言支持度与完整性三项独立检查判定 [1]。`

const EXPLAIN_ANSWER = '这段话说明：在统一协议下，真正拉开差距的是工具出错后的恢复行为。先验证观察是否仍然有效、再决定是否复用的智能体，能从 78% 的注入错误中恢复；直接沿用过期状态的智能体只有 29%。写综述时可以把它归入“可审计性”一节，并与引用忠实度的测量方法对照。'

const REPORT = `## 已完成

已检索文献库并锁定与“轨迹审计”直接相关的三篇论文，生成对比表 1 份，并为两篇文献追加了阅读笔记。

## 真实产物

- 对比表：轨迹审计三篇核心文献（3 篇 × 3 个维度）
- 笔记：已写入 Tool-Augmented Language Agents 与 Citation Faithfulness 的「我的笔记」

## 关键结论

1. 统一协议后，最强与最弱开源智能体的差距从 52 个百分点收窄到 14 个百分点。
2. 先验证观察再复用的智能体可从 78% 的注入错误中恢复，直接沿用过期状态的只有 29%。
3. 不受支持的断言主要来自多跳组合；句级忠实度在 61%–88% 之间。

## 后续建议

- 打开对比表核对“恢复率”一行，补上 Human-in-the-Loop Approval 的数据。
- 第 2 节可以先写引用忠实度的测量方法，再回到轨迹审计。`

const CELLS = {
  'Tool-Augmented': {
    研究问题: [{ t: '开源工具智能体的报告成绩在统一协议下还剩多少', p: 1 }],
    方法: [{ t: '固定工具 schema、制品级成功判定、完整轨迹日志', p: 1 }, { t: '420 个任务，注入 10% 工具错误测试恢复能力', p: 1 }],
    核心结论: [{ t: '最强与最弱智能体差距从 52 收窄到 14 个百分点', p: 1 }, { t: '先验证再复用的智能体可从 78% 的注入错误中恢复', p: 1 }]
  },
  'Citation Faithfulness': {
    研究问题: [{ t: '被引用的片段是否真的支持这句话', p: 1 }],
    方法: [{ t: '标注最小支持片段，区分检索失败与归因失败', p: 1 }, { t: '4,200 条断言，六个系统，两种评测模式', p: 1 }],
    核心结论: [{ t: '句级忠实度 61%–88%；给 oracle 候选集后为 74%–91%', p: 1 }, { t: '两跳断言的忠实度降到 58%', p: 1 }]
  },
  'Trajector': {
    研究问题: [{ t: '工具结果被丢弃后，智能体失败为何难以复现', p: 1 }],
    方法: [{ t: '只追加的轨迹日志：调用、参数、观察与模型状态', p: 1 }],
    核心结论: [{ t: '重放 600 条轨迹可精确复现 94% 的已报告失败', p: 1 }, { t: '31% 的错误来自跨步骤复用的过期观察', p: 1 }]
  }
}

function plannerSteps(goal) {
  const [a, b, c] = state.paperIds
  if (goal.includes('对比表')) {
    return { steps: [
      { id: 'search', tool: 'library.search', args: { query: 'trajectory audit tool use', limit: 3 }, purpose: '检索轨迹审计相关文献', risk: 'read' },
      { id: 'compare', tool: 'comparison.create', args: { paperIds: [a, b, c], dimensions: DIMENSIONS }, purpose: '生成三篇核心文献的对比表', risk: 'reversible_write' },
      { id: 'note-a', tool: 'note.append', args: { paperId: a, text: '## 轨迹审计要点\n\n- 统一协议后，开源智能体差距收窄到 14 个点。\n- 复用过期观察会让多步任务失败率翻倍。' }, purpose: '记录轨迹审计结论', risk: 'reversible_write' },
      { id: 'note-b', tool: 'note.append', args: { paperId: b, text: '## 引用忠实度要点\n\n- 句级忠实度 61%–88%；无支持断言主要来自多跳组合。' }, purpose: '记录引用忠实度结论', risk: 'reversible_write' }
    ] }
  }
  return { steps: [{ id: 'search', tool: 'library.search', args: { query: 'citation faithfulness', limit: 3 }, purpose: '检索相关文献', risk: 'read' }] }
}

const TRANSLATIONS = [
  ['Language agents that call external tools now handle literature search', '调用外部工具的语言智能体如今已能处理文献检索、表格抽取与报告起草。'],
  ['Grounded generation promises answers that can be checked', '接地生成承诺给出可以被核实的答案，但这个承诺的兑现程度取决于断言与证据之间的联系。'],
  ['Research assistants that draft claims, tables and conclusions need an approval step', '负责起草论断、表格与结论的研究助手，在输出进入稿件之前需要一道人工审批。']
]

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', part => { raw += part })
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    if (req.url === '/api/embed') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ embeddings: (body.input || []).map(vector) }))
      return
    }
    const messages = body.messages || []
    const sys = messages.filter(item => item.role === 'system').map(item => item.content).join('\n')
    const user = messages.filter(item => item.role === 'user').map(item => typeof item.content === 'string' ? item.content : '').join('\n')
    // 只看最后一轮提问：多轮历史里也会出现“核心发现”等词
    const question = String((([...messages].reverse().find(item => item.role === 'user') || {}).content) || '')
    const plannerText = String((([...messages].reverse().find(item => item.role === 'user') || {}).content) || '')
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'demo', object: 'chat.completion', model: 'demo-model', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'demo', object: 'chat.completion.chunk', model: 'demo-model', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n')
    const complete = text => {
      for (const piece of text.match(/[\s\S]{1,28}/g) || []) chunk({ content: piece })
      chunk({}, 'stop')
      res.end('data: [DONE]\n\n')
    }
    if (sys.includes('科研任务规划器')) complete(JSON.stringify(plannerSteps(plannerText)))
    else if (sys.includes('科研执行代理')) complete(REPORT)
    else if (sys.includes('维度名')) {
      const key = Object.keys(CELLS).find(title => sys.includes(title))
      const dimensions = JSON.parse(sys.match(/维度列表：(\[[^\]]+\])/)[1])
      complete(JSON.stringify(Object.fromEntries(dimensions.map(name => [name, CELLS[key]?.[name] || [{ t: '该维度在正文中未单独展开', p: 1 }]]))))
    } else if (sys.includes('学术翻译引擎')) {
      const known = TRANSLATIONS.find(([source]) => user.includes(source))
      complete(known ? known[1] : '这段内容讨论的是：在统一评测协议下，智能体的恢复行为比工具选择更能区分强弱。')
    } else if (sys.includes('电力电子与 AI')) complete(EXPLAIN_ANSWER)
    else if (sys.includes('完整正文')) complete(PAPER_ANSWER)
    else if (sys.includes('检索到的文献片段')) complete(RAG_ANSWER)
    else if (/核心发现|恢复实验/.test(question)) complete(PAPER_ANSWER)
    else complete(RAG_ANSWER)
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const mockBase = 'http://127.0.0.1:' + server.address().port
log('mock 模型服务 ' + mockBase)

// ---------- 预置设置：指向示例库与 mock 服务 ----------
const seedFile = path.join(TMP, 'seed.cjs')
fs.writeFileSync(seedFile, `const { app } = require('electron')
const path = require('path')
app.whenReady().then(() => {
  const dataDir = process.argv[2]
  app.setPath('userData', dataDir)
  const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
  const db = new Database(path.join(dataDir, 'cspaper.db'))
  db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);')
  const profile = { id: 'profile-demo', provider: 'custom', apiBase: ${JSON.stringify(mockBase + '/v1')}, apiKey: 'demo-key', models: ['demo-model'], modelCaps: { 'demo-model': { reasoningLevels: ['default', 'low', 'medium', 'high', 'xhigh'], caps: ['json', 'system'], toolCalling: true } } }
  const settings = { setupDone: true, libraryPath: ${JSON.stringify(LIB.replace(/\\/g, '/'))}, apiBase: ${JSON.stringify(mockBase + '/v1')}, apiKey: 'demo-key', model: 'demo-model', provider: 'custom', agentModel: 'demo-model', agentMaxSteps: 12, profiles: [profile], embedProvider: 'ollama', ollamaUrl: ${JSON.stringify(mockBase)}, translateTarget: '中文', theme: 'light' }
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('settings',?)").run(JSON.stringify(settings))
  console.log('SEEDED')
  app.exit(0)
})`)
const seed = spawn(electronPath(), [seedFile, DATA], { cwd: ROOT, stdio: 'ignore', windowsHide: true })
await new Promise((resolve, reject) => { seed.on('exit', code => code === 0 ? resolve() : reject(new Error('seed failed ' + code))) })
function electronPath() { return path.join(ROOT, 'node_modules/electron/dist/electron.exe') }

const portServer = http.createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const debugPort = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const debugUrl = 'http://127.0.0.1:' + debugPort
let proc = spawn(electronPath(), ['.', `--remote-debugging-port=${debugPort}`], { cwd: ROOT, env: { ...process.env, CSPAPER_DATA_DIR: DATA }, stdio: 'ignore', windowsHide: true })
let browser
// 2x 截图：CDP clip.scale 让合成器按 2 倍像素重新光栅化，文字更清晰
let capture = null
const shot = async (page, name) => {
  const { data } = await capture('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE }, captureBeyondViewport: false })
  fs.writeFileSync(path.join(RAW, name + '.png'), Buffer.from(data, 'base64'))
  log('截图 ' + name)
}
const attempt = async (page, name, run) => {
  try { await run() } catch (error) {
    log('步骤失败 ' + name + '：' + String(error.message || error).split('\n')[0])
    await page.screenshot({ path: path.join(RAW, 'fail-' + name + '.png') }).catch(() => {})
  }
}
const nav = async (page, title) => { await page.locator(`.workspace-nav .tb-q[title="${title}"]`).click(); await wait(500) }

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(debugUrl + '/json/version')).ok) break } catch {} await wait(250) }
  browser = await chromium.connectOverCDP(debugUrl)
  let page
  for (let i = 0; i < 80 && !page; i++) { page = browser.contexts()[0]?.pages().find(item => item.url().includes('index.html')); if (!page) await wait(250) }
  if (!page) throw new Error('No application page')
  page.on('pageerror', error => console.log('PAGEERROR ' + String(error)))
  await page.setViewportSize({ width: WIDTH, height: HEIGHT })
  capture = (method, params) => page.context().newCDPSession(page).then(session => session.send(method, params))
  await page.waitForSelector('.workspace-nav', { timeout: 30000 })

  // 等待后台索引完成
  for (let i = 0; i < 240; i++) {
    const status = await page.evaluate(() => window.api.indexStatus())
    if (!status.running && status.papers >= 9 && status.indexed >= status.papers) break
    await wait(250)
  }
  const papers = await page.evaluate(() => window.api.listPapers())
  const idOf = slug => papers.find(item => item.slug === slug)?.id
  state.paperIds = [idOf('2025-tool-augmented-agents'), idOf('2025-citation-faithfulness'), idOf('2025-trajectory-audits')]
  log('文献 ' + papers.length + ' 篇，索引 ' + JSON.stringify(await page.evaluate(() => window.api.indexStatus())))

  // ---------- 注入示例项目 / 任务 / 日程 / 笔记 / 专注记录 ----------
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const dates = { d9: day(-9), d6: day(-6), d1: day(-1), d0: day(0), d1p: day(1), d2: day(2), d3: day(3), d4: day(4), d5: day(5), d6: day(6), d12: day(12) }
  const times = Object.fromEntries([95, 70, 65, 60, 42].map(minutes => [minutes, new Date(Date.now() - minutes * 60000).toISOString()]))
  await page.evaluate(async ({ dates, times, ids }) => {
    const p1 = await window.api.projectsSave({ name: '综述：工具调用智能体的可靠性评估', description: '为综述收集证据：轨迹审计、引用忠实度、人机审批三条线。', color: '#9e3b2f', status: 'active', dueDate: dates.d12 })
    const p2 = await window.api.projectsSave({ name: '组会汇报：检索增强生成的引用问题', description: '10 分钟汇报，重点讲清楚句级忠实度怎么测。', color: '#1558c0', status: 'active', dueDate: dates.d5 })
    await window.api.projectsSave({ name: '开题材料准备', description: '研究问题、创新点与时间表。', color: '#5a7256', status: 'paused', dueDate: null })
    const task = (projectId, title, notes, status, priority, dueDate, paperId = null) => window.api.tasksSave({ projectId, title, notes, status, priority, dueDate, paperId, conversationId: null })
    await task(p1.id, '读完轨迹审计相关的三篇核心文献', '重点看第 3 节的恢复实验。', 'todo', 'high', dates.d0, ids['2025-tool-augmented-agents'])
    await task(p1.id, '整理对比表：审计前后的恢复率', '从三篇论文的表 1 抽数据。', 'todo', 'medium', dates.d2)
    await task(p1.id, '写综述第 2 节：引用忠实度的测量方法', '先区分检索失败与归因失败。', 'doing', 'high', dates.d1)
    await task(p1.id, '核对句级标注的一致性数据', 'Castellanos 等报告标注一致性 0.81。', 'doing', 'low', dates.d4)
    await task(p1.id, '确定综述的检索式与纳入标准', '已导入 Zotero 分类的 105 条题录。', 'done', 'medium', dates.d6)
    await task(p1.id, '回复导师关于实验设计的邮件', '', 'done', 'high', dates.d9)
    await task(p2.id, '画一张引用错误类型的示意图', '检索失败 vs 归因失败。', 'todo', 'medium', dates.d6)
    await task(p2.id, '准备 10 分钟汇报提纲', '带上句级忠实度的对比表。', 'doing', 'high', dates.d1p)
    const event = (title, date, kind, startTime, endTime, notes) => window.api.calendarSave({ title, date, kind, startTime, endTime, notes, completed: false, conversationId: null })
    await event('晨间阅读：轨迹审计', dates.d0, 'task', '09:30', '10:00', 'Tool-Augmented Language Agents 第 3–4 节')
    await event('组会：综述进度同步', dates.d0, 'meeting', '14:00', '15:00', '带对比表草稿')
    await event('投稿摘要截止', dates.d0, 'deadline', null, null, '')
    await event('与导师讨论开题方向', dates.d3, 'meeting', '10:00', '11:00', '')
    await event('综述初稿截止', dates.d12, 'deadline', null, null, '')
    const note = (title, body) => window.api.standaloneNotesSave(null, title, body)
    await note('开题思路：把轨迹审计作为切入点', '## 核心主张\n\n与其追求更强的规划能力，不如先把智能体的每一步工具调用记录成可重放的轨迹。\n\n## 三条证据线\n\n1. 轨迹审计让失败可复现（Tool-Augmented Language Agents）\n2. 句级引用忠实度把“引用存在”变成“引用支持结论”\n3. 人工审批把证据片段放到断言旁边，错误检出率从 54% 升到 81%\n\n## 下一步\n\n- [ ] 读 Human-in-the-Loop Approval 的界面实验\n- [ ] 整理恢复率对比表')
    await note('组会问题清单', '- 审计日志的存储开销有多大？\n- 如果工具本身返回错误结果，轨迹审计还能发现问题吗？\n- 句级忠实度的标注成本能否用模型辅助降低？')
    await note('待读：self-verification 的成本分析', '自校验把无支持引用从 18.4% 降到 6.9%，推理成本 +14%。需要确认这个成本是否随摘要长度线性增长。')
    await note('实验设计草稿', '| 条件 | 审计 | 自校验 | 样本 |\n| --- | --- | --- | --- |\n| A | 否 | 否 | 200 |\n| B | 是 | 否 | 200 |\n| C | 是 | 是 | 200 |')
    await window.api.focusLog({ paperId: ids['2025-tool-augmented-agents'], phase: 'reading', seconds: 25 * 60, startedAt: times[95], endedAt: times[70] })
    await window.api.focusLog({ paperId: ids['2025-citation-faithfulness'], phase: 'short_break', seconds: 5 * 60, startedAt: times[70], endedAt: times[65] })
    await window.api.focusLog({ paperId: ids['2025-citation-faithfulness'], phase: 'reading', seconds: 18 * 60, startedAt: times[60], endedAt: times[42] })
    await window.api.myNotesSave(ids['2025-trajectory-audits'], '## 一句话\n\n把每一次工具调用的参数、观察和模型状态写成只追加的日志，失败就能被精确重放。\n\n## 可引用数字\n\n- 重放 600 条轨迹，精确复现 94% 的已报告失败。\n- 31% 的错误来自跨步骤复用的过期观察。\n\n## 与综述的关系\n\n对应“可审计性”小节的第一段。')
  }, { dates, times, ids: Object.fromEntries(papers.map(item => [item.slug, item.id])) })
  log('示例项目 / 任务 / 日程 / 笔记已写入')

  // ---------- 文献库 ----------
  await nav(page, '文献库')
  await page.waitForSelector('.pcard', { timeout: 15000 })
  await wait(1800)
  await shot(page, 'library')

  // ---------- 阅读器：划词高亮 + 侧栏问答 ----------
  const resetWindowScroll = () => page.evaluate(() => { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0 })
  const scrollOwnerToTop = selector => page.evaluate(selector => {
    const first = document.querySelector(selector)
    let el = first
    while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement
    if (el) el.scrollTop = 0
  }, selector)
  const openPaper = async title => {
    // 文献卡：单击看详情，双击进入阅读
    await page.locator('.pcard').filter({ hasText: title }).first().dblclick()
    await page.waitForSelector('.reader-surface:not(.pane-hidden) .textLayer', { timeout: 20000 })
    await wait(900)
  }
  const highlight = async (phrase, color) => {
    const found = await page.evaluate(phrase => {
      const walker = document.createTreeWalker(document.querySelector('.reader-surface') ?? document.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !((node.nodeValue ?? '').includes(phrase) && node.parentElement?.offsetHeight)) node = walker.nextNode()
      if (!node?.parentElement) return false
      node.parentElement.scrollIntoView({ block: 'center' })
      // scrollIntoView 会连带滚动窗口，这里把窗口拉回顶部
      window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0
      const range = document.createRange()
      range.selectNodeContents(node.parentElement)
      const selection = getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.querySelector('.viewer-scroll')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      return true
    }, phrase)
    if (!found) { log('未找到可划词文本：' + phrase); return }
    await page.waitForSelector('.float-bar', { timeout: 5000 })
    await page.locator('.float-bar .fbdot.' + color).click()
    await wait(500)
  }
  await openPaper('Tool-Augmented Language Agents')
  await highlight('Trajectory audits explain', 'yellow')
  await highlight('test recovery', 'green')
  // 缩小两档让整页进入视野，文档回到页首
  const zoomOut = page.locator('.reader-surface button').filter({ hasText: /^−$/ }).first()
  await zoomOut.click().catch(() => {}); await wait(400)
  await zoomOut.click().catch(() => {}); await wait(600)
  await page.locator('.side-rail button[title="问答"]').click()
  await page.waitForSelector('.side .chat-input', { timeout: 10000 })
  await wait(400)
  await page.locator('.side .chat-input').fill('这篇论文的核心发现是什么？恢复实验是怎么设计的？')
  await page.locator('.side .send-btn').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.side .msg.assistant .bubble')].some(el => el.textContent.includes('实验设置')), null, { timeout: 30000 })
  await wait(1500)
  await scrollOwnerToTop('.side .msg.user')
  await page.evaluate(() => { const scroller = document.querySelector('.viewer-scroll'); if (scroller) scroller.scrollTop = 0 })
  await resetWindowScroll()
  await wait(400)
  await shot(page, 'reader')

  // 阅读专注：读文献时的番茄钟与提醒
  await page.locator('.reading-focus-toggle').click()
  await page.waitForSelector('.reading-focus-panel', { timeout: 5000 })
  const startButton = page.locator('.reading-focus-panel button').filter({ hasText: /开始|专注/ }).first()
  if (await startButton.count()) await startButton.click()
  await wait(700)
  await resetWindowScroll()
  await shot(page, 'focus')
  await page.locator('.reading-focus-toggle').click()

  await page.locator('.reader-surface button[title="下一页"]').click()
  await wait(900)
  await page.locator('.reader-surface .tab .x').click()
  await wait(600)
  await openPaper('Citation Faithfulness')
  await page.locator('.reader-surface button[title="下一页"]').click()
  await wait(700)
  await page.locator('.reader-surface .tab .x').click()
  await wait(600)
  for (const [slug, status] of [['2024-planning-under-uncertainty', 'reading'], ['2026-self-verification', 'todo'], ['2025-tool-robustness-benchmark', 'todo'], ['2024-human-in-the-loop-approval', 'unread'], ['2026-cost-aware-retrieval', 'read']]) {
    await page.evaluate(([id, next]) => window.api.setStatus(id, next), [idOf(slug), status])
  }
  // 阅读位置与阅读状态写回后重新载入窗口，界面才会拿到最新数据
  await page.reload()
  await page.waitForSelector('.workspace-nav', { timeout: 30000 })
  await wait(1500)

  // ---------- 研究台 ----------
  await nav(page, '研究台')
  await page.waitForSelector('.research-hub .rh-paper', { timeout: 15000 })
  await wait(1200)
  await shot(page, 'hub')

  // ---------- 文献问答 ----------
  await nav(page, '与文献库对话')
  await page.locator('.chat-conversations header button').click(); await wait(500)
  await page.locator('.chat-wrap .hero-textarea').fill('轨迹审计（trajectory audit）如何降低不可核实的断言？和引用忠实度有什么关系？')
  await page.locator('.chat-wrap .send-btn').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.chat-wrap .msg.assistant .bubble')].some(el => el.textContent.includes('局限')), null, { timeout: 20000 }).catch(async error => {
    log('对话未完成：' + (await page.evaluate(() => (document.querySelector('.chat-wrap')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))))
    throw error
  })
  await wait(1500)
  await scrollOwnerToTop('.chat-wrap .msg.user')
  await wait(300)
  await shot(page, 'chat')

  // ---------- Work：规划 → 工具 → 报告 ----------
  await page.locator('.top-switch button').filter({ hasText: 'Work' }).click()
  await wait(500)
  await page.locator('.wb-nav-item').filter({ hasText: '新建任务' }).first().click()
  await page.locator('.wb-compose-input').fill('帮我梳理轨迹审计如何降低不可核实的断言，生成三篇核心文献的对比表并保存笔记')
  await page.locator('.wb-send[title="创建任务"]').click()
  const goalNeedle = '生成三篇核心文献的对比表并保存笔记'
  for (let i = 0; i < 240; i++) {
    const done = await page.evaluate(async needle => {
      const page = await window.api.chat.listConversations({ limit: 10 })
      const conversation = page.items.find(item => item.title.includes(needle) || item.title.includes('轨迹审计'))
      if (!conversation) return false
      const loaded = await window.api.chat.loadMessages({ conversationId: conversation.id, limit: 40 })
      const runs = await Promise.all(loaded.items.filter(item => item.runId).map(item => window.api.chat.getRun(item.runId)))
      return runs.length > 0 && runs.every(item => ['completed', 'partial', 'failed', 'cancelled'].includes(item.run?.status))
    }, goalNeedle)
    if (done) break
    await wait(500)
  }
  await wait(1500)
  // 展开执行计划，回到对话顶部
  await page.evaluate(() => { document.querySelectorAll('details.chat-plan').forEach(el => { el.open = true }) })
  await wait(500)
  await scrollOwnerToTop('.msg.user')
  await resetWindowScroll()
  await wait(400)
  await shot(page, 'work')

  // 项目看板与今日
  await page.locator('.wb-nav-item').filter({ hasText: '项目' }).click(); await wait(600)
  await page.locator('.project-row').filter({ hasText: '综述' }).click(); await wait(500)
  await page.waitForSelector('.task-card', { timeout: 10000 }).catch(async error => {
    log('项目看板未出现：' + (await page.evaluate(() => (document.querySelector('.projects-pane')?.innerText || document.querySelector('.wb-center')?.innerText || '').replace(/\s+/g, ' ').slice(0, 400))))
    throw error
  })
  await wait(800)
  await shot(page, 'projects')
  await page.locator('.wb-nav-item').filter({ hasText: '今日' }).click()
  await wait(900)
  await shot(page, 'today')

  // 深色主题
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await wait(600)
  await page.locator('.wb-nav-item').filter({ hasText: '新建任务' }).first().click(); await wait(400)
  await page.locator('.wb-history .wb-hist-row').first().click()
  await wait(900)
  await page.evaluate(() => { document.querySelectorAll('details.chat-plan').forEach(el => { el.open = true }) })
  await scrollOwnerToTop('.msg.user')
  await resetWindowScroll()
  await wait(400)
  await shot(page, 'work-dark')
  await page.locator('.top-switch button').filter({ hasText: 'Paper' }).click()
  await nav(page, '研究台')
  await wait(900)
  await shot(page, 'hub-dark')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await wait(500)

  // ---------- 对比表 ----------
  // 清掉空白对比表（对比视图首次打开时会自动建一张），只展示有内容的表
  for (const table of await page.evaluate(() => window.api.compareList())) {
    if (!(table.data?.paperIds ?? []).length) await page.evaluate(id => window.api.compareDelete(id), table.id)
  }
  const comparisons = (await page.evaluate(() => window.api.compareList())).filter(table => (table.data?.paperIds ?? []).length)
  if (comparisons.length) {
    await page.evaluate(id => { window.dispatchEvent(new CustomEvent('cspaper:workspace-action', { detail: { kind: 'artifact', artifact: { kind: 'comparison', entityId: String(id), title: '对比表', slug: 'comparison', tableId: Number(id) } } })) }, comparisons[0].id)
    await page.waitForSelector('.cmp-scroll .cmp-table tbody tr', { timeout: 15000 })
    // 收起文献侧栏，让对比表占满宽度
    await page.locator('.icon-btn.tb-toggle').click().catch(() => {})
    await wait(1200)
    await shot(page, 'compare')
  }

  // ---------- 笔记中心 / 纵览 ----------
  await nav(page, '笔记中心')
  await page.waitForSelector('.notes-view', { timeout: 10000 })
  await wait(1200)
  await shot(page, 'notes')
  await nav(page, '纵览（文献表格 / 知识体系 / 统计）')
  await wait(1500)
  await shot(page, 'overview')
} finally {
  if (browser) await browser.close().catch(() => {})
  spawn('taskkill', ['/F', '/PID', String(proc.pid), '/T'], { stdio: 'ignore', windowsHide: true })
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
execFileSync('python', [path.join(ROOT, 'scripts/fixtures/optimize_shots.py'), RAW, OUT], { stdio: 'inherit' })
log('完成：' + OUT)