import { useEffect, useMemo, useState } from 'react'
import * as Icon from './Icon'
import type { OaRepairApplyResult, OaRepairCandidate, OaRepairPreview } from './types'

interface Props {
  open: boolean
  initialPaperIds?: number[] | null
  onClose: () => void
  onPapersChanged?: () => void
}

const STATUS_LABEL: Record<OaRepairCandidate['status'], string> = {
  available: '找到 OA 原文',
  not_available: '暂无直链 PDF',
  no_identifier: '缺少匹配标识',
  no_match: '未安全匹配',
  download_failed: '下载失败',
  invalid_pdf: '不是有效 PDF',
  error: '探测失败'
}

export default function OaRepairDialog({ open, initialPaperIds, onClose, onPapersChanged }: Props): JSX.Element | null {
  const [phase, setPhase] = useState<'loading' | 'review' | 'applying' | 'done'>('loading')
  const [preview, setPreview] = useState<OaRepairPreview | null>(null)
  const [result, setResult] = useState<OaRepairApplyResult | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<{ phase: 'preview' | 'apply'; done: number; total: number; current: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if(!open) return
    setPhase('loading');setPreview(null);setResult(null);setError('');setProgress(null)
    setSelected(new Set())
    const off=window.api.onOaRepairProgress(setProgress)
    void window.api.oaRepairPreview(initialPaperIds ?? undefined)
      .then(value => {
        setPreview(value)
        setSelected(new Set(value.candidates.filter(item => item.status === 'available').map(item => item.paperId)))
        setPhase('review')
      })
      .catch(err => {
        setError(String(err).replace(/^Error: /, '').slice(0, 240))
        setPhase('review')
      })
    return off
  }, [open, initialPaperIds])

  const stats = useMemo(() => {
    const items = preview?.candidates ?? []
    return {
      total: items.length,
      available: items.filter(item => item.status === 'available').length,
      unavailable: items.filter(item => item.status === 'not_available' || item.status === 'no_match').length,
      noIdentifier: items.filter(item => item.status === 'no_identifier').length,
      errors: items.filter(item => item.status === 'error').length
    }
  }, [preview])

  const toggle = (id: number, on: boolean): void => {
    setSelected(current => {
      const next = new Set(current)
      if(on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if(phase !== 'review' || selected.size === 0) return
    setPhase('applying');setError('')
    try {
      const value = await window.api.oaRepairApply([...selected])
      setResult(value)
      setPhase('done')
      if(value.repaired > 0) onPapersChanged?.()
    } catch(err) {
      setError(String(err).replace(/^Error: /, '').slice(0, 240))
      setPhase('review')
    }
  }

  const closeDialog=():void => {
    if(phase==='loading')void window.api.oaRepairCancel().catch(()=>{})
    onClose()
  }
  if(!open) return null
  const busy = phase === 'loading' || phase === 'applying'
  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : phase === 'loading' ? 0 : 100
  return (
    <div className="modal-mask" onMouseDown={phase === 'applying' ? undefined : closeDialog}>
      <div className="modal oa-repair-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head">
          <h2>开放获取原文修复</h2>
          <button className="modal-x" title={phase === 'applying' ? '正在下载，不能关闭' : '关闭'} disabled={phase === 'applying'} onClick={closeDialog}>×</button>
        </div>
        <div className="modal-scroll oa-repair-body">
          {phase === 'loading' && (
            <div className="oa-repair-empty">
              <Icon.Globe size={24} />
              <h3>正在查询 OpenAlex</h3>
              <p>{progress?.current || '只会读取元数据和 OA 直链，不会自动写入你的文献库。'}</p>
              <progress value={percent} max={100} />
              <span>{progress ? `${progress.done}/${progress.total} · ${percent}%` : '准备中…'}</span>
            </div>
          )}
          {phase !== 'loading' && !result && (
            <>
              <div className="oa-repair-summary" role="status">
                <span><b>{stats.available}</b> 可下载</span>
                <span><b>{stats.unavailable}</b> 暂无直链</span>
                <span><b>{stats.noIdentifier}</b> 缺标识</span>
                <span><b>{stats.errors}</b> 探测失败</span>
              </div>
              {error && <div className="pd-source-alert" role="alert">{error}</div>}
              <div className="oa-repair-list">
                {(preview?.candidates ?? []).map(item => (
                  <label key={item.paperId} className={`oa-repair-row ${item.status}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.paperId)}
                      disabled={item.status !== 'available'}
                      onChange={event => toggle(item.paperId, event.target.checked)}
                    />
                    <span className="oa-repair-main">
                      <b>{item.title}</b>
                      <small>{item.doi ? `DOI 匹配 · ${item.doi}` : `标题匹配${item.sourceName ? ` · ${item.sourceName}` : ''}`}</small>
                      {item.reason && <small>{item.reason}</small>}
                    </span>
                    <span className={`oa-repair-status ${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </label>
                ))}
                {(preview?.candidates.length ?? 0) === 0 && <div className="oa-repair-empty compact">当前库没有题录条目。</div>}
              </div>
            </>
          )}
          {result && (
            <div className="oa-repair-result">
              <h3>修复完成</h3>
              <p>成功升级 <b>{result.repaired}</b> 篇；下载/校验失败 <b>{result.failed}</b> 篇；未找到可用 OA 原文 <b>{result.skipped}</b> 篇。原题录 PDF 与 Markdown 均保留备份。</p>
              <div className="oa-repair-list">
                {result.outcomes.filter(item => selected.has(item.paperId)).map(item => (
                  <div key={item.paperId} className={`oa-repair-row ${item.repaired ? 'available' : 'download_failed'}`}>
                    <span className="oa-repair-main"><b>{item.title}</b><small>{item.error ?? (item.bytes ? `已下载 ${Math.round(item.bytes / 1024)} KB` : '')}</small></span>
                    <span className={`oa-repair-status ${item.repaired ? 'available' : 'download_failed'}`}>{item.repaired ? '已升级原文' : STATUS_LABEL[item.status]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <span className="oa-repair-note">{phase === 'applying' ? `正在下载 ${progress?.done ?? 0}/${progress?.total ?? selected.size}` : '下载前校验 HTTPS、PDF 头和 100MB 上限；替换走操作日志。'}</span>
          <button className="btn ghost" disabled={phase === 'applying'} onClick={closeDialog}>{result ? '关闭' : '取消'}</button>
          {phase === 'review' && <button className="btn primary" disabled={selected.size === 0} onClick={() => void apply()}>下载并替换 {selected.size} 篇</button>}
          {phase === 'applying' && <button className="btn primary" disabled>正在处理…</button>}
        </div>
      </div>
    </div>
  )
}
