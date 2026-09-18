import { useEffect, useState } from 'react'
import type { RecordEntry } from './types'

interface Props {
  initialCats: string[]
  onClose: () => void
  onFinished: () => void
}

type Phase = 'pick' | 'list' | 'importing' | 'done'

// 题录导入弹窗：RIS / EndNote(.enw) / CNKI 自定义格式 → 生成题录页入库
// 适用场景：在 CNKI/万方/百度学术批量勾选文献 → 导出题录 → 这里一键入库（拿到 PDF 后可替换全文）
export default function RecordsDialog({ initialCats, onClose, onFinished }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState('')
  const [entries, setEntries] = useState<RecordEntry[]>([])
  const [cat, setCat] = useState('inbox')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')

  useEffect(
    () =>
      window.api.onRecordsProgress((p) => {
        if (p.current) setProgress({ done: p.done, total: p.total })
      }),
    []
  )

  const pickFile = async (): Promise<void> => {
    setError('')
    const r = await window.api.recordsPickParse()
    if (!r) return
    if (r.entries.length === 0) {
      setError(`「${r.file}」里没有解析出文献题录：支持 RIS（.ris）、EndNote（.enw）或 CNKI 导出的文本格式。`)
      return
    }
    setFile(r.file)
    setEntries(r.entries)
    setPhase('list')
  }

  const start = (): void => {
    if (phase !== 'list' || entries.length === 0) return
    setPhase('importing')
    setProgress({ done: 0, total: entries.length })
    void window.api
      .recordsImport(entries, cat)
      .then((outs) => {
        const ok = outs.filter((o) => o.ok).length
        setSummary(`成功导入 ${ok} 篇题录${ok < outs.length ? `，失败 ${outs.length - ok} 篇` : ''}。生成的是题录页，拿到 PDF 后替换 paper.pdf 即可读全文。`)
        setPhase('done')
      })
      .catch((e) => {
        setSummary('导入失败')
        setError(String(e))
        setPhase('done')
      })
  }

  const catOptions = initialCats.filter((c) => c !== 'inbox')

  return (
    <div className="modal-mask" onMouseDown={phase === 'importing' ? undefined : onClose}>
      <div className="modal import-modal" style={{ width: 580 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>导入题录文件</h2>
          <button className="modal-x" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="import-body">
          {phase === 'pick' && (
            <div className="import-cat-hint">
              支持从 <b>CNKI / 万方 / 百度学术</b> 批量勾选文献后导出的题录文件（RIS、EndNote .enw、自定义文本格式）。
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
                <button className="btn" onClick={() => void pickFile()}>
                  选择题录文件…
                </button>
              </div>
              {error && (
                <div style={{ marginTop: 12, color: '#b44' }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {phase === 'list' && (
            <>
              <div className="import-cat-hint">
                从 <b>{file}</b> 解析出 {entries.length} 篇文献，导入后生成题录页（含标题/作者/摘要，可检索可引用）。
              </div>
              <div className="import-queue">
                {entries.slice(0, 60).map((e, i) => (
                  <div key={`${e.title}-${i}`} className="import-row-wrap">
                    <div className="import-row ready">
                      <span className="import-row-name ellipsis" title={[e.authors, e.venue, e.year].filter(Boolean).join(' · ')}>
                        {e.title}
                      </span>
                      <span className="import-st ready">{e.year ?? ''}</span>
                    </div>
                  </div>
                ))}
                {entries.length > 60 && <div className="import-row folder">…以及其余 {entries.length - 60} 篇</div>}
              </div>
            </>
          )}

          {(phase === 'importing' || phase === 'done') && (
            <div className="import-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : phase === 'done' ? 100 : 0}%` }} />
              </div>
              <div className="import-progress-label">{phase === 'importing' ? `导入中 ${progress.done}/${progress.total}` : summary}</div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          {phase === 'pick' || phase === 'list' ? (
            <>
              {phase === 'list' ? (
                <>
                  <span className="hint" style={{ flex: 1 }}>
                    导入到
                    <select className="import-row-cat" style={{ margin: '0 8px' }} value={cat} onChange={(e) => setCat(e.target.value)}>
                      <option value="inbox">未分类</option>
                      {catOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </span>
                  <button className="btn ghost" onClick={onClose}>
                    取消
                  </button>
                  <button className="btn" onClick={start}>
                    导入 {entries.length} 篇
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
            </>
          ) : phase === 'importing' ? (
            <>
              <span className="hint" style={{ flex: 1 }}>
                正在生成题录页并入库…
              </span>
            </>
          ) : (
            <>
              <span className="hint" style={{ flex: 1 }}>
                {summary}
                {error && <span style={{ color: '#b44' }}>{error}</span>}
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
          )}
        </div>
      </div>
    </div>
  )
}
