// 科研工作台 Agent 内核（v0.9）：基于 Vercel AI SDK（MIT）的工具调用循环。
// 计划-确认-执行：目标 → LLM 产 JSON 计划（chatStream）→ 用户确认 → streamText + tools 自动执行。
// 端点不支持 function calling 时自动降级 ReAct 文本协议。全程事件持久化（agent_tasks 表）可回放。
import fs from 'node:fs'
import path from 'node:path'
import { streamText, tool, stepCountIs, dynamicTool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { presetCaps } from './model-caps-presets'
import { z } from 'zod'
import { getDb, getSettings, listPapers } from './db'
import { chatStream } from './llm'
import { hybridSearch, extractPagesCached } from './ingest'
import { searchAll, matchScript, runWeb, extractDoi, importTranslated } from './translators'
import { synthesizePapers, generateCells, createCompare, saveCompare, listCompare, getMyNotesText, saveMyNotesText, getExtract, extractPaper, knowledgeGraph, topicClusters } from './insight'
import { formatCite } from './csl'
import { listMcpTools, callMcpTool } from './mcp'
import { listSkills, skillBody } from './skills'
import { addPaperTag } from './db'

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
  sid?: number // 流式流 id：同 sid 的 text 事件在 UI 上原地替换（ZCode 式流式输出）
  stream?: boolean
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
  // 流式增量：与上一条事件同 sid 时原地替换（持久化与 UI 都只保留一份，防止刷屏膨胀）
  const last = t.events[t.events.length - 1]
  if (ev.stream && last && last.kind === 'text' && last.sid != null && last.sid === full.sid) {
    t.events[t.events.length - 1] = full
  } else {
    t.events.push(full)
  }
  saveTask(t)
  send('agent:event', { taskId: t.id, event: full, replace: !!(ev.stream && last && last.kind === 'text' && last.sid === full.sid) })
}

function loadTask(id: string): AgentTask | null {
  const r = getDb().prepare('SELECT * FROM agent_tasks WHERE id=?').get(id) as
    | { id: string; goal: string; status: string; plan: string; events: string; answer: string; created_at: string }
    | undefined
  return r ? rowToTask(r) : null
}

// ---------- 计划生成（chatStream，不依赖 function calling） ----------
function mcpToolMenu(): string {
  const ts = listMcpTools()
  if (ts.length === 0) return ''
  const head = '\n外部 MCP 工具（名称需完整使用）：\n'
  return head + ts.map((t) => `${t.fullName} ${t.description ? '— ' + t.description.slice(0, 80) : ''}`).join('\n')
}

