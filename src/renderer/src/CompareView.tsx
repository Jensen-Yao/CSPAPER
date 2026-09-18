import { useEffect, useMemo, useState } from 'react'
import type { CompareData, CompareTable, Paper } from './types'

interface Props {
  papers: Paper[]
  onJump: (slug: string, page: number) => void
}

// AI 对比表格：多篇文献 × 多维度横向对比，AI 提取要点并附页码出处（点击跳回原文）
export default function CompareView({ papers, onJump }: Props): JSX.Element {
  const [tables, setTables] = useState<CompareTable[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [genIds, setGenIds] = useState<Set<number>>(new Set())
  const [err, setErr] = useState('')
  const [showAddPaper, setShowAddPaper] = useState(false)
  const [showAddDim, setShowAddDim] = useState(false)
  const [newDim, setNewDim] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [genAllBusy, setGenAllBusy] = useState(false)

  useEffect(() => {
    void window.api
      .compareList()
      .then((ts) => {
        if (ts.length === 0) {
          void window.api.compareCreate().then((t) => {
            setTables([t])
            setActiveId(t.id)
          })
        } else {
          setTables(ts)
          setActiveId(ts[0].id)
        }
      })
      .catch((e) => setErr(String(e)))
  }, [])

  const active = tables.find((t) => t.id === activeId) ?? null
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])

  const mutate = (fn: (d: CompareData) => CompareData): void => {
    if (!active) return
    const next = fn({ ...active.data, cells: { ...active.data.cells } })
    setTables((ts) => ts.map((t) => (t.id === active.id ? { ...t, data: next } : t)))
    void window.api.compareSave(active.id, next).catch(() => {})
  }

  const newTable = async (): Promise<void> => {
    const t = await window.api.compareCreate()
    setTables((ts) => [t, ...ts])
    setActiveId(t.id)
  }
  const removeTable = async (id: number): Promise<void> => {
    await window.api.compareDelete(id)
    const rest = tables.filter((t) => t.id !== id)
    setTables(rest)
    if (activeId === id) setActiveId(rest[0]?.id ?? null)
  }

  const addPapers = (): void => {
    if (!active) return
    const ids = [...picked].filter((id) => !active.data.paperIds.includes(id))
    if (!ids.length) return
    mutate((d) => ({ ...d, paperIds: [...d.paperIds, ...ids] }))
    setPicked(new Set())
    setShowAddPaper(false)
    void generateMissing(ids)
  }
  const removePaper = (pid: number): void => {
    mutate((d) => {
      const cells = { ...d.cells }
      delete cells[String(pid)]
      return { ...d, paperIds: d.paperIds.filter((x) => x !== pid), cells }
    })
  }
  const addDimension = (): void => {
    const name = newDim.trim()
    if (!name || !active || active.data.dimensions.includes(name)) return
    mutate((d) => ({ ...d, dimensions: [...d.dimensions, name] }))
    setNewDim('')
    setShowAddDim(false)
  }

  const generateOne = async (pid: number, dims?: string[]): Promise<void> => {
    if (!active) return
    setGenIds((s) => new Set(s).add(pid))
    setErr('')
    try {
      const cells = await window.api.compareGenerate(pid, dims ?? active.data.dimensions)
      mutate((d) => ({ ...d, cells: { ...d.cells, [String(pid)]: cells } }))
    } catch (e) {
      setErr(String(e).replace(/^Error: /, ''))
    } finally {
      setGenIds((s) => {
        const n = new Set(s)
        n.delete(pid)
        return n
      })
    }
  }

  const generateMissing = async (onlyIds?: number[]): Promise<void> => {
    if (!active || genAllBusy) return
    setGenAllBusy(true)
    const ids = (onlyIds ?? active.data.paperIds).filter((id) => {
      const cells = active.data.cells[String(id)]
      return !cells || Object.keys(cells).length === 0
    })
    for (const id of ids) await generateOne(id)
    setGenAllBusy(false)
  }

  const paperRow = (pid: number, idx: number): JSX.Element => {
    const p = paperById.get(pid)
    const cells = active?.data.cells[String(pid)] ?? {}
    const gen = genIds.has(pid)
    return (
      <tr key={pid}>
        <td className="cmp-idx">{idx + 1}</td>
        <td className="cmp-title">
          {p ? (
            <>
              <div className="cmp-title-text" title={p.title} onClick={() => onJump(p.slug, 1)}>
                {p.title}
              </div>
              <div className="cmp-title-actions">
                <button className="cmp-mini" disabled={gen} title="AI 重新提取本篇要点" onClick={() => void generateOne(pid)}>
                  {gen ? '提取中…' : '↻ 生成'}
                </button>
                <button className="cmp-mini danger" title="从对比中移除" onClick={() => removePaper(pid)}>
                  移除
                </button>
              </div>
            </>
          ) : (
            <span className="cmp-missing">文献已删除</span>
          )}
        </td>
        {(active?.data.dimensions ?? []).map((dim) => (
          <td key={dim} className="cmp-cell">
            {(cells[dim] ?? []).length === 0 ? (
              <span className="cmp-empty">{gen ? '提取中…' : '—'}</span>
            ) : (
              <ul className="cmp-points">
                {cells[dim].map((c, i) => {
                  const pg = c.p
                  return (
                    <li key={i}>
                      <span>{c.t}</span>
                      {pg != null && p && (
                        <button className="cite-chip" title={`跳到第 ${pg} 页`} onClick={() => onJump(p.slug, pg)}>
                          {pg}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </td>
        ))}
        <td className="cmp-meta">{p?.authors || '—'}</td>
        <td className="cmp-meta">{p?.venue || '—'}</td>
      </tr>
    )
  }

  if (!active) {
    return (
      <div className="cmp-wrap">
        <div className="empty-viewer">
          <div className="big">📊</div>
          <div className="headline">AI 对比表格</div>
          <div className="tip">{err || '正在加载对比表…'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="cmp-wrap">
      <div className="tabbar">
        {tables.map((t) => (
          <div key={t.id} className={`tab ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(t.id)} title={t.title}>
            <span className="tab-title">{t.title}</span>
            <span
              className="x"
              title="删除此对比表"
              onClick={(e) => {
                e.stopPropagation()
                void removeTable(t.id)
              }}
            >
              ✕
            </span>
          </div>
        ))}
        <div className="tab cmp-add-tab" title="新建对比表" onClick={() => void newTable()}>
          ＋
        </div>
      </div>

      <div className="cmp-toolbar">
        <button className="cmp-btn" onClick={() => { setPicked(new Set()); setShowAddPaper(true) }}>
          ⊕ 添加文献
        </button>
        <button className="cmp-btn" onClick={() => setShowAddDim(true)}>
          ＋ 添加维度
        </button>
        <button className="cmp-btn primary" disabled={genAllBusy || active.data.paperIds.length === 0} onClick={() => void generateMissing()} title="对所有还没提取过要点的文献跑一遍 AI">
          {genAllBusy ? '生成中…' : '⚡ 生成缺失维度'}
        </button>
        <span style={{ flex: 1 }} />
        <button className="cmp-btn" onClick={() => void window.api.compareExport(active.id, 'md')}>
          导出 Markdown
        </button>
        <button className="cmp-btn" onClick={() => void window.api.compareExport(active.id, 'csv')}>
          导出 CSV
        </button>
      </div>

      {err && <div className="cmp-err">{err}</div>}

      {active.data.paperIds.length === 0 ? (
        <div className="empty-viewer">
          <div className="big">📊</div>
          <div className="headline">多篇文献横向对比</div>
          <div className="tip">
            点「⊕ 添加文献」选入 2 篇以上论文，AI 会按维度提取要点（研究问题 / 研究成果…），每条要点附页码出处，点击角标跳回原文验证。可随时添加自己的分析维度，导出 Markdown / CSV。
          </div>
        </div>
      ) : (
        <div className="cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr>
                <th className="cmp-idx">#</th>
                <th className="cmp-title">标题</th>
                {active.data.dimensions.map((d) => (
                  <th key={d}>{d}</th>
                ))}
                <th>作者</th>
                <th>期刊</th>
              </tr>
            </thead>
            <tbody>
              {active.data.paperIds.map((pid, i) => paperRow(pid, i))}
            </tbody>
          </table>
        </div>
      )}

      {showAddPaper && (
        <div className="modal-mask" onMouseDown={() => setShowAddPaper(false)}>
          <div className="modal modal-pad" style={{ width: 520 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>添加文献到对比表</h2>
              <button className="modal-x" onClick={() => setShowAddPaper(false)}>
                ✕
              </button>
            </div>
            <div className="cmp-pick-list">
              {papers.filter((p) => !active.data.paperIds.includes(p.id)).length === 0 && (
                <div className="cmp-empty" style={{ padding: 16 }}>
                  库里的文献都已加入
                </div>
              )}
              {papers
                .filter((p) => !active.data.paperIds.includes(p.id))
                .map((p) => (
                  <label key={p.id} className="cmp-pick-row">
                    <input
                      type="checkbox"
                      checked={picked.has(p.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const n = new Set(s)
                          if (e.target.checked) n.add(p.id)
                          else n.delete(p.id)
                          return n
                        })
                      }
                    />
                    <span className="ellipsis">{p.title}</span>
                  </label>
                ))}
            </div>
            <div className="modal-actions">
              <span className="hint" style={{ flex: 1 }}>
                加入后自动 AI 提取要点
              </span>
              <button className="btn ghost" onClick={() => setShowAddPaper(false)}>
                取消
              </button>
              <button className="btn" disabled={picked.size === 0} onClick={addPapers}>
                添加 {picked.size} 篇
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddDim && (
        <div className="modal-mask" onMouseDown={() => setShowAddDim(false)}>
          <div className="modal modal-pad" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>添加分析维度</h2>
              <button className="modal-x" onClick={() => setShowAddDim(false)}>
                ✕
              </button>
            </div>
            <div className="field">
              <label>维度名（如：研究方法、数据集、局限性）</label>
              <input
                autoFocus
                value={newDim}
                onChange={(e) => setNewDim(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDimension()
                }}
              />
              <div className="hint">添加后点每行的「↻ 生成」或「⚡ 生成缺失维度」，AI 会按新维度提取要点。</div>
            </div>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={() => setShowAddDim(false)}>
                取消
              </button>
              <button className="btn" disabled={!newDim.trim()} onClick={addDimension}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
