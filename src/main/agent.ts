// 科研工作台 Agent 内核（v0.9）：基于 Vercel AI SDK（MIT）的工具调用循环。
// 计划-确认-执行：目标 → LLM 产 JSON 计划（chatStream）→ 用户确认 → streamText + tools 自动执行。
// 端点不支持 function calling 时自动降级 ReAct 文本协议。全程事件持久化（agent_tasks 表）可回放。
import { streamText, tool, stepCountIs } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { getDb, getSettings, listPapers } from './db'
import { chatStream } from './llm'
import { hybridSearch, extractPagesCached } from './ingest'
import { searchAll, matchScript, runWeb, extractDoi, importTranslated } from './translators'
import { synthesizePapers, generateCells, createCompare, getMyNotesText, saveMyNotesText } from './insight'
import { formatCite } from './csl'

export interface PlanStep {
  tool: string
  args: Record<string, unknown>
  purpose: string
}

export interface AgentEvent {
  t: number
  kind: 'plan' | 'step' | 'text' | 'artifact' | 'done' | 'error' | 'cancelled' | 'status'
  tool?: string
  text?: string
  ok?: boolean
  ms?: number
  artifact?: { kind: string; title: string; paperId?: number; tableId?: number; slug?: string }
}

export interface AgentTask {
  id: string
  goal: string
  status: 'awaiting-confirm' | 'running' | 'done' | 'error' | 'cancelled'
  plan: PlanStep[]
  events: AgentEvent[]
  answer: string
  createdAt: string
}

const MAX_STEPS = 24
const BUDGET_CHARS = 90_000 // 工具观察总量熔断

let send: (ev: string, payload: unknown) => void = () => {}
const running = new Map<string, AbortController>()

