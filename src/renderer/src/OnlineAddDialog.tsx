import { useEffect, useRef, useState } from 'react'
import { catLabel } from './LibraryPane'

// 结果行：单条抓取 → translate 返回里的 csl + translator（脚本 id）；
// 关键词检索 → 整条命中本身就是 CSL-JSON（自带 translator 来源名），直接透传导入
interface ResultRow {
  key: string
  csl: Record<string, unknown>
  translator: string
  status: 'pending' | 'working' | 'done' | 'failed'
  error?: string
}

interface Props {
  open: boolean
  onClose: () => void
  // 有条目导入成功/全部处理完/用户关闭时触发，父组件用来刷新文献列表
  onDone: () => void
  // 现有分类列表（可不含「未分类」，下拉里单独提供）
  cats: string[]
}

// ---------- CSL-JSON 字段提取（展示用，宽容处理缺字段） ----------
function cslTitle(csl: Record<string, unknown>): string {
  const t = csl.title
  return (typeof t === 'string' && t.trim()) || '未命名文献'
}

function cslAuthors(csl: Record<string, unknown>): string {
  const arr = csl.author
  if (!Array.isArray(arr)) return ''
  return arr
    .map((a) => {
      const o = a as { given?: string; family?: string; literal?: string }
      return (o.literal ?? [o.given, o.family].filter(Boolean).join(' ')).trim()
    })
    .filter(Boolean)
    .slice(0, 4)
    .join(', ')
}

function cslYear(csl: Record<string, unknown>): string {
  const issued = csl.issued as { 'date-parts'?: number[][] } | undefined
  const y = issued?.['date-parts']?.[0]?.[0]
  return typeof y === 'number' && y > 1000 ? String(y) : ''
}

function cslVenue(csl: Record<string, unknown>): string {
  const ct = csl['container-title']
  return Array.isArray(ct) ? String(ct[0] ?? '') : typeof ct === 'string' ? ct : ''
}

