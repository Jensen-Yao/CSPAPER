// 科研智能体工作台（v0.12）：布局逐项对标 ZCode ——
// 左栏（新建任务/搜索/自动化/技能/插件市场 + 相对时间历史 + 底部用户区），
// 中央文档流（用户消息气泡 + 「已工作 X 分 X 秒」折叠条 + 可展开工具行 + 悬浮回底 + 右下操作排），
// 底部合成器（＋模板 / 权限 / 模型 / 深度 / 发送·停止，执行中输入自动排队）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper } from './types'
import * as Icon from './Icon'
import { isCommandInput, filterSlash, parseSlash, SLASH_CMDS, TPL_ALIASES, DEEP_ALIAS, type SlashCmd } from './slash'
import './wb.css'

interface PlanStep {
  tool: string
  args: Record<string, unknown>
  purpose: string
}
interface AgentEvent {
  t: number
  kind: 'plan' | 'step' | 'text' | 'artifact' | 'done' | 'error' | 'cancelled' | 'status'
  tool?: string
  text?: string
  ok?: boolean
  ms?: number
  sid?: number
  stream?: boolean
  artifact?: { kind: string; title: string; paperId?: number; tableId?: number; slug?: string }
}
interface TaskSummary {
  id: string
  goal: string
  status: 'awaiting-confirm' | 'running' | 'done' | 'error' | 'cancelled'
  createdAt: string
  answer: string
}
interface TaskFull extends TaskSummary {
  plan: PlanStep[]
  events: AgentEvent[]
}

interface Props {
  visible: boolean
  papers: Paper[]
  models: string[]
  onOpenPaper: (p: Paper) => void
  onOpenCompare: () => void
  onOpenNotes: () => void
  onOpenSettings: () => void
}

const TEMPLATES: Array<{ label: string; desc: string; goal: string }> = [
  { label: '主题调研', desc: '检索 → 筛选导入 → 中文综述', goal: '调研主题：「」。检索相关文献，筛选最相关的 5-8 篇导入文献库，阅读后生成一篇中文综述（存入 AI 知识库）。' },
  { label: '精读论文', desc: '全文阅读 → 结构化精读笔记', goal: '精读库内一篇文献（用 list_library 找到并告诉我 id）：阅读全文，写结构化精读笔记（研究问题/方法/结论/局限/启发）写入我的笔记，最后给出 3 个值得追问的问题。' },
  { label: '多文对比', desc: '方法/数据/结论 三维对比表', goal: '对比库内同一分类下的多篇文献：生成方法/数据/结论三维度对比表，并写 300 字对比结论。' },
  { label: '睡眠日报', desc: '技能：定时文献日报', goal: '执行「睡眠科研日报」技能：按库内关键词检索最新文献，相关性排序，产出今日日报并存入 AI 知识库。' },
  { label: '深度调研', desc: '知识网络→检索→逐篇精读→补检索→综述', goal: '深度调研主题：「」。步骤：1) 用 knowledge_graph 的 topics 视图了解库内研究结构；2) search_papers 检索该主题最新文献并导入 5-8 篇；3) 用 read_paper 的 section=structure 逐篇深度精读；4) 针对精读中发现的信息缺口补一轮检索；5) 用 make_synthesis 生成中文综述（1000 字以上，带文献编号引用），存入 AI 知识库。' }
]

