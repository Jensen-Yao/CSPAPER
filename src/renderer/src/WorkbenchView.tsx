// 科研工作台（v0.9，Codex Work 式）：任务列表 | 目标→计划卡→执行时间线→产物区
import { useEffect, useRef, useState } from 'react'
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
  onOpenPaper: (p: Paper) => void
  onOpenCompare: () => void
  onOpenNotes: () => void
}

const TOOLS = ['search_papers', 'search_library', 'list_library', 'import_paper', 'read_paper', 'ask_paper', 'write_note', 'make_synthesis', 'compare_papers', 'cite_format']

const TEMPLATES: Array<{ label: string; goal: string }> = [
  { label: '主题调研', goal: '调研主题：「」。检索相关文献，筛选最相关的 5-8 篇导入文献库，阅读后生成一篇中文综述（存入 AI 知识库）。' },
  { label: '精读论文', goal: '精读库内一篇文献（用 list_library 找到后告诉我 id 前先确认）：阅读全文，写结构化阅读笔记（研究问题/方法/结论/局限/对我启发）写入我的笔记，并总结 3 个值得追问的问题。' },
  { label: '多文对比综述', goal: '对比库内同一分类下的多篇文献（用 list_library 查询）：生成方法/数据/结论三维度对比表，并写 300 字对比结论写入相关文献的笔记。' }
]

