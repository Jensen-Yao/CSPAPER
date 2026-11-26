// 轻量表单弹窗：标题栏 + 表单体 + 取消/保存；Esc 关闭，回车提交（textarea 内换行）。
import type { ReactNode } from 'react'
import * as Icon from './Icon'

interface Props {
  title: string
  saveLabel: string
  onClose: () => void
  onSave: () => void
  disabled?: boolean
  saving?: boolean
  error?: string
  wide?: boolean
  children: ReactNode
}

export default function FormDialog({ title, saveLabel, onClose, onSave, disabled = false, saving = false, error, wide = false, children }: Props): JSX.Element {
  return <div className="modal-mask" onMouseDown={onClose}>
    <div className={`modal quick-capture ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="modal-x" aria-label="关闭" onClick={onClose}><Icon.X size={14} /></button>
      </div>
      <form className="quick-capture-fields" onSubmit={event => { event.preventDefault(); if (!disabled && !saving) onSave() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}>
        {children}
        {error && <div className="chat-message-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn" disabled={disabled || saving}>{saving ? '保存中…' : saveLabel}</button>
        </div>
      </form>
    </div>
  </div>
}