// ---------- 持久化 ----------
function ensureTable(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS agent_tasks(
    id TEXT PRIMARY KEY,
    goal TEXT,
    status TEXT,
    plan TEXT DEFAULT '[]',
    events TEXT DEFAULT '[]',
    answer TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );`)
}

function rowToTask(r: { id: string; goal: string; status: string; plan: string; events: string; answer: string; created_at: string }): AgentTask {
  let plan: PlanStep[] = []
  let events: AgentEvent[] = []
  try {
    plan = JSON.parse(r.plan || '[]')
  } catch { /* 旧数据容错 */ }
  try {
    events = JSON.parse(r.events || '[]')
  } catch { /* 容错 */ }
  return { id: r.id, goal: r.goal, status: r.status as AgentTask['status'], plan, events, answer: r.answer, createdAt: r.created_at }
}

function saveTask(t: AgentTask): void {
  // 事件持久化只留最近 240 条（防无限膨胀），完整流以 UI 会话内为准
  const events = t.events.slice(-240)
  getDb()
    .prepare(
      `INSERT INTO agent_tasks(id, goal, status, plan, events, answer, created_at)
       VALUES(?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, plan=excluded.plan, events=excluded.events, answer=excluded.answer`
    )
    .run(t.id, t.goal, t.status, JSON.stringify(t.plan), JSON.stringify(events), t.answer)
}

function emit(t: AgentTask, ev: Omit<AgentEvent, 't'>): void {
  const full: AgentEvent = { t: Date.now(), ...ev }
  t.events.push(full)
  saveTask(t)
  send('agent:event', { taskId: t.id, event: full })
}

function loadTask(id: string): AgentTask | null {
  const r = getDb().prepare('SELECT * FROM agent_tasks WHERE id=?').get(id) as
    | { id: string; goal: string; status: string; plan: string; events: string; answer: string; created_at: string }
    | undefined
  return r ? rowToTask(r) : null
}

// ---------- 计划生成（chatStream，不依赖 function calling） ----------
const TOOL_MENU = [
  'search_papers {query} — 联网检索学术文献（Crossref/OpenAlex/arXiv）',
  'search_library {query, category?} — 在本地文献库全文+向量检索',
  'list_library {category?, tag?, status?, limit?} — 列出库内文献',
  'import_paper {url} — 从网页/DOI/arXiv 链接抓取题录（含 PDF）并入库',
  'read_paper {paperId, pages?} — 读取某篇文献的文本内容（pages 如 "1-3"）',
  'ask_paper {paperId, question} — 就某篇文献提问（基于全文回答）',
  'write_note {paperId, text} — 向文献的「我的笔记」追加内容',
  'make_synthesis {paperIds} — 对多篇文献生成中文综述（存入 AI 知识库）',
  'compare_papers {paperIds, dimensions?} — 生成多文献对比表',
  'cite_format {paperIds, style?} — 生成参考文献列表'
].join('\n')

export async function planTask(goal: string): Promise<AgentTask> {
  ensureTable()
  const id = `t${Date.now()}${Math.floor(Math.random() * 1000)}`
  const t: AgentTask = { id, goal, status: 'awaiting-confirm', plan: [], events: [], answer: '', createdAt: new Date().toISOString() }
  let raw = ''
  for await (const d of chatStream([
    {
      role: 'system',
      content:
        '你是科研工作流的规划器。根据用户目标，产出一个 JSON 执行计划。可用工具及参数：\n' +
        TOOL_MENU +
        '\n\n只输出 JSON：{"steps":[{"tool":"工具名","args":{...},"purpose":"这一步做什么"}]}，步骤 3-10 步，' +
        '顺序合理（先检索/读文献，后综合/写笔记）。不要输出任何其他内容。'
    },
    { role: 'user', content: goal }
  ])) {
    raw += d
  }
  try {
    const json = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, '').trim())
    t.plan = (json.steps ?? []).filter((st: PlanStep) => st && st.tool).slice(0, 12)
  } catch {
    t.plan = []
    t.events.push({ t: Date.now(), kind: 'error', text: '计划解析失败：' + raw.slice(0, 200) })
  }
  t.status = t.plan.length ? 'awaiting-confirm' : 'error'
  emit(t, { kind: 'plan', text: JSON.stringify(t.plan) })
  saveTask(t)
  return t
}

export function updatePlan(id: string, plan: PlanStep[]): AgentTask | null {
  ensureTable()
  const t = loadTask(id)
  if (!t) return null
  t.plan = plan
  saveTask(t)
  return t
}

// ---------- 工具集（映射既有能力） ----------
function buildTools(t: AgentTask) {
  let budget = BUDGET_CHARS
  const cap = (text: string): string => {
    budget -= text.length
    if (budget <= 0) return '（观察预算已用尽——请基于已有信息直接总结收尾，不要再调用工具）'
    return text.length > 4000 ? text.slice(0, 4000) + '…（已截断）' : text
  }
  const step = async <T,>(name: string, argsSummary: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    emit(t, { kind: 'status', text: `正在执行 ${name}：${argsSummary}` })
    try {
      const r = await fn()
      emit(t, { kind: 'step', tool: name, text: argsSummary, ok: true, ms: Date.now() - t0 })
      return r
    } catch (e) {
      emit(t, { kind: 'step', tool: name, text: argsSummary, ok: false, ms: Date.now() - t0 })
      throw e
    }
  }
  const paperTitle = (id: number): string => {
    const p = listPapers().find((x) => x.id === id)
    return p?.title ?? `#${id}`
  }
  const recordArtifact = (a: AgentEvent['artifact']): void => {
    emit(t, { kind: 'artifact', artifact: a, text: a?.title })
  }

  return {
    search_papers: tool({
      description: '联网检索学术文献（Crossref/OpenAlex 等），返回题录列表',
      inputSchema: z.object({ query: z.string().describe('检索词：标题/关键词/DOI') }),
      execute: async ({ query }) =>
        cap(
          await step('search_papers', query, async () => {
            const hits = await searchAll(query)
            return (
              hits
                .slice(0, 10)
                .map(
                  (h, i) =>
                    `${i + 1}. ${h.title} | ${String(h.author ?? '')} | DOI:${String(h.DOI ?? '')} | URL:${String(h.URL ?? '')}`
                )
                .join('\n') || '（无结果）'
            )
          })
        )
    }),
    search_library: tool({
      description: '在本地文献库做全文+向量混合检索，返回相关段落与论文',
      inputSchema: z.object({ query: z.string(), category: z.string().optional() }),
      execute: async ({ query, category }) =>
        cap(
          await step('search_library', query, async () => {
            const rs = await hybridSearch(query, undefined, 10, category || undefined)
            return rs.map((r) => `《${r.title}》p.${r.page}：${r.snippet.slice(0, 160)}`).join('\n') || '（无结果）'
          })
        )
    }),
    list_library: tool({
      description: '列出库内文献（可按分类/标签/状态过滤）',
      inputSchema: z.object({ category: z.string().optional(), tag: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }),
      execute: async ({ category, tag, status, limit }) =>
        cap(
          await step('list_library', `${category ?? ''}${tag ?? ''}${status ?? ''}`, async () => {
            let ps = listPapers()
            if (category) ps = ps.filter((p) => p.category === category)
            if (tag) ps = ps.filter((p) => (p.tags ?? []).includes(tag))
            if (status) ps = ps.filter((p) => p.status === status)
            return ps.slice(0, limit ?? 20).map((p) => `#${p.id} 《${p.title}》 ${p.authors} ${p.year ?? ''} [${p.category}]`).join('\n') || '（无匹配）'
          })
        )
    }),
    import_paper: tool({
      description: '从网页/DOI/arXiv 链接抓取题录（含 PDF）并加入文献库',
      inputSchema: z.object({ url: z.string().describe('https 链接、DOI 或 arXiv 链接') }),
      execute: async ({ url }) =>
        cap(
          await step('import_paper', url, async () => {
            let target = url
            if (!/^https?:\/\//i.test(target)) {
              const doi = extractDoi(target)
              if (!doi) throw new Error('不是有效链接或 DOI')
              target = `https://doi.org/${doi}`
            }
            const s = matchScript(target)
            if (!s) throw new Error('没有匹配的抓取脚本')
            const r = await runWeb(s, target)
            if (!r.ok || !r.csl) throw new Error(r.error ?? '抓取失败')
            const imp = await importTranslated({ csl: r.csl, pdfPath: r.pdfPath, origin: target }, () => {})
            if (!imp.ok) throw new Error(imp.error ?? '入库失败')
            recordArtifact({ kind: 'paper', title: String((r.csl as { title?: string }).title ?? ''), slug: imp.slug })
            return `已入库：${imp.slug}`
          })
        )
    }),
    read_paper: tool({
      description: '读取某篇文献的文本内容（默认前 6 页）',
      inputSchema: z.object({ paperId: z.number(), pages: z.string().optional().describe('如 "1-3" 或 "5"') }),
      execute: async ({ paperId, pages }) =>
        cap(
          await step('read_paper', `${paperTitle(paperId)} ${pages ?? ''}`, async () => {
            const p = listPapers().find((x) => x.id === paperId)
            if (!p) throw new Error('论文不存在')
            const pages_ = await extractPagesCached(p.path)
            const range = pages ? pages.match(/(\d+)\s*-\s*(\d+)/) : null
            if (range) {
              const a = Math.max(1, parseInt(range[1]))
              const b = Math.min(pages_.length, parseInt(range[2]))
              return pages_.slice(a - 1, b).map((pg, i) => `--- 第${a + i}页 ---\n${pg}`).join('\n')
            }
            return pages_.slice(0, 6).map((pg, i) => `--- 第${i + 1}页 ---\n${pg}`).join('\n')
          })
        )
    }),
    ask_paper: tool({
      description: '就某篇文献的全文内容提问并获得回答',
      inputSchema: z.object({ paperId: z.number(), question: z.string() }),
      execute: async ({ paperId, question }) =>
        cap(
          await step('ask_paper', `${paperTitle(paperId)}：${question.slice(0, 40)}`, async () => {
            const p = listPapers().find((x) => x.id === paperId)
            if (!p) throw new Error('论文不存在')
            const pages = await extractPagesCached(p.path)
            const ctx = pages.join('\n').slice(0, 60_000)
            let ans = ''
            for await (const d of chatStream([
              { role: 'system', content: '基于提供的论文全文回答问题，中文，引用内容标注页码。只输出回答。' },
              { role: 'user', content: `论文全文：\n${ctx}\n\n问题：${question}` }
            ])) {
              ans += d
            }
            return ans
          })
        )
    }),
    write_note: tool({
      description: '向某篇文献的「我的笔记」追加内容',
      inputSchema: z.object({ paperId: z.number(), text: z.string() }),
      execute: async ({ paperId, text }) =>
        cap(
          await step('write_note', `${paperTitle(paperId)}（${text.length} 字）`, async () => {
            const cur = await getMyNotesText(paperId)
            await saveMyNotesText(paperId, (cur ? cur + '\n\n' : '') + text)
            recordArtifact({ kind: 'note', title: `笔记写入《${paperTitle(paperId)}》`, paperId })
            return '笔记已写入'
          })
        )
    }),
    make_synthesis: tool({
      description: '对多篇文献生成中文综合综述（自动存入 AI 知识库分类）',
      inputSchema: z.object({ paperIds: z.array(z.number()).describe('至少 2 篇') }),
      execute: async ({ paperIds }) =>
        cap(
          await step('make_synthesis', `${paperIds.length} 篇`, async () => {
            const r = await synthesizePapers(paperIds, () => {})
            recordArtifact({ kind: 'synthesis', title: r.title, slug: r.slug })
            return `综述已生成：《${r.title}》（slug: ${r.slug}，已存入 AI 知识库）`
          })
        )
    }),
    compare_papers: tool({
      description: '生成多文献对比表（默认维度：研究方法/数据与实验/核心结论）',
      inputSchema: z.object({ paperIds: z.array(z.number()), dimensions: z.array(z.string()).optional() }),
      execute: async ({ paperIds, dimensions }) =>
        cap(
          await step('compare_papers', `${paperIds.length} 篇`, async () => {
            const tb = await createCompare()
            const dims = dimensions && dimensions.length ? dimensions : ['研究方法', '数据与实验', '核心结论']
            for (const pid of paperIds) await generateCells(pid, dims, () => {})
            recordArtifact({ kind: 'table', title: `对比表 #${tb.id}`, tableId: tb.id })
            return `对比表已生成（id: ${tb.id}），维度：${dims.join('/')}`
          })
        )
    }),
    cite_format: tool({
      description: '生成参考文献列表（默认 GB/T 7714）',
      inputSchema: z.object({ paperIds: z.array(z.number()), style: z.string().optional() }),
      execute: async ({ paperIds, style }) =>
        cap(
          await step('cite_format', `${paperIds.length} 条`, async () => {
            const r = await formatCite(paperIds, style || 'gbt7714-num')
            if (!r.ok) throw new Error(r.error ?? '格式化失败')
            return (r.items ?? []).join('\n')
          })
        )
    })
  }
}