// 在线添加文献（对标 Zotero「通过标识符添加」）：
// 输入 DOI / arXiv ID / 链接 → 智能识别后走对应抓取脚本取单条题录；
// 输入标题关键词 → 多源学术检索列出候选，逐条挑着导入。
export default function OnlineAddDialog({ open, onClose, onDone, cats }: Props): JSX.Element | null {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'searching' | 'list'>('idle')
  const [rows, setRows] = useState<ResultRow[]>([])
  const [error, setError] = useState('')
  // 导入目标分类；'' = AI 自动归类（translatorsImport 空 category：有 PDF 走导入管线 AI 推荐，
  // 纯题录无 PDF 时落回未分类——备注：AI 选项传 ''，由后端兜底）
  const [cat, setCat] = useState('inbox')
  // 来源说明（DOI 链接 / 检索词），随导入写入笔记 md
  const [origin, setOrigin] = useState('')
  const closedRef = useRef(false)

  // 每次打开都重置，避免上次的检索结果残留
  useEffect(() => {
    if (open) {
      setText('')
      setRows([])
      setError('')
      setCat('inbox')
      setPhase('idle')
      closedRef.current = false
    }
  }, [open])

  // 全部条目处理完（成功或失败）自动收尾：刷新列表并关闭
  useEffect(() => {
    if (phase !== 'list' || rows.length === 0) return
    if (!rows.every((r) => r.status === 'done' || r.status === 'failed')) return
    const t = setTimeout(() => {
      if (!closedRef.current) {
        closedRef.current = true
        onDone()
        onClose()
      }
    }, 700) // 稍作停留，让用户看到 ✓
    return () => clearTimeout(t)
  }, [rows, phase, onDone, onClose])

  const busy = phase === 'searching' || rows.some((r) => r.status === 'working')

  const search = async (): Promise<void> => {
    const t = text.trim()
    if (!t || busy) return
    setPhase('searching')
    setError('')
    try {
      const d = await window.api.translatorsDetectInput(t)
      if (d.kind === 'empty') {
        setError('请输入 DOI / arXiv ID / 链接或标题关键词')
        setPhase('idle')
        return
      }
      if (d.kind === 'query') {
        const q = d.q ?? t
        setOrigin(`检索「${q}」`)
        const hits = await window.api.translatorsSearch(q)
        setRows(
          hits.map((h, i) => ({
            key: `s-${i}`,
            csl: h,
            translator: typeof h.translator === 'string' && h.translator ? h.translator : '检索',
            status: 'pending' as const
          }))
        )
        if (hits.length === 0) setError('没有检索到结果。可以换个关键词，或直接粘贴 DOI / arXiv ID / 链接。')
        setPhase('list')
        return
      }
      // doi / arxiv / url → 拼目标链接走网页抓取脚本
      const target = d.kind === 'doi' ? `https://doi.org/${d.doi}` : d.kind === 'arxiv' ? `https://arxiv.org/abs/${d.id}` : (d.url ?? t)
      setOrigin(target)
      const r = await window.api.translatorsTranslate(target)
      if (!r.ok || !r.csl) {
        setError(r.error ?? '抓取失败，请稍后再试。')
        setRows([])
      } else {
        setRows([{ key: 'single', csl: r.csl, translator: r.translator ?? '抓取', status: 'pending' as const }])
      }
      setPhase('list')
    } catch (e) {
      setError(String(e))
      setPhase('idle')
    }
  }

  const importRow = async (i: number): Promise<void> => {
    const row = rows[i]
    if (!row || row.status !== 'pending') return
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: 'working' as const, error: undefined } : r)))
    try {
      const res = await window.api.translatorsImport({ csl: row.csl, category: cat, origin })
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: res.ok ? ('done' as const) : ('failed' as const), error: res.error } : r)))
    } catch (e) {
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: 'failed' as const, error: String(e) } : r)))
    }
  }

  if (!open) return null

  const catOptions = cats.filter((c) => c !== 'inbox')

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal online-add" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>在线添加文献</h2>
          <button
            className="modal-x"
            title="关闭"
            onClick={() => {
              if (!closedRef.current) {
                closedRef.current = true
                if (rows.some((r) => r.status === 'done')) onDone()
              }
              onClose()
            }}
          >
            ✕
          </button>
        </div>

        <div className="online-add-search">
          <input
            autoFocus
            placeholder="输入 DOI / arXiv ID / 链接 / 标题关键词"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search()
            }}
          />
          <button className="btn" disabled={!text.trim() || busy} onClick={() => void search()}>
            查找
          </button>
        </div>

        {phase === 'searching' && (
          <div className="online-add-status">
            <span className="thinking">
              <span className="b" />
              <span className="b" />
              <span className="b" />
            </span>
            正在抓取/检索…
          </div>
        )}

        {error && (
          <div className="online-add-error">
            {error}
            {error.includes('没有匹配的抓取脚本') && (
              <span className="online-add-error-tip">可到「设置 → 在线获取」查看启用的抓取脚本；也可以直接粘贴 DOI 试试。</span>
            )}
          </div>
        )}

        {phase === 'list' && rows.length > 0 && (
          <div className="online-add-list">
            {rows.map((r, i) => {
              const byline = [cslAuthors(r.csl), cslYear(r.csl), cslVenue(r.csl)].filter(Boolean).join(' · ')
              return (
                <div key={r.key} className={`online-add-row ${r.status}`}>
                  <div className="online-add-main">
                    <div className="online-add-title" title={cslTitle(r.csl)}>
                      {cslTitle(r.csl)}
                    </div>
                    <div className="online-add-meta">
                      <span className="online-add-byline ellipsis" title={byline}>
                        {byline || '—'}
                      </span>
                      <span className="chip online-add-src" title={`来源：${r.translator}`}>
                        {r.translator}
                      </span>
                    </div>
                  </div>
                  {r.status === 'pending' && (
                    <button className="btn ghost online-add-import" onClick={() => void importRow(i)}>
                      导入
                    </button>
                  )}
                  {r.status === 'working' && <span className="online-add-st working">导入中…</span>}
                  {r.status === 'done' && (
                    <span className="online-add-st done" title={cat === '' ? '已按 AI 推荐/默认分类导入' : `已导入到「${catLabel(cat)}」`}>
                      ✓ 已导入
                    </span>
                  )}
                  {r.status === 'failed' && (
                    <span className="online-add-st failed" title={r.error}>
                      失败
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="modal-actions">
          <span className="hint" style={{ flex: 1 }}>
            题录自动去重入库；带 PDF 的来源（如 arXiv）会连同 PDF 一起抓回。
          </span>
          <label className="online-add-cat">
            导入到
            <select value={cat} onChange={(e) => setCat(e.target.value)} title="选中条目的导入去向">
              <option value="">AI 自动归类</option>
              <option value="inbox">未分类</option>
              {catOptions.map((c) => (
                <option key={`oac-${c}`} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn ghost"
            onClick={() => {
              if (!closedRef.current) {
                closedRef.current = true
                if (rows.some((r) => r.status === 'done')) onDone()
              }
              onClose()
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
