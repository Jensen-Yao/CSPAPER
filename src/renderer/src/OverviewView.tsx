import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Paper, TagRow } from './types'
import { STATUS_KEYS, STATUS_META } from './types'
import { catLabel, statusMeta, withAlpha } from './LibraryPane'
import StatsView from './StatsView'
import KnowledgeView from './KnowledgeViews'

interface Props {
  papers: Paper[]
  visible: boolean
  tab: 'table' | 'graph' | 'stats'
  onTabChange: (t: 'table' | 'graph' | 'stats') => void
  onOpen: (p: Paper) => void
  onRefresh: () => void
  // v0.6 外部标签筛选（如左栏标签区联动传入）；与内部下拉叠加（内部优先）
  externalTagFilter?: string | null
}

type SortKey = 'title' | 'authors' | 'year' | 'venue' | 'category' | 'status' | 'cited'
type ColKey = SortKey | 'tags' | 'progress' // tags / progress 仅作列头展示，不参与排序

interface Col {
  key: ColKey
  label: string
  w: string
  sort?: boolean // false = 不可排序
}

const COLS: Col[] = [
  // 标签并入标题单元格下方、进度并入状态单元格下方：9 列减到 7 列，标题拿回呼吸空间
  { key: 'title', label: '标题 / 标签', w: '34%' },
  { key: 'authors', label: '作者', w: '13%' },
  { key: 'year', label: '年份', w: '6%' },
  { key: 'venue', label: '期刊 / 来源', w: '14%' },
  { key: 'category', label: '分类', w: '9%' },
  { key: 'status', label: '状态 / 进度', w: '13%' },
  { key: 'cited', label: '被引', w: '6%' }
]

// 简单窗口化：行数超过该值时只渲染可视范围 ±OVERSCAN 行，用 spacer 行撑高度
const WIN_THRESHOLD = 300
const WIN_ROW_H = 44
const WIN_OVERSCAN = 20

const PALETTE = ['#5b4a3a', '#1558c0', '#1c7a2e', '#b06a00', '#6b21a8', '#0e7490', '#be185d', '#4d7c0f']

