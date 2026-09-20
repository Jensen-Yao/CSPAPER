import { useEffect, useState } from 'react'
import type { ZoteroOutcome, ZoteroPaper } from './types'

interface RowState {
  item: ZoteroPaper
  checked: boolean
  cat: string // 目标分类；'inbox' = 未分类（默认取条目在 Zotero 的第一个分类）
  status: 'pending' | 'working' | 'done' | 'skipped' | 'failed'
  error?: string
}

interface Props {
  initialCats: string[]
  onClose: () => void
  onFinished: () => void
}

type Phase = 'detecting' | 'pick' | 'list' | 'importing' | 'done'

// Zotero 导入弹窗：自动探测数据目录 → 列出带 PDF 附件的条目（默认全选）→ 沿用/调整分类 → 导入
export default function ZoteroImportDialog({ initialCats, onClose, onFinished }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [error, setError] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [doneSummary, setDoneSummary] = useState('')

  const runPreview = (dir?: string): void => {
    setPhase('detecting')
    setError('')
    void window.api
      .zoteroPreview(dir)
      .then((r) => {
        setDataDir(r.dataDir)
        if (r.error) {
          setError(r.error)
          setRows([])
          setPhase('pick')
          return
        }
        setRows(
          r.items.map((item) => ({
            item,
            checked: true,
            cat: item.collections[0] ?? 'inbox',
            status: 'pending' as const
          }))
        )
        setPhase(r.items.length ? 'list' : 'pick')
        if (!r.items.length) setError('这个 Zotero 库里没有可导入的文献条目')
      })
      .catch((e) => {
        setError(String(e))
        setPhase('pick')
      })
  }

  useEffect(() => {
    void window.api
      .zoteroDetect()
      .then((d) => runPreview(d.dataDir ?? undefined))
      .catch(() => setPhase('pick'))
  }, [])

  useEffect(
    () =>
      window.api.onZoteroProgress((p) => {
        if (!p.current) return
        setProgress({ done: p.done, total: p.total })
        setRows((rs) => {
          const idx = rs.findIndex((r) => r.checked && r.status === 'pending' && r.item.title === p.current)
          if (idx < 0) return rs
          const next = [...rs]
          next[idx] = { ...next[idx], status: 'working' }
          return next
        })
      }),
    []
  )
  useEffect(
    () =>
      window.api.onZoteroFile((o: ZoteroOutcome) => {
        setRows((rs) => {
          const idx = rs.findIndex((r) => r.item.key === o.key && (r.status === 'pending' || r.status === 'working'))
          if (idx < 0) return rs
          const next = [...rs]
          next[idx] = { ...next[idx], status: o.ok ? (o.skipped ? 'skipped' : 'done') : 'failed', error: o.error }
          return next
        })
      }),
    []
  )

  const pickDir = async (): Promise<void> => {
    const dir = await window.api.zoteroPickDir()
    if (dir) runPreview(dir)
  }

  const importSel = (): void => {
    const sel = rows.filter((r) => r.checked && r.status === 'pending')
    if (!sel.length || phase !== 'list') return
    setPhase('importing')
    setProgress({ done: 0, total: sel.length })
    void window.api
      .zoteroImport(sel.map((r) => ({ key: r.item.key, category: r.cat })))
      .then((outs) => {
        const ok = outs.filter((o) => o.ok && !o.skipped).length
        const skip = outs.filter((o) => o.skipped).length
        const fail = outs.length - ok - skip
        setDoneSummary(`成功导入 ${ok} 篇${skip ? ` · 跳过已存在 ${skip} 篇` : ''}${fail > 0 ? ` · 失败 ${fail} 篇` : ''}（Zotero 共发现 ${rows.length} 篇）`)
        setPhase('done')
      })
      .catch((e) => {
        setDoneSummary('导入失败')
        setError(String(e))
        setPhase('done')
      })
  }

  // 分类选项：Zotero 里的全部分类 + 现有分类（条目默认值即其 Zotero 分类）
  const catOptions = [...new Set([...rows.flatMap((r) => r.item.collections), ...initialCats.filter((c) => c !== 'inbox')])]

  const checkedCount = rows.filter((r) => r.checked && r.status === 'pending').length
  const finishedCount = rows.filter((r) => r.status === 'done' || r.status === 'skipped' || r.status === 'failed').length

  return (
    <div className="modal-mask" onMouseDown={phase === 'importing' ? undefined : onClose}>
      <div className="modal import-modal" style={{ width: 620 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>从 Zotero 导入文献</h2>
          <button className="modal-x" title={phase === 'importing' ? '导入中，可最小化窗口等待' : '关闭'} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="import-body">
          {phase === 'detecting' && <div className="import-cat-hint">正在查找 Zotero 数据目录…</div>}

          {phase === 'pick' && (
            <div className="import-cat-hint">
              {error || '未找到 Zotero 数据目录。'}
              <br />
              确保本机装过 Zotero，或手动选择其数据目录（内含 <code>zotero.sqlite</code>；Zotero 正在运行也可以导入）。
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => void pickDir()}>
                  选择 Zotero 数据目录…
                </button>
                <button className="btn ghost" onClick={() => runPreview()}>
                  重新检测
                </button>
              </div>
            </div>
          )}

          {phase === 'list' && (
            <>
              <div className="import-cat-hint">
                在 <b>{dataDir}</b> 找到 {rows.length} 篇文献（含 PDF {rows.filter((r) => r.item.pdf).length} 篇；无 PDF 的会生成题录页，拿到原文后替换 paper.pdf 即可）。
                分类默认沿用 Zotero 的分类，可逐行修改。
              </div>
              <div className="import-queue">
                {rows.map((r, i) => (
                  <div key={r.item.key} className={`import-row-wrap ${r.status}`}>
                    <div className={`import-row ${r.status}`}>
                      <input
                        type="checkbox"
                        checked={r.checked}
                        title="选择是否导入"
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                      />
                      <span
                        className="import-row-name ellipsis"
                        title={[r.item.authors, r.item.venue, r.item.year, r.item.itemType].filter(Boolean).join(' · ')}
                      >
                        {r.item.title}
                      </span>
                      <span className={`import-pdf-badge ${r.item.pdf ? 'yes' : 'no'}`} title={r.item.pdf ? '含 PDF 附件，完整导入' : '无 PDF，生成题录占位页'}>
                        {r.item.pdf ? 'PDF' : '题录'}
                      </span>
                      {r.status === 'working' && <span className="import-st working">导入中…</span>}
                      {r.status === 'done' && <span className="import-st done">✓ {r.cat === 'inbox' ? '未分类' : r.cat}</span>}
                      {r.status === 'skipped' && (
                        <span className="import-st done" title="库里已有同篇（按 Zotero key 识别），已跳过">
                          已存在
                        </span>
                      )}
                      {r.status === 'failed' && (
                        <span className="import-st failed" title={r.error}>
                          失败
                        </span>
                      )}
                      {r.status === 'pending' && (
                        <select
                          className="import-row-cat"
                          value={r.cat}
                          onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, cat: e.target.value } : x)))}
                        >
                          <option value="inbox">未分类</option>
                          {catOptions.map((c) => (
                            <option key={`${r.item.key}-${c}`} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {(phase === 'importing' || phase === 'done') && (
            <div className="import-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.total ? (finishedCount / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="import-progress-label">{phase === 'importing' ? `导入中 ${progress.done}/${progress.total}` : doneSummary}</div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          {phase === 'list' ? (
            <>
              <span className="hint" style={{ flex: 1 }}>
                带 PDF 复制原文，无 PDF 生成题录页；导入后自动建立索引。
              </span>
              <button className="btn ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn" disabled={checkedCount === 0} onClick={importSel}>
                导入 {checkedCount} 篇
              </button>
            </>
          ) : phase === 'importing' ? (
            <>
              <span className="hint" style={{ flex: 1 }}>
                正在复制 PDF 与元数据，可关闭此窗后台继续。
              </span>
              <button className="btn ghost" onClick={onClose}>
                后台运行
              </button>
            </>
          ) : phase === 'done' ? (
            <>
              <span className="hint" style={{ flex: 1 }}>
                {doneSummary || error}
              </span>
              <button
                className="btn"
                onClick={() => {
                  onFinished()
                  onClose()
                }}
              >
                完成
              </button>
            </>
          ) : (
            <>
              <span className="hint" style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose}>
                取消
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