// ---------- 执行（streamText 多步工具循环） ----------
export async function runTask(id: string): Promise<{ ok: boolean; error?: string }> {
  ensureTable()
  const t = loadTask(id)
  if (!t) return { ok: false, error: '任务不存在' }
  if (t.status === 'running') return { ok: false, error: '任务正在执行中' }
  const s = getSettings()
  if (!s.apiKey) return { ok: false, error: '请先在设置里配置模型（工作台需要 LLM）' }

  t.status = 'running'
  emit(t, { kind: 'status', text: '开始执行' })
  const ac = new AbortController()
  running.set(id, ac)

  try {
    const provider = createOpenAICompatible({ name: s.provider || 'cspaper', baseURL: s.apiBase, apiKey: s.apiKey })
    const tools = buildTools(t)
    const planText = t.plan.map((p, i) => `${i + 1}. [${p.tool}] ${p.purpose}（参数：${JSON.stringify(p.args)}）`).join('\n')
    const result = streamText({
      model: provider(s.model),
      abortSignal: ac.signal,
      stopWhen: stepCountIs(MAX_STEPS),
      tools,
      onStepFinish: (st) => {
        const text = st.text?.trim()
        if (text) emit(t, { kind: 'text', text: text.slice(0, 2000) })
      },
      system:
        '你是 CSPAPER 科研工作台的执行代理。严格按照以下已确认的计划逐步执行（每步调用对应工具，参数已给定可直接用；' +
        '若某步失败，调整参数重试一次或跳过并在最后说明）。完成后输出最终总结（做了什么、产物在哪、未尽事项），中文。\n\n执行计划：\n' +
        planText +
        '\n\n文献库分类与论文 id 可通过 list_library 查询。',
      messages: [{ role: 'user', content: `任务目标：${t.goal}` }]
    })
    // 消费流（工具循环由 SDK 驱动）
    for await (const _ of result.textStream) {
      /* 文本增量已在 onStepFinish 汇总，这里仅驱动流 */
    }
    const answer = await result.text
    t.answer = answer
    t.status = 'done'
    emit(t, { kind: 'done', text: answer.slice(0, 4000) })
    return { ok: true }
  } catch (err) {
    const msg = String(err)
    // function calling 不支持时降级 ReAct 文本协议
    if (/tool|function|unsupported|400/i.test(msg) && !ac.signal.aborted) {
      try {
        const answer = await reactFallback(t, ac.signal)
        t.answer = answer
        t.status = 'done'
        emit(t, { kind: 'done', text: answer.slice(0, 4000) })
        return { ok: true }
      } catch (e2) {
        t.status = ac.signal.aborted ? 'cancelled' : 'error'
        emit(t, { kind: ac.signal.aborted ? 'cancelled' : 'error', text: String(e2).slice(0, 300) })
        return { ok: false, error: String(e2) }
      }
    }
    t.status = ac.signal.aborted ? 'cancelled' : 'error'
    emit(t, { kind: ac.signal.aborted ? 'cancelled' : 'error', text: msg.slice(0, 300) })
    return { ok: false, error: msg }
  } finally {
    running.delete(id)
    saveTask(t)
  }
}