// 纵览：Zotero 式文献总表 + 知识网络（同类/同作者/共现关联的力导向图）
export default function OverviewView({ papers, visible, tab, onTabChange, onOpen, onRefresh, externalTagFilter }: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [asc, setAsc] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [files, setFiles] = useState<Record<number, string[]>>({})
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [batchCat, setBatchCat] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)

  // ---------- 标签（v0.6） ----------
  const [tags, setTags] = useState<TagRow[]>([])
  useEffect(() => {
    let on = true
    window.api
      .tagsList()
      .then((t) => {
        if (on) setTags(t)
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [papers])
  const tagColorMap = useMemo(() => new Map(tags.map((t) => [t.name, t.color])), [tags])
  const tagColor = (name: string): string => tagColorMap.get(name) ?? '#98a2ab'
  const [tagFilter, setTagFilter] = useState('')
  const effTag = tagFilter || externalTagFilter || ''

  // ---------- 阅读状态五态（v0.6）：乐观更新本地覆盖，setStatus 后 onRefresh 同步 ----------
  const [statusOverride, setStatusOverride] = useState<Record<number, string>>({})
  useEffect(() => setStatusOverride({}), [papers])
  const [statusMenu, setStatusMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const applyStatus = async (id: number, st: string): Promise<void> => {
    setStatusMenu(null)
    setStatusOverride((o) => ({ ...o, [id]: st }))
    try {
      await window.api.setStatus(id, st)
    } catch (e) {
      alert(String(e))
    }
    onRefresh()
  }

  // ---------- 被引（v0.6）：对当前筛选后的可见行批量更新 ----------
  const [citedBusy, setCitedBusy] = useState(false)
  const doCitedUpdate = async (): Promise<void> => {
    if (citedBusy || filtered.length === 0) return
    setCitedBusy(true)
    try {
      await window.api.citedUpdate(filtered.map((p) => p.id))
      onRefresh()
    } catch (e) {
      alert(String(e))
    } finally {
      setCitedBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const cf = catFilter, sf = statusFilter, tf = effTag
    if (!cf && !sf && !tf) return papers
    return papers.filter(
      (p) => (!cf || p.category === cf) && (!sf || p.status === sf) && (!tf || (p.tags ?? []).includes(tf))
    )
  }, [papers, catFilter, statusFilter, effTag])

  const cats = useMemo(() => [...new Set(papers.map((p) => p.category))], [papers])

  // 批量移动分类：逐篇调用 movePaper（主进程内部改路径并保持高亮/状态）
  const applyBatchMove = async (): Promise<void> => {
    if (!batchCat || checked.size === 0) return
    setBatchBusy(true)
    try {
      for (const id of checked) await window.api.movePaper(id, batchCat)
      setChecked(new Set())
      onRefresh()
    } finally {
      setBatchBusy(false)
    }
  }

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const val = (p: Paper): string | number => {
      if (sortKey === 'cited') return p.cited_by ?? -1
      return (p[sortKey] ?? '') as string | number
    }
    arr.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh')
      return asc ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, asc])

  // ---------- 简单窗口化：>300 行时只渲染可视范围 ±20 行（spacer 行撑高度） ----------
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const windowing = sorted.length > WIN_THRESHOLD
  const [range, setRange] = useState<[number, number]>([0, WIN_THRESHOLD + WIN_OVERSCAN * 2])
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !windowing) {
      setRange([0, sorted.length])
      return
    }
    const calc = (): void => {
      const s = Math.max(0, Math.floor(el.scrollTop / WIN_ROW_H) - WIN_OVERSCAN)
      const e = Math.min(sorted.length, s + Math.ceil(el.clientHeight / WIN_ROW_H) + WIN_OVERSCAN * 2)
      setRange([s, e])
    }
    calc()
    el.addEventListener('scroll', calc, { passive: true })
    return () => el.removeEventListener('scroll', calc)
  }, [windowing, sorted.length])

  // ---------- 行内渲染小件 ----------
  // 标签列：圆点 + 名，最多 3 个，超出折叠为 +N
  const tagChips = (p: Paper): JSX.Element | null => {
    const ts = p.tags ?? []
    if (ts.length === 0) return null
    return (
      <div className="tag-chips">
        {ts.slice(0, 3).map((t) => (
          <span key={t} className="tag-chip" title={t}>
            <i className="tag-dot" style={{ background: tagColor(t) }} />
            {t}
          </span>
        ))}
        {ts.length > 3 && (
          <span className="tag-chip more" title={ts.slice(3).join('、')}>
            +{ts.length - 3}
          </span>
        )}
      </div>
    )
  }
  // 进度列：last_page/n_pages 细进度条（无页数或未开始不显示）
  const progOf = (p: Paper): { pct: number; title: string } | null => {
    if (!p.n_pages || !p.last_page || p.last_page <= 0) return null
    const pct = Math.max(0, Math.min(100, Math.round((p.last_page / p.n_pages) * 100)))
    return { pct, title: `${p.last_page} / ${p.n_pages} 页 · ${pct}%` }
  }

  const toggleRow = async (p: Paper): Promise<void> => {
    if (expanded === p.id) return setExpanded(null)
    setExpanded(p.id)
    if (!files[p.id]) {
      try {
        const d = await window.api.paperDetail(p.id)
        setFiles((f) => ({ ...f, [p.id]: d?.files ?? [] }))
      } catch {
        setFiles((f) => ({ ...f, [p.id]: [] }))
      }
    }
  }

  return (
    <div className="ov-wrap">
      <div className="ov-tabs">
        <button className={`ov-tab ${tab === 'table' ? 'on' : ''}`} onClick={() => onTabChange('table')}>
          ☰ 文献表格
        </button>
        <button className={`ov-tab ${tab === 'graph' ? 'on' : ''}`} onClick={() => onTabChange('graph')}>
          ✦ 知识
        </button>
        <button className={`ov-tab ${tab === 'stats' ? 'on' : ''}`} onClick={() => onTabChange('stats')}>
          ▤ 统计
        </button>
        <span className="ov-count">{papers.length} 篇</span>
      </div>
      {tab === 'table' ? (
        <>
          <div className="ov-filters">
            <span className="ov-flabel">筛选</span>
            <select className="ov-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">全部分类</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </select>
            <select className="ov-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {STATUS_META[k].label}
                </option>
              ))}
            </select>
            <select
              className="ov-filter"
              value={effTag}
              onChange={(e) => setTagFilter(e.target.value)}
              title="按标签筛选"
            >
              <option value="">全部标签</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}（{t.count}）
                </option>
              ))}
            </select>
            <span style={{ flex: 1 }} />
            <button
              className="btn ghost"
              disabled={citedBusy || filtered.length === 0}
              title="联网更新当前可见文献的被引数"
              onClick={() => void doCitedUpdate()}
            >
              {citedBusy ? '更新中…' : '更新被引'}
            </button>
            {checked.size > 0 && (
              <>
                <span className="ov-batch-label">已选 {checked.size} 篇</span>
                <select className="ov-filter" value={batchCat} onChange={(e) => setBatchCat(e.target.value)}>
                  <option value="">移动到分类…</option>
                  {cats.map((c) => (
                    <option key={c} value={c}>
                      {catLabel(c)}
                    </option>
                  ))}
                </select>
                <button className="btn ghost" disabled={!batchCat || batchBusy} onClick={() => void applyBatchMove()}>
                  应用
                </button>
                <button className="btn ghost" onClick={() => setChecked(new Set())}>
                  取消选择
                </button>
              </>
            )}
          </div>
          <div className="ov-table-wrap" ref={wrapRef}>
          <table className={`ov-table ${windowing ? 'win' : ''}`}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && sorted.every((p) => checked.has(p.id))}
                    onChange={(e) => setChecked(e.target.checked ? new Set(sorted.map((p) => p.id)) : new Set())}
                  />
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    style={{ width: c.w }}
                    className={c.sort === false ? '' : 'sortable'}
                    onClick={() => {
                      if (c.key === 'tags' || c.key === 'progress') return
                      if (sortKey === c.key) setAsc(!asc)
                      else {
                        setSortKey(c.key)
                        setAsc(true)
                      }
                    }}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="ov-arrow">{asc ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {range[0] > 0 && (
                <tr className="ov-spacer" style={{ height: range[0] * WIN_ROW_H }}>
                  <td colSpan={COLS.length + 1} />
                </tr>
              )}
              {sorted.slice(range[0], range[1]).map((p) => (
                <Fragment key={p.id}>
                  <tr onClick={() => void toggleRow(p)} title="点击展开附件与信息；双击打开阅读" onDoubleClick={() => onOpen(p)}>
                    <td className="ov-check">
                      <input
                        type="checkbox"
                        checked={checked.has(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const n = new Set(prev)
                            if (e.target.checked) n.add(p.id)
                            else n.delete(p.id)
                            return n
                          })
                        }
                      />
                    </td>
                    <td className="ov-title">
                      <div className="ov-title-main ellipsis">{p.title}</div>
                      {tagChips(p)}
                    </td>
                    <td>{p.authors || '—'}</td>
                    <td>{p.year ?? '—'}</td>
                    <td>{p.venue || '—'}</td>
                    <td>{catLabel(p.category)}</td>
                    <td>
                      <div className="ov-status-cell">
                        {(() => {
                          const m = statusMeta(statusOverride[p.id] ?? p.status)
                          return (
                            <span
                              className="status-pill"
                              style={{ color: m.color, background: withAlpha(m.color, 0.12), borderColor: withAlpha(m.color, 0.28) }}
                              title="点击选择阅读状态"
                              onClick={(e) => {
                                e.stopPropagation()
                                setStatusMenu({ id: p.id, x: e.clientX, y: e.clientY })
                              }}
                            >
                              {<i className="sp-newdot" style={{ background: m.color }} />}
                              <span>{m.label}</span>
                            </span>
                          )
                        })()}
                        {(() => {
                          const pr = progOf(p)
                          if (!pr) return null
                          return (
                            <div className="prog-wrap" title={pr.title}>
                              <div className="prog-bar">
                                <i style={{ width: `${pr.pct}%` }} />
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </td>
                    <td className="ov-cited">{p.cited_by ?? '—'}</td>
                  </tr>
                  {expanded === p.id && (
                    <tr className="ov-expand">
                      <td />
                      <td colSpan={COLS.length}>
                        <div className="ov-detail">
                          <div>
                            <b>{p.title}</b>
                            <div className="ov-dim">{p.slug} · 添加于 {(p.added_at || '').slice(0, 10)}</div>
                            {p.summary && <div className="ov-sum">{p.summary}</div>}
                          </div>
                          <div className="ov-actions">
                            <button className="cmp-mini" onClick={() => onOpen(p)}>
                              打开阅读
                            </button>
                          </div>
                        </div>
                        <div className="ov-files">
                          {(files[p.id] ?? []).map((f) => (
                            <span key={f} className="pd-file">
                              📄 {f}
                            </span>
                          ))}
                          {files[p.id]?.length === 0 && <span className="ov-dim">无附件</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {range[1] < sorted.length && (
                <tr className="ov-spacer" style={{ height: (sorted.length - range[1]) * WIN_ROW_H }}>
                  <td colSpan={COLS.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </>
      ) : tab === 'graph' ? (
        <KnowledgeView papers={papers} visible={visible} onOpen={onOpen} />
      ) : (
        <StatsView visible={visible && tab === 'stats'} onOpen={(id) => { const p = papers.find((x) => x.id === id); if (p) onOpen(p) }} />
      )}

      {/* 阅读状态五选一小浮层 */}
      {statusMenu && (
        <>
          <div className="status-menu-mask" onMouseDown={() => setStatusMenu(null)} />
          <div
            className="status-menu"
            style={{
              left: Math.max(6, Math.min(statusMenu.x, window.innerWidth - 140)),
              top: Math.max(6, Math.min(statusMenu.y, window.innerHeight - 190))
            }}
          >
            {STATUS_KEYS.map((k) => {
              const m = STATUS_META[k]
              const cur = statusOverride[statusMenu.id] ?? papers.find((x) => x.id === statusMenu.id)?.status ?? ''
              return (
                <button
                  key={k}
                  className={`status-menu-item ${cur === k ? 'on' : ''}`}
                  onClick={() => void applyStatus(statusMenu.id, k)}
                >
                  {m.icon === '-new' ? <i className="sp-newdot" /> : <span className="sp-ico">{m.icon}</span>}
                  <span>{m.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

