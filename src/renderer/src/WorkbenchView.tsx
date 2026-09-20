// 科研智能体工作台（v0.11）：布局对标 Codex（左任务历史栏 + 中央 hero + 底部合成器），
// 事件流卡片语言对标 OpenHands（每步一张卡：工具图标 + 标题 + 可展开观察 + 状态点）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Paper } from './types'
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

const TEMPLATES: Array<{ label: string; goal: string }> = [
  { label: '主题调研', goal: '调研主题：「」。检索相关文献，筛选最相关的 5-8 篇导入文献库，阅读后生成一篇中文综述（存入 AI 知识库）。' },
  { label: '精读论文', goal: '精读库内一篇文献（用 list_library 找到并告诉我 id）：阅读全文，写结构化精读笔记（研究问题/方法/结论/局限/启发）写入我的笔记，最后给出 3 个值得追问的问题。' },
  { label: '多文对比', goal: '对比库内同一分类下的多篇文献：生成方法/数据/结论三维度对比表，并写 300 字对比结论。' },
  { label: '睡眠日报', goal: '执行「睡眠科研日报」技能：按库内关键词检索最新文献，相关性排序，产出今日日报并存入 AI 知识库。' }
]


const STATUS_META: Record<string, { label: string; cls: string }> = {
  'awaiting-confirm': { label: '待确认计划', cls: 'pending' },
  running: { label: '执行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  error: { label: '出错', cls: 'error' },
  cancelled: { label: '已中止', cls: 'error' }
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
function dayLabel(iso: string): string {
  return iso.replace('T', ' ').slice(5, 16)
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

export default function WorkbenchView({ visible, papers, models, onOpenPaper, onOpenCompare, onOpenNotes, onOpenSettings }: Props): JSX.Element | null {
  const [nav, setNav] = useState<'tasks' | 'skills' | 'auto' | 'mcp'>('tasks')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskFull | null>(null)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editPlan, setEditPlan] = useState<PlanStep[] | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const autoScroll = useRef(true)

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

  useEffect(() => {
    if (!visible) return
    refreshTasks()
    return window.api.onAgentEvent(({ taskId, event, replace }) => {
      if (taskId === selId && event && replace) loadTask(taskId, event)
      else if (taskId === selId) loadTask(taskId)
      refreshTasks()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selId])

  useEffect(() => {
    const el = timelineRef.current
    if (el && autoScroll.current) el.scrollTop = el.scrollHeight
  }, [task?.events.length])

  const newTask = async (): Promise<void> => {
    if (!goal.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      const t = await window.api.agentPlan(goal.trim())
      setSelId(t.id)
      setTask({ ...(t as unknown as TaskFull), plan: t.plan })
      setEditPlan(t.plan)
      setNav('tasks')
      refreshTasks()
    } catch (e) {
      setErr(String(e).slice(0, 160))
    } finally {
      setBusy(false)
    }
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
  const exportReport = (): void => {
    if (!task) return
    const md = [
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
    const blob = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CSPAPER-任务报告-${task.id}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, TaskSummary[]>()
    for (const t of tasks) {
      const g = dateGroupOf(t.createdAt)
      const arr = groups.get(g) ?? []
      arr.push(t)
      groups.set(g, arr)
    }
    return [...groups.entries()]
  }, [tasks])
  const progress = useMemo(() => (task ? planProgress(task.plan, task.events) : []), [task])
  const doneCount = progress.filter((p) => p.done).length

  if (!visible) return null

  return (
    <div className="wb-host">
      {/* ---------- 左栏 ---------- */}
      <div className="wb-side">
        <div className="wb-brand">
          <span className="wb-brand-mark">⚡</span>
          <span className="wb-brand-name">科研智能体</span>
        </div>
        <button
          className="wb-new"
          onClick={() => {
            setSelId(null)
            setTask(null)
            setNav('tasks')
          }}
        >
          + 新任务
        </button>
        <nav className="wb-nav">
          {(
            [
              ['tasks', '⏺', '任务'],
              ['skills', '🎯', '技能'],
              ['auto', '⏰', '自动化'],
              ['mcp', '🔌', 'MCP']
            ] as const
          ).map(([k, icon, label]) => (
            <button key={k} className={`wb-nav-item ${nav === k ? 'on' : ''}`} onClick={() => setNav(k)}>
              <span className="wb-nav-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
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
                    onClick={() => {
                      setSelId(t.id)
                      loadTask(t.id)
                    }}
                  >
                    <span className={`wb-hist-dot ${t.status}`} />
                    <span className="wb-hist-goal ellipsis">{t.goal}</span>
                    <span className="wb-hist-time">{dayLabel(t.createdAt)}</span>
                  </button>
                ))}
              </div>
            ))}
        </div>
        <div className="wb-side-foot">
          <button className="wb-nav-item" onClick={onOpenSettings}>
            <span className="wb-nav-icon">⚙️</span>
            设置
          </button>
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
                {task.status === 'running' && <i className="wb-spin" />}
                {STATUS_META[task.status]?.label}
              </span>
              <span className="wb-run-goal ellipsis" title={task.goal}>
                {task.goal}
              </span>
              <span style={{ flex: 1 }} />
              {task.status === 'running' && (
                <button className="wb-mini danger" onClick={() => void cancelTask()}>
                  ⏹ 中止
                </button>
              )}
              <button className="wb-mini" title="导出任务报告 (Markdown)" onClick={exportReport}>
                ⤓ 报告
              </button>
            </div>
            {progress.length > 0 && (
              <div className="wb-progress-card">
                <div className="wb-progress-title">
                  执行计划 <span>{doneCount}/{progress.length}</span>
                </div>
                {progress.map((p, i) => (
                  <div key={i} className={`wb-progress-step ${p.done ? 'done' : ''}`}>
                    <i>{p.done ? '✓' : i + 1}</i>
                    <span className="ellipsis">{p.step.purpose || p.step.tool}</span>
                  </div>
                ))}
              </div>
            )}
            <div
              className="wb-timeline"
              ref={timelineRef}
              onScroll={(e) => {
                const el = e.currentTarget
                autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              }}
            >
              {task.events.map((ev, i) => {
                if (ev.kind === 'status') {
                  return (
                    <div key={i} className="wb-ev">
                      <div className="wb-ev-line">
                        <i className="wb-spin-inline" />
                        <span className="wb-ev-text dim">{ev.text}</span>
                      </div>
                    </div>
                  )
                }
                if (ev.kind === 'text') {
                  return (
                    <div key={i} className="wb-ev">
                      <div className="wb-ev-text">{ev.text}</div>
                    </div>
                  )
                }
                return (
                  <div key={i} className={`wb-ev ${ev.kind} ${ev.ok === false ? 'fail' : ''}`}>
                    <div className="wb-ev-line">
                      {ev.kind === 'step' && <span className="wb-ev-tool">{ev.tool}</span>}
                      {ev.kind === 'artifact' && <span className="wb-ev-tool">artifact</span>}
                      {ev.ok != null && <span className={`wb-ev-state ${ev.ok ? 'ok' : 'bad'}`}>{ev.ok ? '[ok]' : '[fail]'}</span>}
                      {ev.ms != null && <span className="wb-ev-ms">{ev.ms}ms</span>}
                    </div>
                    {ev.text && <div className="wb-ev-text">{ev.text}</div>}
                    {ev.artifact && (
                      <button className="wb-artifact" onClick={() => openArtifact(ev.artifact!)}>
                        在文献库中查看 →
                      </button>
                    )}
                  </div>
                )
              })}
              {task.status === 'running' && (
                <div className="wb-ev">
                  <div className="wb-ev-line">
                    <i className="wb-spin-inline" />
                    <span className="wb-ev-text dim">执行中…</span>
                  </div>
                </div>
              )}
            </div>
            {task.answer && task.status === 'done' && (
              <div className="wb-answer">
                <div className="wb-answer-head">执行总结</div>
                <div className="wb-answer-body">{task.answer}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="wb-center-empty">
            <div className="wb-hero">
              <div className="wb-hero-text">今天要研究什么？</div>
            </div>
          </div>
        )}

        {/* 底部合成器 */}
        <div className={`wb-composer ${nav !== 'tasks' ? 'ws-hidden' : ''}`}>
          {showTemplates && (
            <div className="wb-templates-pop">
              {TEMPLATES.map((tp) => (
                <button
                  key={tp.label}
                  className="wb-template-item"
                  onClick={() => {
                    setGoal(tp.goal)
                    setShowTemplates(false)
                  }}
                >
                  {tp.label}
                </button>
              ))}
            </div>
          )}
          <div className="wb-compose-card">
            <textarea
              className="wb-compose-input"
              value={goal}
              rows={2}
              placeholder={task && task.status === 'running' ? '任务执行中…' : '给科研智能体一个目标：检索文献、精读、写笔记、综述、对比…'}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && task?.status !== 'running') {
                  e.preventDefault()
                  void newTask()
                }
              }}
            />
            <div className="wb-compose-bar">
              <button className="wb-tool-btn" title="任务模板" onClick={() => setShowTemplates((v) => !v)}>
                +
              </button>
              <div className="wb-model-wrap">
                <button className="wb-model-chip" title="智能体使用的模型（可切换）" onClick={() => setModelOpen((v) => !v)}>
                  {models[0] ? models[0].slice(0, 22) : '未配置模型'}
                </button>
                {modelOpen && (
                  <>
                    <div className="wb-model-mask" onClick={() => setModelOpen(false)} />
                    <div className="wb-model-list">
                      {models.length === 0 && <div className="wb-model-item dim">请在设置里配置模型</div>}
                      {models.map((m) => (
                        <button
                          key={m}
                          className="wb-model-item"
                          onClick={(e) => {
                            e.stopPropagation()
                            void window.api.saveSettings({ agentModel: m })
                            setModelOpen(false)
                          }}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span style={{ flex: 1 }} />
              <span className="wb-access">自主执行 · 产物入库</span>
              <button className="wb-send" disabled={!goal.trim() || busy} title="生成执行计划" onClick={() => void newTask()}>
                ↑
              </button>
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

// ---------- MCP 面板 ----------
function McpPane(): JSX.Element {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.api.agentMcpStatus>> | null>(null)
  const refresh = (): void => {
    void window.api.agentMcpStatus().then(setSt).catch(() => {})
  }
  useEffect(refresh, [])
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        MCP 服务器
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