function skillMenu(): string {
  const sk = listSkills()
  if (sk.length === 0) return ''
  const head = '\n研究技能（用 use_skill 加载说明书后按流程执行）：\n'
  return head + sk.map((x) => `${x.name} — ${x.description.slice(0, 80)}`).join('\n')
}

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
  const cap = (text: string, limit = 4000): string => {
    budget -= text.length
    if (budget <= 0) return '（观察预算已用尽——请基于已有信息直接总结收尾，不要再调用工具）'
    return text.length > limit ? text.slice(0, limit) + '…（已截断）' : text
  }
  const step = async <T,>(name: string, argsSummary: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    emit(t, { kind: 'status', text: `正在执行 ${name}：${argsSummary}` })
    try {
      const r = await fn()
      const preview = typeof r === 'string' ? r.slice(0, 600) : ''
      const flat = preview.split('\n').join(' ')
      emit(t, { kind: 'step', tool: name, text: argsSummary + (flat ? ' → ' + flat : ''), ok: true, ms: Date.now() - t0 })
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

  const mcp: Record<string, ReturnType<typeof dynamicTool>> = {}
  for (const mt of listMcpTools()) {
    mcp[mt.fullName] = dynamicTool({
      description: `[MCP:${mt.server}] ${mt.description || mt.name}`,
      inputSchema: (mt.inputSchema ?? { type: 'object', properties: {} }) as Parameters<typeof dynamicTool>[0]['inputSchema'],
      execute: async (input: unknown) => {
        const t0 = Date.now()
        emit(t, { kind: 'status', text: `正在执行 ${mt.fullName}` })
        try {
          const out = await callMcpTool(mt.fullName, (input ?? {}) as Record<string, unknown>)
          emit(t, { kind: 'step', tool: mt.fullName, text: 'MCP 调用成功', ok: true, ms: Date.now() - t0 })
          return cap(out)
        } catch (e) {
          emit(t, { kind: 'step', tool: mt.fullName, text: String(e).slice(0, 120), ok: false, ms: Date.now() - t0 })
          return `MCP 调用失败：${String(e).slice(0, 200)}`
        }
      }
    })
  }

  return {
    ...mcp,
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
      description:
        '读取某篇文献。section=structure 返回深度精读结构化字段（研究问题/方法/数据/指标/结果/局限，精读优先用它）；' +
        'section=intro/method/results/conclusion 定位对应章节原文；不填则按页读原文（默认前 8 页）',
      inputSchema: z.object({
        paperId: z.number(),
        pages: z.string().optional().describe('如 "1-3" 或 "5"（与 section 二选一）'),
        section: z.enum(['structure', 'intro', 'method', 'results', 'conclusion']).optional()
      }),
      execute: async ({ paperId, pages, section }) =>
        cap(
          await step('read_paper', `${paperTitle(paperId)} ${section ?? pages ?? ''}`, async () => {
            const p = listPapers().find((x) => x.id === paperId)
            if (!p) throw new Error('论文不存在')
            // 结构化模式：优先取 paper_extract 缓存，没有就现场深度精读（全文 + 8 字段）
            if (section === 'structure') {
              let ext = getExtract(paperId)
              if (!ext) {
                const r = await extractPaper(paperId)
                ext = r.extract
              }
              if (ext) {
                return [
                  `《${p.title}》深度精读：`,
                  `研究问题：${ext.problem}`,
                  `方法路线：${ext.method}`,
                  `数据与对象：${ext.dataset}`,
                  `评价指标：${ext.metrics}`,
                  `核心结果：${ext.results}`,
                  `创新点：${ext.novelty}`,
                  `局限：${ext.limitations}`,
                  `可跟进方向：${ext.future}`
                ].join('\n')
              }
              throw new Error('深度精读失败（检查模型配置）')
            }
            const pages_ = await extractPagesCached(p.path)
            // 章节定位：标题行允许编号前缀（"1. Introduction"、"2.1 实验方法"）
            if (section) {
              const PAT: Record<string, RegExp> = {
                intro: /^([ivx]+\s*\.?\s*)?(\d+(\.\d+)*\s*[.、)]?\s*)?(abstract|introduction|background|背景|引言|绪论|相关工作)/i,
                method: /^(\d+(\.\d+)*\s*[.、)]?\s*)?(method|methodology|approach|实验设计|研究方法|方法|模型)/i,
                results: /^(\d+(\.\d+)*\s*[.、)]?\s*)?(result|experiment|evaluation|实验|结果|分析)/i,
                conclusion: /^(\d+(\.\d+)*\s*[.、)]?\s*)?(conclusion|summary|讨论|结论|总结|展望)/i
              }
              const pat = PAT[section]
              const hits: number[] = []
              pages_.forEach((pg, i) => {
                const head = pg.slice(0, 600)
                for (const line of head.split('\n')) {
                  if (line.length < 60 && pat.test(line.trim())) {
                    hits.push(i)
                    break
                  }
                }
              })
              const start = hits.length > 0 ? hits[0] : section === 'intro' ? 0 : Math.floor(pages_.length * 0.6)
              const end = hits.length > 1 ? hits[1] + 1 : Math.min(pages_.length, start + 4)
              return pages_.slice(start, end).map((pg, i) => `--- 第${start + i + 1}页（${section}） ---\n${pg}`).join('\n')
            }
            const range = pages ? pages.match(/(\d+)\s*-\s*(\d+)/) : null
            if (range) {
              const a = Math.max(1, parseInt(range[1]))
              const b = Math.min(pages_.length, parseInt(range[2]))
              return pages_.slice(a - 1, b).map((pg, i) => `--- 第${a + i}页 ---\n${pg}`).join('\n')
            }
            return pages_.slice(0, 8).map((pg, i) => `--- 第${i + 1}页 ---\n${pg}`).join('\n')
          }),
          8000
        )
    }),
    ask_paper: tool({
      description: '就某篇文献提问并获得带页码引用的回答（自动检索最相关段落 + 首页摘要混合上下文）',
      inputSchema: z.object({ paperId: z.number(), question: z.string() }),
      execute: async ({ paperId, question }) =>
        cap(
          await step('ask_paper', `${paperTitle(paperId)}：${question.slice(0, 40)}`, async () => {
            const p = listPapers().find((x) => x.id === paperId)
            if (!p) throw new Error('论文不存在')
            // 混合上下文：该文献最相关的 16 个检索块（带页码）+ 首两页原文
            const hits = await hybridSearch(question, paperId, 16)
            const evCtx = hits.map((h) => `[p.${h.page}] ${h.snippet}`).join('\n\n')
            const pages = await extractPagesCached(p.path)
            const head = pages.slice(0, 2).join('\n').slice(0, 4000)
            let ans = ''
            for await (const d of chatStream([
              {
                role: 'system',
                content:
                  '基于提供的文献检索证据回答问题，中文。每个论断后标注 [p.页码] 引用；证据不足以回答时明确说"原文未覆盖"。只输出回答。'
              },
              { role: 'user', content: `文献首两页：\n${head}\n\n检索到的相关段落（问题：${question}）：\n${evCtx.slice(0, 30_000)}\n\n问题：${question}` }
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
            // generateCells 只把结果 return 给调用方（不落库）——必须接住并合并保存，
            // 此前直接丢弃导致 agent 汇报成功但表格为空
            const data = listCompare().find((c) => c.id === tb.id)?.data
            const cells = data?.cells ?? {}
            const fields = data?.fields ?? ['作者', '期刊名称']
            for (const pid of paperIds) {
              // generateCells 返回 {维度: CompareCell[]}，合并进 cells[paperId][维度]
              const r = await generateCells(pid, dims, () => {})
              cells[String(pid)] = { ...(cells[String(pid)] ?? {}), ...r }
            }
            await saveCompare(tb.id, {
              paperIds: [...new Set([...(data?.paperIds ?? []), ...paperIds])],
              dimensions: dims,
              fields,
              cells
            })
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
    }),
    add_tag: tool({
      description: '给某篇文献打标签（标签不存在会自动创建）',
      inputSchema: z.object({ paperId: z.number(), tag: z.string() }),
      execute: async ({ paperId, tag }) =>
        cap(
          await step('add_tag', `${paperTitle(paperId)} ← ${tag}`, async () => {
            addPaperTag(paperId, tag)
            return '标签已添加'
          })
        )
    }),
    set_status: tool({
      description: '修改阅读状态：todo(稍后读)/unread(待读)/reading(在读)/read(已读)/paused(暂不读)',
      inputSchema: z.object({ paperId: z.number(), status: z.enum(['todo', 'unread', 'reading', 'read', 'paused']) }),
      execute: async ({ paperId, status }) =>
        cap(
          await step('set_status', `${paperTitle(paperId)} → ${status}`, async () => {
            getDb().prepare('UPDATE papers SET status=? WHERE id=?').run(status, paperId)
            return '状态已更新'
          })
        )
    }),
    ai_annotate: tool({
      description: '把一段 AI 标注/批注追加到文献的 md 笔记（含时间戳）',
      inputSchema: z.object({ paperId: z.number(), text: z.string() }),
      execute: async ({ paperId, text }) =>
        cap(
          await step('ai_annotate', `${paperTitle(paperId)}`, async () => {
            const p = listPapers().find((x) => x.id === paperId)
            if (!p) throw new Error('论文不存在')
            const dir = path.dirname(p.path)
            const mdPath = path.join(dir, `${p.slug}.md`)
            fs.appendFileSync(mdPath, `
## AI 标注（${new Date().toLocaleString('zh-CN')}）

${text}
`)
            return '标注已追加'
          })
        )
    }),
    knowledge_graph: tool({
      description:
        '查看文献库的知识结构：similar 返回语义相似网络（哪几篇内容相近），topics 返回主题聚类（库分几个研究方向、各含哪些论文）。调研类任务先用它建立全局认识',
      inputSchema: z.object({
        view: z.enum(['similar', 'topics']),
        category: z.string().optional().describe('限定分类（不填=全库）')
      }),
      execute: async ({ view, category }) =>
        cap(
          await step('knowledge_graph', `${view}${category ? ' · ' + category : ''}`, async () => {
            if (view === 'topics') {
              const ts = topicClusters(category || undefined)
              if (ts.length === 0) return '暂无主题聚类（文献太少或未建索引）'
              return ts
                .map((t) => `【${t.label}】${t.paperIds.length} 篇 · 关键词：${t.keywords.join('、')}\n  论文：${t.paperIds.join(', ')}`)
                .join('\n')
            }
            const g = knowledgeGraph(category || undefined)
            const deg = new Map<number, number>()
            for (const e of g.edges) {
              deg.set(e.a, (deg.get(e.a) ?? 0) + 1)
              deg.set(e.b, (deg.get(e.b) ?? 0) + 1)
            }
            const hubs = g.nodes
              .map((n) => ({ ...n, d: deg.get(n.id) ?? 0 }))
              .sort((a, b) => b.d - a.d)
              .slice(0, 12)
              .filter((n) => n.d > 0)
            if (hubs.length === 0) return '相似网络为空（文献太少或未建向量索引）'
            return `共 ${g.nodes.length} 篇、${g.edges.length} 条相似边。枢纽文献（相似连接最多）：\n` + hubs
              .map((n) => `#${n.id}《${n.title.slice(0, 50)}》(${n.category}·${n.year ?? ''}) 相连 ${n.d} 篇`)
              .join('\n')
          })
        )
    }),
    use_skill: tool({
      description: '加载一个研究技能的完整说明书（加载后按说明书组合工具执行）。可用技能见系统提示',
      inputSchema: z.object({ name: z.string().describe('技能名') }),
      execute: async ({ name }) =>
        cap(
          await step('use_skill', name, async () => {
            const sk = skillBody(name)
            if (!sk) throw new Error(`技能不存在：${name}（可用：${listSkills().map((x) => x.name).join('、')}）`)
            return `【技能：${sk.name}】说明书如下，请严格按其流程组合工具执行：

${sk.body}`
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
    // 智能体独立模型绑定：设置里可给 agent 配更强模型（缺省回落对话模型）
    const agentModel = s.agentModel || s.model
    // 推理等级（v0.16.2）：等级是模型自带能力——从所选模型的 modelCaps.reasoningLevels
    // 取档位，把设置的思考等级映射到该模型实际的等级词（如 gpt-5: low/high/max），
    // 走 customFetch 改写 body 的 reasoning_effort；无 caps 回落 provider 特定参数
    const lvl = (s.thinkingLevel ?? 'default') as 'default' | 'off' | 'low' | 'medium' | 'high'
    const activeProfile = (s.profiles ?? []).find((pf) => pf.models.includes(agentModel))
    // 预置能力库优先（主流模型已知规格），用户在模型能力卡里编辑过的值覆盖预置
    const capsLevels = activeProfile?.modelCaps?.[agentModel]?.reasoningLevels ?? presetCaps(agentModel)?.reasoningLevels ?? []
    const thinkBody: Record<string, unknown> = {}
    if (capsLevels.length > 0) {
      if (lvl !== 'default') {
        const pick = lvl === 'off' ? capsLevels[0] : capsLevels[Math.min(capsLevels.length - 1, Math.max(0, Math.round((capsLevels.length - 1) * (lvl === 'low' ? 0.25 : lvl === 'medium' ? 0.5 : 0.75))))]
        thinkBody.reasoning_effort = pick
      }
    } else if (lvl !== 'default') {
      const off = lvl === 'off'
      if (s.provider === 'zhipu') thinkBody.thinking = { type: off ? 'disabled' : 'enabled' }
      else if (s.provider === 'qwen') {
        thinkBody.enable_thinking = !off
        if (!off) thinkBody.thinking_budget = lvl === 'high' ? 38912 : lvl === 'medium' ? 8192 : 2048
      } else if (s.provider === 'openai') thinkBody.reasoning_effort = lvl === 'high' ? 'high' : lvl === 'medium' ? 'medium' : 'low'
    }
    const maxSteps = Math.max(4, Math.min(60, s.agentMaxSteps || 24))
    const tools = buildTools(t)
    const planText = t.plan.map((p, i) => `${i + 1}. [${p.tool}] ${p.purpose}（参数：${JSON.stringify(p.args)}）`).join('\n')
    // 库上下文注入：开局告知库里有什么（分类/数量/最近文献），agent 决策更贴合用户实际
    const all = listPapers()
    const catCounts = new Map<string, number>()
    for (const p of all) catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1)
    const libCtx =
      `当前文献库概况：共 ${all.length} 篇。分类：` +
      [...catCounts.entries()].map(([c, n]) => `${c}(${n})`).join('、') +
      '。最近导入：' +
      all
        .slice(0, 5)
        .map((p) => `#${p.id}《${p.title.slice(0, 40)}》`)
        .join('；') +
      '。'
    const provider = createOpenAICompatible({
      name: s.provider || 'cspaper',
      baseURL: s.apiBase,
      apiKey: s.apiKey,
      ...(Object.keys(thinkBody).length
        ? {
            fetch: (async (url: string | URL | undefined, init?: RequestInit) => {
              try {
                if (init?.body) {
                  const body = JSON.parse(String(init.body)) as Record<string, unknown>
                  Object.assign(body, thinkBody)
                  init = { ...init, body: JSON.stringify(body) }
                }
              } catch { /* body 非 JSON 照发 */ }
              return fetch(url as string, init)
            }) as typeof fetch
          }
        : {})
    })
    const result = streamText({
      model: provider(agentModel),
      abortSignal: ac.signal,
      stopWhen: stepCountIs(maxSteps),
      tools,
      onStepFinish: (st) => {
        // 步收尾：该步全文写入当前流块（同 sid 原地替换滚动尾巴），再开新块
        const text = st.text?.trim()
        if (text) {
          lastEmitAt = Date.now()
          emit(t, { kind: 'text', text: text.slice(0, 2000), sid: 100000 + stepsDone, stream: true })
        }
        stepsDone++
        stepText = ''
      },
      system:
        '你是 CSPAPER 科研智能体。严格按照以下已确认的计划逐步执行（每步调用对应工具，参数已给定可直接用；' +
        '若某步失败，调整参数重试一次或跳过并在最后说明）。完成后输出最终总结（做了什么、产物在哪、未尽事项），中文。' +
        (getSettings().agentGoal ? `\n\n用户长期目标（执行始终围绕它，总结末尾说明对该目标的推进）：${getSettings().agentGoal}` : '') +
        '\n\n执行计划：\n' +
        planText +
        '\n\n文献库分类与论文 id 可通过 list_library 查询。',
      messages: [{ role: 'user', content: `任务目标：${t.goal}` }]
    })
    // 消费流：工具循环由 SDK 驱动；文本增量节流 400ms 流式推送（ZCode 式实时输出）
    let stepsDone = 0
    let stepText = ''
    let lastEmitAt = 0
    const flush = (force: boolean): void => {
      if (!stepText.trim()) return
      const now = Date.now()
      if (!force && now - lastEmitAt < 400) return
      lastEmitAt = now
      emit(t, { kind: 'text', text: stepText.slice(-1600), sid: 100000 + stepsDone, stream: true })
    }
    for await (const delta of result.textStream) {
      stepText += delta
      flush(false)
    }
    flush(true)
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
        '你是 CSPAPER 科研智能体。严格按已确认计划执行。每轮只输出以下格式之一：\n' +
        'Thought: 思考\nAction: 工具名\nAction Input: {"参数": "值"}\n或\nFinal Answer: 最终总结\n\n可用工具：\n' +
        TOOL_MENU +
        '\n\n已确认计划：\n' +
        planText
    },
    { role: 'user', content: `任务目标：${t.goal}` }
  ]
  let budget = BUDGET_CHARS
  const agentModel = getSettings().agentModel || getSettings().model
  const maxSteps = Math.max(4, Math.min(60, getSettings().agentMaxSteps || 24))
  for (let i = 0; i < maxSteps && !signal.aborted; i++) {
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
  // 崩溃恢复：上次异常退出的 running 任务标记为 error
  getDb().prepare("UPDATE agent_tasks SET status='error', answer='应用异常退出，任务中断' WHERE status='running'").run()
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