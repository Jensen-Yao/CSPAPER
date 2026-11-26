// 快速记录（v0.22）：Ctrl/Cmd + Shift + N 随时唤起，保存为独立笔记并广播 notes-changed。
import { useEffect, useRef, useState } from 'react'
import { useDialog } from './Dialog'
import FormDialog from './FormDialog'
import * as Icon from './Icon'

export default function QuickCaptureDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (title: string) => void }): JSX.Element | null {
  const dlg = useDialog()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!open) return
    setTitle(''); setBody(''); setError(''); setSaving(false)
    const timer = window.setTimeout(() => bodyRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])
  if (!open) return null
  const save = async (): Promise<void> => {
    const text = body.trim()
    if (!text || saving) return
    setSaving(true); setError('')
    try {
      const heading = title.trim() || text.split('\n')[0].slice(0, 80) || '快速记录'
      await window.api.standaloneNotesSave(null, heading, text)
      onSaved?.(heading)
      window.dispatchEvent(new Event('cspaper:notes-changed'))
      dlg.toast('已保存到笔记中心')
      onClose()
    } catch (error) {
      setError(String(error).replace(/^Error: /, ''))
    } finally {
      setSaving(false)
    }
  }
  return <FormDialog title="快速记录" saveLabel="保存记录" saving={saving} disabled={!body.trim()} error={error} onClose={onClose} onSave={() => void save()}>
    <input className="quick-capture-title" placeholder="标题（可选，默认取第一行）" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} />
    <textarea
      ref={bodyRef}
      className="quick-capture-text"
      rows={8}
      placeholder={'写下想法、问题、实验观察或下一步…\nCtrl / Cmd + Enter 保存'}
      value={body}
      maxLength={20000}
      onChange={event => setBody(event.target.value)}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }}
    />
    <div className="quick-capture-hint"><span><Icon.Notes size={12} /> 保存为独立笔记，可在笔记中心继续编辑。</span><span>{body.length} / 20000</span></div>
  </FormDialog>
}