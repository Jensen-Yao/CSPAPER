# -*- coding: utf-8 -*-
# WorkbenchView 四面板补丁
p = 'src/renderer/src/WorkbenchView.tsx'
s = open(p, encoding='utf-8', newline='').read()

old = "export default function WorkbenchView({ visible, papers, onOpenPaper, onOpenCompare, onOpenNotes }: Props): JSX.Element | null {\n  const [tasks, setTasks] = useState<TaskSummary[]>([])"
new = """const AUTOS: Array<{ label: string; minutes: number }> = [
  { label: '每天', minutes: 1440 },
  { label: '每 6 小时', minutes: 360 },
  { label: '每 30 分钟', minutes: 30 }
]

export default function WorkbenchView({ visible, papers, onOpenPaper, onOpenCompare, onOpenNotes }: Props): JSX.Element | null {
  const [pane, setPane] = useState<'tasks' | 'skills' | 'auto' | 'mcp'>('tasks')
  const [tasks, setTasks] = useState<TaskSummary[]>([])"""
assert old in s, 'state anchor missing'
s = s.replace(old, new)

old2 = """      {/* 左：任务列表 */}
      <div className="wb-tasks">
        <div className="wb-tasks-head">任务</div>
        <div className="wb-task-list">
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
        </div>
      </div>"""
new2 = """      {/* 左：分区导航 + 任务/技能/自动化/MCP */}
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
      </div>"""
assert old2 in s, 'left column anchor missing'
s = s.replace(old2, new2)

panels = '''

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
'''
s = s.rstrip() + '\n' + panels
open(p, 'w', encoding='utf-8', newline='').write(s)
print('workbench panels applied')