// ---------- ReAct 文本协议兜底（端点不支持 tools 时） ----------
interface ReActStep {
  action: string
  input: Record<string, unknown>
}
function parseReAct(text: string): { action?: ReActStep; final?: string } {
  const finalM = text.match(/Final Answer:\s*([\s\S]+)/)
  if (finalM) return { final: finalM[1].trim() }
  const am = text.match(/Action:\s*(\w+)/)
  const im = text.match(/Action Input:\s*([\s\S]*?)(?:\nObservation:|$)/)
  if (am && im) {
    try {
      return { action: { action: am[1], input: JSON.parse(im[1].trim().replace(/^```json\s*|```\s*$/g, '')) } }
    } catch {
      return { action: { action: am[1], input: { query: im[1].trim().slice(0, 120) } } }
    }
  }
  return { final: text.trim().slice(0, 2000) }
}

async function reactFallback(t: AgentTask, signal: AbortSignal): Promise<string> {
  const s = getSettings()
  const tools = buildTools(t)
  const planText = t.plan.map((p, i) => `${i + 1}. [${p.tool}] ${p.purpose}（参数：${JSON.stringify(p.args)}）`).join('\n')
  const history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        '你是科研执行代理。严格按已确认计划执行。每轮只输出以下格式之一：\n' +
        'Thought: 思考\nAction: 工具名\nAction Input: {"参数": "值"}\n或\nFinal Answer: 最终总结\n\n可用工具：\n' +
        TOOL_MENU +
        '\n\n已确认计划：\n' +
        planText
    },
    { role: 'user', content: `任务目标：${t.goal}` }
  ]
  let budget = BUDGET_CHARS
  for (let i = 0; i < MAX_STEPS && !signal.aborted; i++) {
    let out = ''
    for await (const d of chatStream(history)) out += d
    const { action, final } = parseReAct(out)
    if (final || !action) return final ?? out
    history.push({ role: 'assistant', content: out })
    const fn = (tools as unknown as Record<string, { execute: (input: unknown, opts: unknown) => Promise<string> }>)[action.action]
    let observation: string
    if (!fn) observation = `未知工具 ${action.action}，可用：${Object.keys(tools).join(', ')}`
    else {
      try {
        // 动态调用 zod 工具的 execute（ReAct 路径输入由 LLM 给出，此处不做 schema 强校验）
        observation = String(await fn.execute(action.input, { toolCallId: `react-${i}`, messages: [] }))
      } catch (e) {
        observation = `工具执行失败：${String(e).slice(0, 200)}`
      }
    }
    budget -= observation.length
    if (budget <= 0) observation = '（观察预算已用尽，请直接给出 Final Answer）'
    emit(t, { kind: 'step', tool: action.action, text: JSON.stringify(action.input).slice(0, 120), ok: !observation.startsWith('工具执行失败') })
    history.push({ role: 'user', content: `Observation: ${observation.slice(0, 3500)}` })
  }
  return '已达步数上限，请缩小任务范围后重试。'
}

// ---------- 查询与取消 ----------
export function cancelTask(id: string): boolean {
  const ac = running.get(id)
  if (ac) {
    ac.abort()
    return true
  }
  const t = loadTask(id)
  if (t && t.status === 'running') {
    t.status = 'cancelled'
    saveTask(t)
  }
  return false
}

export function listTasks(): Array<Pick<AgentTask, 'id' | 'goal' | 'status' | 'createdAt' | 'answer'>> {
  ensureTable()
  return (
    getDb()
      .prepare('SELECT id, goal, status, plan, events, answer, created_at FROM agent_tasks ORDER BY created_at DESC LIMIT 50')
      .all()
      .map((r) => rowToTask(r as never))
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ id, goal, status, createdAt, answer }) => ({ id, goal, status, createdAt, answer }))
  )
}

export function getTask(id: string): AgentTask | null {
  ensureTable()
  return loadTask(id)
}

export function setNotifier(fn: (ev: string, payload: unknown) => void): void {
  send = fn
}