const STATUS_META: Record<string, { label: string; cls: string }> = {
  'awaiting-confirm': { label: '待确认计划', cls: 'pending' },
  running: { label: '执行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  error: { label: '出错', cls: 'error' },
  cancelled: { label: '已中止', cls: 'error' }
}

const EFFORTS: Array<{ label: string; steps: number }> = [
  { label: '低', steps: 8 },
  { label: '中', steps: 16 },
  { label: '高', steps: 24 },
  { label: '最高', steps: 48 }
]

const TOOL_LABEL: Record<string, string> = {
  search_papers: '联网检索', search_library: '库内检索', import_paper: '导入文献', read_paper: '阅读全文',
  ask_paper: '文献问答', write_note: '写笔记', make_synthesis: '写综述', compare_papers: '对比',
  cite_format: '引文格式', add_tag: '打标签', set_status: '设状态', ai_annotate: 'AI 标注',
  use_skill: '加载技能', arxiv_recent: 'arXiv 最新', knowledge_graph: '知识网络', related_papers: '相关文献',
  list_library: '浏览文献库'
}

function dateGroupOf(createdAt: string): string {
  const d = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z')
  const now = new Date()
  const day = 86400000
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startToday) return '今天'
  if (d.getTime() >= startToday - day) return '昨天'
  if (d.getTime() >= startToday - 7 * day) return '近 7 天'
  return '更早'
}
// ZCode 式相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期
function relTime(createdAt: string): string {
  const d = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(d)) return ''
  const diff = Date.now() - d
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const dt = new Date(d)
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}
function fmtWorked(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
// 计划进度：把 step 事件按顺序匹配到计划步骤
function planProgress(plan: PlanStep[], events: AgentEvent[]): Array<{ step: PlanStep; done: boolean }> {
  const done = plan.map(() => false)
  let pi = 0
  for (const ev of events) {
    if (ev.kind !== 'step' || !ev.tool) continue
    while (pi < plan.length && plan[pi].tool !== ev.tool) pi++
    if (pi < plan.length) {
      done[pi] = true
      pi++
    }
  }
  return plan.map((step, i) => ({ step, done: done[i] }))
}
// 已工作时长：工具步耗时合计 + （执行中时）最近事件到现在的时段
function workedMsOf(task: TaskFull, now: number): number {
  let ms = 0
  for (const ev of task.events) if (ev.kind === 'step' && ev.ms) ms += ev.ms
  if (task.status === 'running' && task.events.length > 0) {
    const lastT = task.events[task.events.length - 1].t
    ms += Math.max(0, now - lastT)
  }
  return ms
}

export default function WorkbenchView({ visible, papers, models, onOpenPaper, onOpenCompare, onOpenNotes, onOpenSettings }: Props): JSX.Element | null {
  const [nav, setNav] = useState<'tasks' | 'skills' | 'auto' | 'mcp'>('tasks')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskFull | null>(null)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editPlan, setEditPlan] = useState<PlanStep[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [queue, setQueue] = useState<string[]>([])
  const queueRef = useRef<string[]>([])
  const [perm, setPerm] = useState<'auto' | 'confirm'>(() => (localStorage.getItem('wb.perm') === 'confirm' ? 'confirm' : 'auto'))
  const [effort, setEffort] = useState<number>(24)
  const [agentModel, setAgentModel] = useState<string>('')
  const [pop, setPop] = useState<'' | 'tpl' | 'model' | 'effort' | 'perm'>('')
  const [slashSel, setSlashSel] = useState(0)
  const [goalLong, setGoalLong] = useState('')
  const [notice, setNotice] = useState('')
  const [wide, setWide] = useState(false)
  const [openStep, setOpenStep] = useState<number | null>(null)
  const [workOpen, setWorkOpen] = useState(true)
  const [atBottom, setAtBottom] = useState(true)
  const [, setTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const autoScroll = useRef(true)
  const launchRef = useRef<(g: string) => void>(() => {})

  const refreshTasks = (): void => {
    void window.api.agentTasks().then((ts) => setTasks(ts as unknown as TaskSummary[])).catch(() => {})
  }
  type ApiEvent = Parameters<Parameters<typeof window.api.onAgentEvent>[0]>[0]['event']
  const loadTask = (id: string, ev?: ApiEvent): void => {
    // 流式增量：同 sid 的 text 事件直接原地改本地状态（不重新拉全量，保证流式手感）
    if (ev && ev.stream && ev.sid != null && task && task.id === id) {
      setTask((cur) => {
        if (!cur) return cur
        const arr = [...cur.events] as AgentEvent[]
        const li = arr.length - 1
        const incoming = ev as unknown as AgentEvent
        if (li >= 0 && arr[li].kind === 'text' && arr[li].sid === incoming.sid) arr[li] = incoming
        else arr.push(incoming)
        return { ...cur, events: arr }
      })
      return
    }
    void window.api
      .agentTask(id)
      .then((t0) => {
        const t = t0 as unknown as TaskFull | null
        setTask(t)
        setEditPlan(t && t.status === 'awaiting-confirm' ? t.plan : null)
      })
      .catch(() => {})
  }

  // 初始化：读设置里的 agent 模型 / 深度
  useEffect(() => {
    if (!visible) return
    void window.api
      .getSettings()
      .then((s) => {
        const st = s as { agentModel?: string; agentMaxSteps?: number; agentGoal?: string }
        if (st.agentModel) setAgentModel(st.agentModel)
        if (st.agentMaxSteps) setEffort(st.agentMaxSteps)
        if (st.agentGoal) setGoalLong(st.agentGoal)
      })
      .catch(() => {})
  }, [visible])

  useEffect(() => {
    if (!visible) return
    refreshTasks()
    return window.api.onAgentEvent(({ taskId, event, replace }) => {
      if (taskId === selId && event && replace) loadTask(taskId, event)
      else if (taskId === selId) loadTask(taskId)
      refreshTasks()
      // 排队调度：任一任务终结且队列非空 → 自动启动下一个
      const fin = event && (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled')
      if (fin && queueRef.current.length > 0) {
        const next = queueRef.current[0]
        queueRef.current = queueRef.current.slice(1)
        setQueue(queueRef.current)
        setTimeout(() => launchRef.current(next), 500)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selId])

  // 执行中每秒刷新「已工作」时长
  useEffect(() => {
    if (task?.status !== 'running') return
    const h = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(h)
  }, [task?.status])

  useEffect(() => {
    const el = scrollRef.current
    if (el && autoScroll.current) el.scrollTop = el.scrollHeight
  }, [task?.events.length, task?.events[task.events.length - 1]?.text])

  // 快捷键：Ctrl/Cmd+N 新任务；Esc 关弹层
  useEffect(() => {
    if (!visible) return
    const h = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setSelId(null)
        setTask(null)
        setNav('tasks')
        setTimeout(() => inputRef.current?.focus(), 30)
      }
      if (e.key === 'Escape') setPop('')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [visible])

  const launch = (g: string): void => {
    void (async () => {
      setBusy(true)
      setErr('')
      try {
        const t = await window.api.agentPlan(g)
        const auto = perm === 'auto'
        setSelId(t.id)
        setTask({ ...(t as unknown as TaskFull), plan: t.plan })
        setEditPlan(auto ? null : t.plan)
        setNav('tasks')
        if (auto) {
          await window.api.agentRun(t.id)
          loadTask(t.id)
        }
        refreshTasks()
      } catch (e) {
        setErr(String(e).slice(0, 160))
      } finally {
        setBusy(false)
      }
    })()
  }
  launchRef.current = launch

  const flash = (msg: string): void => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2600)
  }

  /** 斜杠命令执行：返回 true 表示已消费（不作为任务发送） */
  const execSlash = (raw: string): boolean => {
    const p = parseSlash(raw)
    if (!p) return false
    const { name, args } = p
    if (name === 'plan' || name === 'auto') {
      if (!args) {
        flash('用法：/' + name + ' 目标描述（如 /plan 调研固态电池热管理）')
        return true
      }
      setPerm(name === 'auto' ? 'auto' : 'confirm')
      localStorage.setItem('wb.perm', name === 'auto' ? 'auto' : 'confirm')
      setGoal('')
      launch(args)
      return true
    }
    if (name === 'goal') {
      if (!args) {
        // 无参清除目标
        void window.api.saveSettings({ agentGoal: '' })
        setGoalLong('')
        flash('已清除长期目标')
        return true
      }
      void window.api.saveSettings({ agentGoal: args })
      setGoalLong(args)
      flash('长期目标已设定：' + args.slice(0, 60) + '（/goal 无参清除）')
      setGoal('')
      return true
    }
    if (name === 'model') {
      const hit = models.find((m) => m.toLowerCase().includes((args || '').toLowerCase()))
      if (!hit) {
        flash(args ? `没有匹配「${args}」的模型，可用：${models.join('、')}` : '用法：/model 关键词（如 /model glm）')
        return true
      }
      void window.api.saveSettings({ agentModel: hit })
      setAgentModel(hit)
      flash('模型已切换：' + hit)
      setGoal('')
      return true
    }
    if (name === 'deep') {
      const n = DEEP_ALIAS[(args || '').toLowerCase()]
      if (!n) {
        flash('用法：/deep low|mid|high|max（8/16/24/48 步）')
        return true
      }
      setEffort(n)
      void window.api.saveSettings({ agentMaxSteps: n })
      flash(`执行深度：${args}（最多 ${n} 步）`)
      setGoal('')
      return true
    }
    if (name === 'tpl') {
      const label = TPL_ALIASES[args] ?? args
      const tp = TEMPLATES.find((t) => t.label === label)
      if (!tp) {
        flash('可用模板：' + TEMPLATES.map((t) => t.label).join(' / '))
        return true
      }
      setGoal(tp.goal)
      inputRef.current?.focus()
      flash('已套用模板「' + tp.label + '」，补充目标后回车发送')
      return true
    }
    if (name === 'new') {
      setSelId(null)
      setTask(null)
      setNav('tasks')
      setGoal('')
      setTimeout(() => inputRef.current?.focus(), 30)
      return true
    }
    if (name === 'skills') { setNav('skills'); setGoal(''); return true }
    if (name === 'mcp') { setNav('mcp'); setGoal(''); return true }
    if (name === 'cron') { setNav('auto'); setGoal(''); return true }
    if (name === 'help') {
      flash(SLASH_CMDS.map((c) => `/${c.name}${c.args ? ' <' + c.args + '>' : ''}`).join('　'))
      return true
    }
    return false
  }

  const submit = (): void => {
    const g = goal.trim()
    if (!g || busy) return
    // 斜杠命令：本地执行，不建任务
    if (isCommandInput(g) && execSlash(g)) {
      setPop('')
      return
    }
    setGoal('')
    setPop('')
    if (task?.status === 'running') {
      queueRef.current = [...queueRef.current, g]
      setQueue(queueRef.current)
      return
    }
    launch(g)
  }
  const runTask = async (): Promise<void> => {
    if (!selId || !editPlan) return
    setBusy(true)
    try {
      await window.api.agentUpdatePlan(selId, editPlan)
      await window.api.agentRun(selId)
      loadTask(selId)
    } finally {
      setBusy(false)
    }
  }
  const cancelTask = async (): Promise<void> => {
    if (!selId) return
    await window.api.agentCancel(selId)
    loadTask(selId)
  }
  const openArtifact = (a: NonNullable<AgentEvent['artifact']>): void => {
    if (a.paperId) {
      const p = papers.find((x) => x.id === a.paperId)
      if (p) return onOpenPaper(p)
    }
    if (a.slug) {
      const p = papers.find((x) => x.slug === a.slug)
      if (p) return onOpenPaper(p)
    }
    if (a.kind === 'table') return onOpenCompare()
    if (a.kind === 'note') return onOpenNotes()
  }
  const reportMd = (): string => {
    if (!task) return ''
    return [
      '# CSPAPER 任务报告', '',
      `- **目标：** ${task.goal}`,
      `- **状态：** ${STATUS_META[task.status]?.label ?? task.status}`,
      `- **时间：** ${task.createdAt}`, '',
      '## 执行计划',
      ...task.plan.map((p, i) => `${i + 1}. [${p.tool}] ${p.purpose}`), '',
      '## 执行记录',
      ...task.events
        .filter((e) => e.kind === 'step' || e.kind === 'artifact')
        .map((e) => `- ${e.kind === 'artifact' ? '📦' : '⚙️'} ${e.tool ?? ''} ${e.text ?? ''}${e.ms != null ? `（${e.ms}ms）` : ''}`), '',
      '## 总结',
      task.answer || '（无）'
    ].join('\n')
  }
  const exportReport = (): void => {
    if (!task) return
    const blob = new Blob([reportMd()], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CSPAPER-任务报告-${task.id}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  const copyReport = (): void => {
    if (!task) return
    void navigator.clipboard.writeText(task.answer || reportMd()).catch(() => {})
  }
  const scrollBottom = (): void => {
    const el = scrollRef.current
    if (el) {
      autoScroll.current = true
      el.scrollTop = el.scrollHeight
    }
  }

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const groups = new Map<string, TaskSummary[]>()
    for (const t of tasks) {
      if (f && !t.goal.toLowerCase().includes(f)) continue
      const g = dateGroupOf(t.createdAt)
      const arr = groups.get(g) ?? []
      arr.push(t)
      groups.set(g, arr)
    }
    return [...groups.entries()]
  }, [tasks, filter])
  const progress = useMemo(() => (task ? planProgress(task.plan, task.events) : []), [task])
  const doneCount = progress.filter((p) => p.done).length
  const running = task?.status === 'running'
  const worked = task ? workedMsOf(task, Date.now()) : 0

  if (!visible) return null

  return (
    <div className="wb-host">
      {/* ---------- 左栏（ZCode 式） ---------- */}
      <div className="wb-side">
        <div className="wb-brand">
          <span className="wb-brand-mark seal">文</span>
          <span className="wb-brand-name">CSPAPER</span>
        </div>
        <nav className="wb-nav">
          <button
            className="wb-nav-item"
            onClick={() => {
              setSelId(null)
              setTask(null)
              setNav('tasks')
              setTimeout(() => inputRef.current?.focus(), 30)
            }}
          >
            <span className="wb-nav-icon">{<Icon.Plus />}</span>
            <span className="wb-nav-label">新建任务</span>
            <span className="wb-nav-hint">Ctrl+N</span>
          </button>
          <button className={`wb-nav-item ${searchOpen ? 'on' : ''}`} onClick={() => setSearchOpen((v) => !v)}>
            <span className="wb-nav-icon">{<Icon.Search />}</span>
            <span className="wb-nav-label">搜索</span>
          </button>
          <button className={`wb-nav-item ${nav === 'auto' ? 'on' : ''}`} onClick={() => setNav('auto')}>
            <span className="wb-nav-icon">{<Icon.Clock />}</span>
            <span className="wb-nav-label">自动化</span>
          </button>
          <button className={`wb-nav-item ${nav === 'skills' ? 'on' : ''}`} onClick={() => setNav('skills')}>
            <span className="wb-nav-icon">{<Icon.Target />}</span>
            <span className="wb-nav-label">技能</span>
          </button>
          <button className={`wb-nav-item ${nav === 'mcp' ? 'on' : ''}`} onClick={() => setNav('mcp')}>
            <span className="wb-nav-icon">{<Icon.Grid />}</span>
            <span className="wb-nav-label">插件市场</span>
          </button>
        </nav>
        {searchOpen && (
          <div className="wb-side-search">
            <input
              autoFocus
              value={filter}
              placeholder="搜索任务…"
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
            />
          </div>
        )}
        <div className="wb-side-sep" />
        <div className="wb-history">
          {nav === 'tasks' &&
            grouped.map(([g, list]) => (
              <div key={g}>
                <div className="wb-group">{g}</div>
                {list.map((t) => (
                  <button
                    key={t.id}
                    className={`wb-hist ${selId === t.id ? 'on' : ''}`}
                    title={t.goal}
                    onClick={() => {
                      setSelId(t.id)
                      loadTask(t.id)
                    }}
                  >
                    <span className={`wb-hist-dot ${t.status}`} />
                    <span className="wb-hist-goal ellipsis">{t.goal}</span>
                    <span className="wb-hist-time">{relTime(t.createdAt)}</span>
                  </button>
                ))}
              </div>
            ))}
          {nav === 'tasks' && grouped.length === 0 && <div className="wb-dim" style={{ padding: '8px 10px' }}>{filter ? '没有匹配的任务' : '还没有任务，从「新建任务」开始'}</div>}
        </div>
        <div className="wb-side-foot">
          <div className="wb-user">
            <span className="wb-avatar">Z</span>
            <span className="wb-user-name">本地研究者</span>
            <span className="wb-user-badge">本地</span>
            <span style={{ flex: 1 }} />
            <button className="wb-icon-btn" title="设置" onClick={onOpenSettings}>
              {<Icon.Gear />}
            </button>
          </div>
        </div>
      </div>

      {/* ---------- 中央 ---------- */}
      <div className="wb-center">
        {nav !== 'tasks' ? (
          <div className="wb-pane-full">
            {nav === 'skills' && <SkillsPane />}
            {nav === 'auto' && <AutoPane />}
            {nav === 'mcp' && <McpPane />}
          </div>
        ) : task ? (
          <div className="wb-run-view">
            <div className="wb-run-head">
              <span className={`wb-status-pill ${task.status}`}>
                {running && <i className="wb-spin" />}
                {STATUS_META[task.status]?.label}
              </span>
              <span className="wb-run-goal ellipsis" title={task.goal}>
                {task.goal}
              </span>
              <span style={{ flex: 1 }} />
              {running && (
                <button className="wb-mini danger" onClick={() => void cancelTask()}>
                  <Icon.Stop size={12} /> 中止
                </button>
              )}
            </div>
            <div
              className="wb-scroll"
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget
                const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
                autoScroll.current = bottom
                setAtBottom(bottom)
              }}
            >
              <div className={`wb-doc ${wide ? 'wide' : ''}`}>
                {/* 用户消息气泡（右对齐，ZCode 式） */}
                <div className="wb-user-msg">{task.goal}</div>

                {/* 「已工作 X 分 X 秒」折叠条 */}
                {(progress.length > 0 || task.events.some((e) => e.kind === 'step')) && (
                  <>
                    <button className="wb-worked" onClick={() => setWorkOpen((v) => !v)}>
                      {running ? <i className="wb-spin-inline" /> : <span className="wb-worked-ck">{doneCount === progress.length && progress.length > 0 ? '✓' : '·'}</span>}
                      已工作 {fmtWorked(worked)}
                      {progress.length > 0 && (
                        <span className="wb-worked-n">
                          {doneCount}/{progress.length} 步
                        </span>
                      )}
                      <span className={`wb-chev ${workOpen ? 'open' : ''}`}>{<Icon.ChevronR />}</span>
                    </button>
                    {workOpen && progress.length > 0 && (
                      <div className="wb-plan-list">
                        {progress.map((p, i) => (
                          <div key={i} className={`wb-plan-step ${p.done ? 'done' : ''}`}>
                            <i>{p.done ? '✓' : i + 1}</i>
                            <span className="ellipsis">{p.step.purpose || p.step.tool}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* 待确认计划卡（可编辑每步说明） */}
                {task.status === 'awaiting-confirm' && editPlan && (
                  <div className="wb-confirm-card">
                    <div className="wb-confirm-title">执行计划 · {editPlan.length} 步（说明可编辑）</div>
                    {editPlan.map((p, i) => (
                      <div key={i} className="wb-confirm-row">
                        <span className="wb-tool-chip">{TOOL_LABEL[p.tool] ?? p.tool}</span>
                        <input
                          value={p.purpose}
                          onChange={(e) => {
                            const arr = editPlan.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x))
                            setEditPlan(arr)
                          }}
                        />
                      </div>
                    ))}
                    <div className="wb-confirm-foot">
                      <button className="wb-run" disabled={busy} onClick={() => void runTask()}>
                        确认并执行
                      </button>
                    </div>
                  </div>
                )}

                {/* 事件文档流 */}
                {task.events
                  .filter((e) => e.kind !== 'plan')
                  .map((ev, i) => {
                    if (ev.kind === 'status') {
                      // 过程状态只在执行中显示转圈；任务结束后收起（ZCode 式只留结果不留过程噪音）
                      if (task.status !== 'running') return null
                      return (
                        <div key={i} className="wb-ev-status">
                          <i className="wb-spin-inline" />
                          <span>{ev.text}</span>
                        </div>
                      )
                    }
                    if (ev.kind === 'text') {
                      // 完成后：最后一步的流式文本块与「执行总结」重复，隐藏之（中间步骤的文本块保留）
                      const txt = (ev.text ?? '').trim()
                      if (task.status === 'done' && task.answer && (ev.sid ?? 0) >= 100000 && (task.answer.includes(txt) || txt.includes(task.answer.trim()))) return null
                      return (
                        <div key={i} className="wb-doc-text">
                          {ev.text}
                        </div>
                      )
                    }
                    if (ev.kind === 'artifact') {
                      return (
                        <button key={i} className="wb-artifact" onClick={() => ev.artifact && openArtifact(ev.artifact)}>
                          {<Icon.Package />}
                          {ev.artifact?.title || '产物'} · 在文献库中查看
                          <span className="wb-chev">{<Icon.ChevronR />}</span>
                        </button>
                      )
                    }
                    if (ev.kind === 'step') {
                      const label = TOOL_LABEL[ev.tool ?? ''] ?? ev.tool ?? '工具'
                      const open = openStep === i
                      return (
                        <div key={i} className={`wb-tool-row ${ev.ok === false ? 'fail' : ''}`} onClick={() => setOpenStep(open ? null : i)}>
                          <div className="wb-tool-line">
                            <span className={`wb-tool-state ${ev.ok === false ? 'bad' : ''}`}>{ev.ok === false ? '✕' : '✓'}</span>
                            <span className="wb-tool-chip">{label}</span>
                            <span className="wb-tool-sum ellipsis">{(ev.text ?? '').split(' → ')[0]}</span>
                            {ev.ms != null && <span className="wb-tool-ms">{ev.ms >= 1000 ? `${(ev.ms / 1000).toFixed(1)}s` : `${ev.ms}ms`}</span>}
                            <span className={`wb-chev ${open ? 'open' : ''}`}>{<Icon.ChevronR />}</span>
                          </div>
                          {open && ev.text && <div className="wb-tool-detail">{ev.text}</div>}
                        </div>
                      )
                    }
                    if (ev.kind === 'done') return null
                    return (
                      <div key={i} className={`wb-ev-final ${ev.kind}`}>
                        {ev.text || (ev.kind === 'error' ? '任务出错' : '任务已中止')}
                      </div>
                    )
                  })}
                {running && (
                  <div className="wb-ev-status">
                    <i className="wb-spin-inline" />
                    <span>执行中…</span>
                  </div>
                )}

                {/* 执行总结（文档流收尾） */}
                {task.answer && task.status === 'done' && (
                  <div className="wb-final">
                    <div className="wb-final-label"><Icon.Sparkle size={12} /> 执行总结</div>
                    <div className="wb-final-body">{task.answer}</div>
                  </div>
                )}
              </div>
            </div>
            {!atBottom && (
              <button className="wb-jump" title="回到底部" onClick={scrollBottom}>
                {<Icon.ArrowD />}
              </button>
            )}
            <div className="wb-actions">
              <button className="wb-act" title="复制总结 / 报告" onClick={copyReport}>
                {<Icon.Copy />}
                <span>复制</span>
              </button>
              <button className="wb-act" title="导出任务报告 (Markdown)" onClick={exportReport}>
                {<Icon.Save />}
                <span>报告</span>
              </button>
              <button className="wb-act" title={wide ? '收窄正文栏' : '加宽正文栏'} onClick={() => setWide((v) => !v)}>
                {<Icon.Expand />}
                <span>{wide ? '收窄' : '加宽'}</span>
              </button>
              <button
                className="wb-act"
                title="继续输入"
                onClick={() => {
                  inputRef.current?.focus()
                }}
              >
                {<Icon.Doc />}
                <span>继续</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="wb-center-empty">
            <div className="wb-hero">
              <div className="wb-hero-text">今天要研究什么？</div>
              <div className="wb-hero-sub">库内 {papers.length} 篇文献 · 描述目标，智能体自动检索、精读、写综述</div>
              {goalLong && <div className="wb-hero-goal"><Icon.Target size={12} /> 长期目标：{goalLong}</div>}
            </div>
          </div>
        )}

        {/* ---------- 底部合成器（ZCode 式） ---------- */}
        <div className={`wb-composer ${nav !== 'tasks' ? 'ws-hidden' : ''}`}>
          {queue.length > 0 && (
            <div className="wb-queue">
              {queue.map((g, i) => (
                <div key={i} className="wb-queue-item" title={g}>
                  <i className="wb-spin-inline" />
                  <span className="ellipsis">排队：{g}</span>
                  <button
                    className="wb-icon-btn"
                    title="移除"
                    onClick={() => {
                      queueRef.current = queueRef.current.filter((_, j) => j !== i)
                      setQueue(queueRef.current)
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {notice && <div className="wb-notice">{notice}</div>}
          {isCommandInput(goal) && !goal.includes(' ') && filterSlash(goal).length > 0 && (
            <div className="wb-slash">
              {filterSlash(goal).map((c: SlashCmd, i: number) => (
                <button
                  key={c.name}
                  className={`wb-slash-item ${i === Math.min(slashSel, filterSlash(goal).length - 1) ? 'on' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (c.args) setGoal('/' + c.name + ' ')
                    else {
                      setGoal('/' + c.name)
                      submit()
                    }
                    inputRef.current?.focus()
                  }}
                >
                  <b>/{c.name}</b>
                  {c.args ? <span className="wb-slash-args">{'<' + c.args + '>'}</span> : null}
                  <span className="wb-slash-desc">{c.desc}</span>
                  <span className="wb-slash-group">{c.group}</span>
                </button>
              ))}
            </div>
          )}
          <div className="wb-compose-card">
            <textarea
              ref={inputRef}
              className="wb-compose-input"
              value={goal}
              rows={2}
              placeholder={running ? '任务执行中，输入内容将排队在本任务完成后执行' : '给科研智能体一个目标… 输入 / 查看命令（/plan 确认后执行 · /goal 设长期目标 · /deep 调深度）'}
              onChange={(e) => {
                setGoal(e.target.value)
                if (e.target.value.startsWith('/')) setSlashSel(0)
              }}
              onKeyDown={(e) => {
                const menu = isCommandInput(goal) && !goal.includes(' ') ? filterSlash(goal) : null
                if (menu && menu.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashSel((i) => (i + 1) % menu.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashSel((i) => (i - 1 + menu.length) % menu.length)
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const c = menu[Math.min(slashSel, menu.length - 1)]
                    setGoal('/' + c.name + ' ')
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const c = menu[Math.min(slashSel, menu.length - 1)]
                    // 无参命令直接执行；带参命令补全后留在输入框
                    if (c.args) setGoal('/' + c.name + ' ')
                    else {
                      setGoal('/' + c.name)
                      submit()
                    }
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <div className="wb-compose-bar">
              <div className="wb-pop-wrap">
                <button className={`wb-pill ${pop === 'tpl' ? 'on' : ''}`} title="任务模板" onClick={() => setPop(pop === 'tpl' ? '' : 'tpl')}>
                  {<Icon.Plus />}
                </button>
                <button
                  className={`wb-pill ${pop === 'perm' ? 'on' : ''}`}
                  title="执行权限：完全访问 = 计划生成后自动执行；执行前确认 = 每次先确认计划"
                  onClick={() => setPop(pop === 'perm' ? '' : 'perm')}
                >
                  {<Icon.Shield />}
                  {perm === 'auto' ? '完全访问' : '执行前确认'}
                  <span className="wb-pill-caret">▾</span>
                </button>
                {pop === 'tpl' && (
                  <>
                    <div className="wb-pop-mask" onClick={() => setPop('')} />
                    <div className="wb-pop wb-pop-tpl">
                      {TEMPLATES.map((tp) => (
                        <button
                          key={tp.label}
                          className="wb-pop-item"
                          onClick={() => {
                            setGoal(tp.goal)
                            setPop('')
                            inputRef.current?.focus()
                          }}
                        >
                          <b>{tp.label}</b>
                          <span>{tp.desc}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {pop === 'perm' && (
                  <>
                    <div className="wb-pop-mask" onClick={() => setPop('')} />
                    <div className="wb-pop">
                      {(
                        [
                          ['auto', '完全访问', '计划生成后自动执行，产物自动入库'],
                          ['confirm', '执行前确认', '生成计划后先展示，确认后再执行']
                        ] as const
                      ).map(([k, label, desc]) => (
                        <button
                          key={k}
                          className="wb-pop-item"
                          onClick={() => {
                            setPerm(k)
                            localStorage.setItem('wb.perm', k)
                            setPop('')
                          }}
                        >
                          <b>
                            {perm === k ? '✓ ' : ''}
                            {label}
                          </b>
                          <span>{desc}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span style={{ flex: 1 }} />
              <div className="wb-pop-wrap">
                <button className={`wb-pill ${pop === 'model' ? 'on' : ''}`} title="智能体使用的模型" onClick={() => setPop(pop === 'model' ? '' : 'model')}>
                  <span className="wb-pill-dot">{<Icon.Dot />}</span>
                  {agentModel || models[0] || '未配置模型'}
                  <span className="wb-pill-caret">▾</span>
                </button>
                {pop === 'model' && (
                  <>
                    <div className="wb-pop-mask" onClick={() => setPop('')} />
                    <div className="wb-pop wb-pop-up">
                      {models.length === 0 && <div className="wb-pop-item dim">请在设置里配置模型</div>}
                      {models.map((m) => (
                        <button
                          key={m}
                          className="wb-pop-item"
                          onClick={() => {
                            void window.api.saveSettings({ agentModel: m })
                            setAgentModel(m)
                            setPop('')
                          }}
                        >
                          <b>
                            {(agentModel || models[0]) === m ? '✓ ' : ''}
                            {m}
                          </b>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="wb-pop-wrap">
                <button className={`wb-pill ${pop === 'effort' ? 'on' : ''}`} title="执行深度：智能体最多工具调用步数" onClick={() => setPop(pop === 'effort' ? '' : 'effort')}>
                  {<Icon.Target />}
                  {EFFORTS.find((x) => x.steps === effort)?.label ?? `${effort} 步`}
                  <span className="wb-pill-caret">▾</span>
                </button>
                {pop === 'effort' && (
                  <>
                    <div className="wb-pop-mask" onClick={() => setPop('')} />
                    <div className="wb-pop wb-pop-up">
                      {EFFORTS.map((ef) => (
                        <button
                          key={ef.steps}
                          className="wb-pop-item"
                          onClick={() => {
                            setEffort(ef.steps)
                            void window.api.saveSettings({ agentMaxSteps: ef.steps })
                            setPop('')
                          }}
                        >
                          <b>
                            {effort === ef.steps ? '✓ ' : ''}
                            {ef.label}
                          </b>
                          <span>最多 {ef.steps} 步工具调用</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {running ? (
                <button className="wb-send stop" title="中止当前任务" onClick={() => void cancelTask()}>
                  {<Icon.Stop />}
                </button>
              ) : (
                <button className="wb-send" disabled={!goal.trim() || busy} title={running ? '排队执行' : '创建任务'} onClick={submit}>
                  {<Icon.Up />}
                </button>
              )}
            </div>
            {err && <div className="wb-err">{err}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- 技能面板 ----------
function SkillsPane(): JSX.Element {
  const [skills, setSkills] = useState<Array<{ name: string; description: string; source: string }> | null>(null)
  useEffect(() => {
    void window.api.agentSkills().then(setSkills).catch(() => setSkills([]))
  }, [])
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        技能
        <span style={{ flex: 1 }} />
        <button className="wb-mini" onClick={() => void window.api.agentSkillsOpenDir()}>
          打开技能目录
        </button>
      </div>
      <div className="wb-dim" style={{ marginBottom: 10 }}>
        技能 = 可复用的研究工作流说明书（SKILL.md）。agent 在任务中按需加载并照做。放入用户技能目录即热生效——方法可参考 ARIS 等开源科研技能集。
      </div>
      <div className="wb-card-grid">
        {(skills ?? []).map((sk) => (
          <div key={sk.name} className="wb-card">
            <div className="wb-card-head">
              <span className="wb-card-title">{sk.name}</span>
              <span className={`wb-task-status ${sk.source === 'builtin' ? 'done' : 'running'}`}>{sk.source === 'builtin' ? '内置' : '用户'}</span>
            </div>
            <div className="wb-card-body">{sk.description || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 自动化面板 ----------
interface AutoRow {
  id: number
  name: string
  goal: string
  interval_minutes: number
  enabled: number
  last_run_at: string | null
  last_result: string | null
}
const AUTOS: Array<{ label: string; minutes: number }> = [
  { label: '每天', minutes: 1440 },
  { label: '每 6 小时', minutes: 360 },
  { label: '每 30 分钟', minutes: 30 }
]
function AutoPane(): JSX.Element {
  const [rows, setRows] = useState<AutoRow[] | null>(null)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState(1440)
  const refresh = (): void => {
    void window.api.agentAutoList().then((r) => setRows(r as unknown as AutoRow[])).catch(() => {})
  }
  useEffect(refresh, [])
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        自动化
        <span className="wb-dim">· 定时无头执行，结果进任务列表并通知</span>
      </div>
      <div className="wb-card">
        <div className="wb-pane-head">新建自动化</div>
        <input className="wb-plan-purpose" style={{ width: '100%', marginBottom: 6 }} placeholder="任务名（如：每日 arXiv 日报）" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="wb-plan-purpose" style={{ width: '100%', marginBottom: 6, minHeight: 52 }} placeholder="研究目标（同工作台指令，可指定技能如「睡眠科研日报」）" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {AUTOS.map((a) => (
            <button key={a.minutes} className={`wb-chip ${minutes === a.minutes ? 'on' : ''}`} style={minutes === a.minutes ? { borderColor: 'var(--accent,#b08d57)', color: 'var(--accent,#b08d57)' } : undefined} onClick={() => setMinutes(a.minutes)}>
              {a.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="wb-run"
            disabled={!name.trim() || !goal.trim()}
            onClick={() => {
              void window.api.agentAutoCreate(name, goal, minutes).then(() => {
                setName('')
                setGoal('')
                refresh()
              })
            }}
          >
            创建
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {(rows ?? []).map((r) => (
          <div key={r.id} className="wb-card">
            <div className="wb-card-head">
              <span className={`wb-task-status ${r.enabled ? 'done' : 'error'}`}>{r.enabled ? '启用' : '停用'}</span>
              <span className="wb-card-title ellipsis">{r.name}</span>
              <span style={{ flex: 1 }} />
              <button className="wb-mini" onClick={() => void window.api.agentAutoToggle(r.id, !r.enabled).then(refresh)}>
                {r.enabled ? '停用' : '启用'}
              </button>
              <button className="wb-mini danger" onClick={() => void window.api.agentAutoRemove(r.id).then(refresh)}>
                ✕
              </button>
            </div>
            <div className="wb-card-body ellipsis-2">{r.goal}</div>
            <div className="wb-dim">每 {r.interval_minutes} 分钟 · 上次：{r.last_run_at ?? '未运行'}{r.last_result ? ` · ${r.last_result}` : ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 插件市场（MCP）面板 ----------
function McpPane(): JSX.Element {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.api.agentMcpStatus>> | null>(null)
  const refresh = (): void => {
    void window.api.agentMcpStatus().then(setSt).catch(() => {})
  }
  useEffect(refresh, [])
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        插件市场 · MCP 服务器
        <span style={{ flex: 1 }} />
        <button className="wb-mini" onClick={() => void window.api.agentMcpOpenConfig()}>
          编辑 mcp.json
        </button>
        <button className="wb-mini" onClick={refresh}>
          重新连接
        </button>
      </div>
      <div className="wb-dim" style={{ marginBottom: 10 }}>
        在 mcp.json 里配置任意外部 MCP 服务器（Zotero / arXiv / 文件系统 / 联网搜索…），其工具自动挂载给智能体。
      </div>
      {(st?.results ?? []).map((r) => (
        <div key={r.server} className="wb-card">
          <div className="wb-card-head">
            <span className="wb-card-title">{r.server}</span>
            <span style={{ flex: 1 }} />
            <span className={`wb-task-status ${r.ok ? 'done' : 'error'}`}>{r.ok ? `✓ ${r.tools} 工具` : '连接失败'}</span>
          </div>
          {r.error && <div className="wb-card-body">{r.error}</div>}
        </div>
      ))}
      {(st?.tools ?? []).length > 0 && (
        <div className="wb-card">
          <div className="wb-card-head">
            <span className="wb-card-title">已挂载 MCP 工具</span>
          </div>
          <div className="wb-card-body">{(st!.tools ?? []).map((t) => t.fullName).join('、')}</div>
        </div>
      )}
      <div className="wb-dim">配置文件：{st?.configPath ?? ''}</div>
    </div>
  )
}