const KIND_META: Record<string, { icon: string; label: string }> = {
  plan: { icon: '📋', label: '计划' },
  status: { icon: '⏳', label: '进行' },
  step: { icon: '⚙️', label: '工具' },
  text: { icon: '💬', label: '输出' },
  artifact: { icon: '📦', label: '产物' },
  done: { icon: '✅', label: '完成' },
  error: { icon: '❌', label: '错误' },
  cancelled: { icon: '⏹', label: '已中止' }
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  'awaiting-confirm': { label: '待确认计划', cls: 'pending' },
  running: { label: '执行中', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  error: { label: '出错', cls: 'error' },
  cancelled: { label: '已中止', cls: 'error' }
}

const AUTOS: Array<{ label: string; minutes: number }> = [
  { label: '每天', minutes: 1440 },
  { label: '每 6 小时', minutes: 360 },
  { label: '每 30 分钟', minutes: 30 }
]

export default function WorkbenchView({ visible, papers, onOpenPaper, onOpenCompare, onOpenNotes }: Props): JSX.Element | null {
  const [pane, setPane] = useState<'tasks' | 'skills' | 'auto' | 'mcp'>('tasks')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskFull | null>(null)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editPlan, setEditPlan] = useState<PlanStep[] | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const autoScroll = useRef(true)

  const refreshTasks = (): void => {
    void window.api
      .agentTasks()
      .then((ts) => setTasks(ts as unknown as TaskSummary[]))
      .catch(() => {})
  }

  const loadTask = (id: string): void => {
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
    // 实时事件：当前任务 append-only 刷新，任务列表同步状态
    return window.api.onAgentEvent(({ taskId }) => {
      if (taskId === selId) loadTask(taskId)
      refreshTasks()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selId])

  useEffect(() => {
    if (!visible) return
    const iv = setInterval(refreshTasks, 4000)
    return () => clearInterval(iv)
  }, [visible])

  // 时间线自动滚动（用户上滚时暂停）
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
      setTask({ ...t, plan: t.plan } as TaskFull)
      setEditPlan(t.plan)
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

  if (!visible) return null
  const status = task?.status ?? ''
  const showTimeline = task && task.events.length > 0

  return (
    <div className="wb-host">
      {/* 左：分区导航 + 任务/技能/自动化/MCP */}
      <div className="wb-tasks">
        <div className="wb-pane-nav">
          {(['tasks', 'skills', 'auto', 'mcp'] as const).map((k) => (
            <button key={k} className={`wb-pane-btn ${pane === k ? 'on' : ''}`} onClick={() => setPane(k)}>
              {k === 'tasks' ? '任务' : k === 'skills' ? '技能' : k === 'auto' ? '自动化' : 'MCP'}
            </button>
          ))}
        </div>
        <div className="wb-task-list">
          {pane === 'tasks' && (
            <>
              {tasks.length === 0 && <div className="wb-dim">还没有任务——在右侧输入研究目标开始。</div>}
              {tasks.map((t) => (
                <button
                  key={t.id}
                  className={`wb-task-card ${selId === t.id ? 'on' : ''}`}
                  onClick={() => {
                    setSelId(t.id)
                    loadTask(t.id)
                  }}
                >
                  <div className="wb-task-goal ellipsis">{t.goal}</div>
                  <div className={`wb-task-status ${STATUS_META[t.status]?.cls ?? ''}`}>{STATUS_META[t.status]?.label ?? t.status}</div>
                </button>
              ))}
            </>
          )}
          {pane === 'skills' && <SkillsPane />}
          {pane === 'auto' && <AutoPane />}
          {pane === 'mcp' && <McpPane />}
        </div>
      </div>

      {/* 右：目标 / 计划 / 时间线 / 产物 */}
      <div className="wb-main">
        {!task && (
          <div className="wb-hero">
            <div className="wb-hero-title">给一个研究目标，我来执行</div>
            <div className="wb-hero-sub">检索文献 · 精读 · 写笔记 · 综述 · 对比 —— 产物自动入库</div>
            <textarea
              className="wb-goal"
              value={goal}
              rows={4}
              placeholder="例如：调研「虚拟惯量控制」近两年的研究进展，筛选 5 篇最相关文献导入并生成综述"
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void newTask()
              }}
            />
            <div className="wb-templates">
              {TEMPLATES.map((tp) => (
                <button key={tp.label} className="wb-chip" onClick={() => setGoal(tp.goal)}>
                  {tp.label}
                </button>
              ))}
            </div>
            <button className="wb-go" disabled={busy || !goal.trim()} onClick={() => void newTask()}>
              {busy ? '规划中…' : '生成执行计划'}
            </button>
            {err && <div className="wb-err">{err}</div>}
          </div>
        )}

        {task && (
          <div className="wb-detail">
            <div className="wb-detail-head">
              <button
                className="wb-back"
                title="返回任务列表"
                onClick={() => {
                  setSelId(null)
                  setTask(null)
                }}
              >
                ←
              </button>
              <div className="wb-goal-text ellipsis" title={task.goal}>
                {task.goal}
              </div>
              <span className={`wb-task-status ${STATUS_META[task.status]?.cls ?? ''}`}>{STATUS_META[task.status]?.label ?? task.status}</span>
              {task.status === 'running' && (
                <button className="wb-stop" onClick={() => void cancelTask()}>
                  ⏹ 中止
                </button>
              )}
            </div>

            {/* 计划卡：待确认时可编辑 */}
            {editPlan && task.status === 'awaiting-confirm' && (
              <div className="wb-plan">
                <div className="wb-plan-head">
                  执行计划（可调整后确认）
                  <span style={{ flex: 1 }} />
                  <button
                    className="wb-mini"
                    onClick={() => setEditPlan([...editPlan, { tool: 'search_papers', args: { query: '' }, purpose: '' }])}
                  >
                    ＋ 加一步
                  </button>
                </div>
                {editPlan.map((st, i) => (
                  <div key={i} className="wb-plan-step">
                    <select
                      className="wb-plan-tool"
                      value={st.tool}
                      onChange={(e) => setEditPlan(editPlan.map((x, j) => (j === i ? { ...x, tool: e.target.value } : x)))}
                    >
                      {TOOLS.map((tl) => (
                        <option key={tl} value={tl}>
                          {tl}
                        </option>
                      ))}
                    </select>
                    <input
                      className="wb-plan-purpose"
                      value={st.purpose}
                      placeholder="这一步做什么"
                      onChange={(e) => setEditPlan(editPlan.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))}
                    />
                    <input
                      className="wb-plan-args"
                      value={JSON.stringify(st.args)}
                      placeholder='{"query": "..."}'
                      onChange={(e) => {
                        try {
                          const args = JSON.parse(e.target.value)
                          setEditPlan(editPlan.map((x, j) => (j === i ? { ...x, args } : x)))
                        } catch {
                          /* 输入中暂不解析 */
                        }
                      }}
                    />
                    <button className="wb-mini danger" title="删除此步" onClick={() => setEditPlan(editPlan.filter((_x, j) => j !== i))}>
                      ✕
                    </button>
                  </div>
                ))}
                <div className="wb-plan-actions">
                  <button className="wb-run" disabled={busy} onClick={() => void runTask()}>
                    {busy ? '…' : '▶ 确认并执行'}
                  </button>
                </div>
              </div>
            )}

            {/* 执行时间线 + 产物 */}
            {showTimeline && (
              <div
                className="wb-timeline"
                ref={timelineRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
                }}
              >
                {task.events.map((ev, i) => {
                  const m = KIND_META[ev.kind] ?? { icon: '·', label: ev.kind }
                  return (
                    <div key={i} className={`wb-ev ${ev.kind} ${ev.ok === false ? 'fail' : ''}`}>
                      <span className="wb-ev-icon">{m.icon}</span>
                      <div className="wb-ev-body">
                        <div className="wb-ev-line">
                          {ev.kind === 'step' && <b className="wb-ev-tool">{ev.tool}</b>}
                          {ev.text && <span className="ellipsis">{ev.text}</span>}
                          {ev.ms != null && <span className="wb-ev-ms">{ev.ms}ms</span>}
                        </div>
                        {ev.artifact && (
                          <button className="wb-artifact" onClick={() => openArtifact(ev.artifact!)}>
                            📦 {ev.artifact.title} — 点击查看
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {task.status === 'running' && <div className="wb-ev status"><span className="wb-ev-icon">⏳</span><div className="wb-ev-body">执行中…</div></div>}
              </div>
            )}

            {/* 最终总结 */}
            {task.answer && task.status === 'done' && (
              <div className="wb-answer">
                <div className="wb-answer-head">执行总结</div>
                <div className="wb-answer-body">{task.answer}</div>
              </div>
            )}
          </div>
        )}
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
    <div className="wb-pane">
      <div className="wb-dim">技能 = 可复用的研究工作流说明书。agent 在任务中按需用 use_skill 加载并照做。</div>
      {(skills ?? []).map((sk) => (
        <div key={sk.name} className="wb-task-card" style={{ cursor: 'default' }}>
          <div className="wb-task-goal">{sk.name}</div>
          <div className="wb-dim" style={{ padding: 0 }}>{sk.description || '—'}</div>
          <div className={`wb-task-status ${sk.source === 'builtin' ? 'done' : 'running'}`}>{sk.source === 'builtin' ? '内置' : '用户'}</div>
        </div>
      ))}
      <button className="wb-mini" style={{ marginTop: 6 }} onClick={() => void window.api.agentSkillsOpenDir()}>
        打开技能目录（放入 .md 即生效）
      </button>
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
    <div className="wb-pane">
      <div className="wb-dim">定时无头执行 agent 任务（如「睡眠科研日报」技能），结果进任务列表并弹通知。</div>
      <input className="wb-plan-purpose" style={{ width: '100%', marginBottom: 6 }} placeholder="任务名（如：每日 arXiv 日报）" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className="wb-goal" style={{ marginBottom: 6, fontSize: 12 }} rows={3} placeholder="研究目标（同工作台指令）" value={goal} onChange={(e) => setGoal(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        {AUTOS.map((a) => (
          <button key={a.minutes} className={`wb-chip ${minutes === a.minutes ? 'on' : ''}`} style={minutes === a.minutes ? { borderColor: 'var(--accent,#b08d57)', color: 'var(--accent,#b08d57)' } : undefined} onClick={() => setMinutes(a.minutes)}>
            {a.label}
          </button>
        ))}
      </div>
      <button
        className="wb-run"
        style={{ width: '100%', marginBottom: 10 }}
        disabled={!name.trim() || !goal.trim()}
        onClick={() => {
          void window.api.agentAutoCreate(name, goal, minutes).then(() => {
            setName('')
            setGoal('')
            refresh()
          })
        }}
      >
        ＋ 创建自动化
      </button>
      {(rows ?? []).map((r) => (
        <div key={r.id} className="wb-task-card" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`wb-task-status ${r.enabled ? 'running' : 'error'}`}>{r.enabled ? '启用' : '停用'}</span>
            <span className="wb-task-goal ellipsis" style={{ fontWeight: 600 }}>{r.name}</span>
            <span style={{ flex: 1 }} />
            <button className="wb-mini" onClick={() => void window.api.agentAutoToggle(r.id, !r.enabled).then(refresh)}>
              {r.enabled ? '停用' : '启用'}
            </button>
            <button className="wb-mini danger" onClick={() => void window.api.agentAutoRemove(r.id).then(refresh)}>
              ✕
            </button>
          </div>
          <div className="wb-dim" style={{ padding: 0 }}>
            每 {r.interval_minutes} 分钟 · 上次：{r.last_run_at ?? '未运行'}{r.last_result ? ` · ${r.last_result}` : ''}
          </div>
        </div>
      ))}
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
    <div className="wb-pane">
      <div className="wb-dim">MCP（Model Context Protocol）：配置外部工具服务器后，其工具自动成为工作台 agent 的能力。</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="wb-mini" onClick={() => void window.api.agentMcpOpenConfig()}>
          编辑 mcp.json
        </button>
        <button className="wb-mini" onClick={refresh}>
          重新连接
        </button>
      </div>
      {(st?.results ?? []).map((r) => (
        <div key={r.server} className="wb-task-card" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className={`wb-task-status ${r.ok ? 'done' : 'error'}`}>{r.ok ? `✓ ${r.tools} 工具` : '连接失败'}</span>
            <span className="wb-task-goal">{r.server}</span>
          </div>
          {r.error && <div className="wb-dim" style={{ padding: 0 }}>{r.error}</div>}
        </div>
      ))}
      {(st?.tools ?? []).length > 0 && (
        <div className="wb-dim" style={{ padding: 0 }}>
          已挂载工具：{(st!.tools ?? []).map((t) => t.fullName).join('、')}
        </div>
      )}
      <div className="wb-dim" style={{ padding: 0 }}>配置文件：{st?.configPath ?? ''}</div>
    </div>
  )
}
