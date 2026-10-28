// 全局对话框与轻提示（v0.19）。
// 背景：Electron 不支持 window.prompt（调用直接抛错），新建标签/集合/便签/独立笔记
// 等入口因此 100% 无效；window.confirm/alert 也无法样式化、且会把原始异常串弹给用户。
// 这里提供与水墨视觉一致的受控替代：useDialog().prompt() / confirm() / toast()。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as Icon from './Icon'

type PromptOpts = {
  title: string
  placeholder?: string
  defaultValue?: string
  okText?: string
  /** 简单校验：返回错误文案则阻止提交 */
  validate?: (v: string) => string | null
}
type ConfirmOpts = {
  title: string
  message?: string
  okText?: string
  danger?: boolean
}
type ToastType = 'info' | 'ok' | 'error'

interface DialogApi {
  prompt: (o: PromptOpts) => Promise<string | null>
  confirm: (o: ConfirmOpts) => Promise<boolean>
  toast: (msg: string, type?: ToastType) => void
}

const Ctx = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useDialog 必须在 <DialogProvider> 内使用')
  return api
}

interface ToastRow {
  id: number
  msg: string
  type: ToastType
}

export function DialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [promptState, setPromptState] = useState<{
    opts: PromptOpts
    resolve: (v: string | null) => void
  } | null>(null)
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOpts
    resolve: (v: boolean) => void
  } | null>(null)
  const [toasts, setToasts] = useState<ToastRow[]>([])
  const toastId = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef=useRef<HTMLDialogElement|null>(null)
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')

  const toast = useCallback((msg: string, type: ToastType = 'info'): void => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, msg, type }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 4200 : 2600)
  }, [])

  const prompt = useCallback(
    (opts: PromptOpts): Promise<string | null> =>
      new Promise((resolve) => {
        setConfirmState(previous=>{previous?.resolve(false);return null})
        setPromptState(previous=>{previous?.resolve(null);return null})
        setValue(opts.defaultValue ?? '')
        setErr('')
        setPromptState({ opts, resolve })
      }),
    []
  )
  const confirm = useCallback(
    (opts: ConfirmOpts): Promise<boolean> =>
      new Promise((resolve) => {
        setPromptState(previous=>{previous?.resolve(null);return null})
        setConfirmState(previous=>{previous?.resolve(false);return {opts,resolve}})
      }),
    []
  )

  const closePrompt = useCallback(
    (v: string | null): void => {
      setPromptState((st) => {
        st?.resolve(v)
        return null
      })
    },
    []
  )
  const submitPrompt = useCallback((): void => {
    setPromptState((st) => {
      if (!st) return null
      const v = value.trim()
      if (!v) {
        setErr('不能为空')
        return st
      }
      const bad = st.opts.validate?.(v)
      if (bad) {
        setErr(bad)
        return st
      }
      st.resolve(v)
      return null
    })
  }, [value])
  const closeConfirm = useCallback((v: boolean): void => {
    setConfirmState((st) => {
      st?.resolve(v)
      return null
    })
  }, [])

  useEffect(()=>{
    if((promptState||confirmState)&&dialogRef.current&&!dialogRef.current.open) dialogRef.current.showModal()
  },[promptState,confirmState])

  // 打开时聚焦输入框（并全选默认值，重命名场景可直接覆盖）
  useEffect(() => {
    if (promptState) {
      const t = window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 30)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [promptState])

  // Esc 关闭当前最上层；回车提交（输入法组合中不触发）
  useEffect(() => {
    if (!promptState && !confirmState) return
    const h = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (promptState) closePrompt(null)
        else closeConfirm(false)
      } else if (e.key === 'Enter' && promptState && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        submitPrompt()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [promptState, confirmState, closePrompt, closeConfirm, submitPrompt])

  const api = useMemo<DialogApi>(() => ({ prompt, confirm, toast }), [prompt, confirm, toast])

  return (
    <Ctx.Provider value={api}>
      {children}

      {promptState && (
        <div className="dlg-mask" onMouseDown={() => closePrompt(null)}>
          <dialog ref={dialogRef} className="dlg" onMouseDown={(e) => e.stopPropagation()} aria-labelledby="cspaper-dialog-title" onCancel={e=>{e.preventDefault();if(promptState)closePrompt(null);else closeConfirm(false)}}>
            <div className="dlg-title" id="cspaper-dialog-title">{promptState.opts.title}</div>
            <input
              ref={inputRef}
              className="dlg-input"
              value={value}
              placeholder={promptState.opts.placeholder ?? ''}
              onChange={(e) => {
                setValue(e.target.value)
                setErr('')
              }}
            />
            {err && <div className="dlg-err">{err}</div>}
            <div className="dlg-foot">
              <button className="dlg-btn" onClick={() => closePrompt(null)}>
                取消
              </button>
              <button className="dlg-btn primary" onClick={submitPrompt}>
                {promptState.opts.okText ?? '确定'}
              </button>
            </div>
          </dialog>
        </div>
      )}

      {confirmState && (
        <div className="dlg-mask" onMouseDown={() => closeConfirm(false)}>
          <dialog ref={dialogRef} className="dlg" onMouseDown={(e) => e.stopPropagation()} aria-labelledby="cspaper-dialog-title" onCancel={e=>{e.preventDefault();if(promptState)closePrompt(null);else closeConfirm(false)}}>
            <div className="dlg-title" id="cspaper-dialog-title">{confirmState.opts.title}</div>
            {confirmState.opts.message && <div className="dlg-msg">{confirmState.opts.message}</div>}
            <div className="dlg-foot">
              <button className="dlg-btn" onClick={() => closeConfirm(false)}>
                取消
              </button>
              <button className={`dlg-btn ${confirmState.opts.danger ? 'danger' : 'primary'}`} onClick={() => closeConfirm(true)}>
                {confirmState.opts.okText ?? '确定'}
              </button>
            </div>
          </dialog>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="dlg-toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`dlg-toast ${t.type}`}>
              <span className="dlg-toast-ic">
                {t.type === 'ok' ? <Icon.Check size={12} /> : t.type === 'error' ? <Icon.Warning size={12} /> : <Icon.Info size={12} />}
              </span>
              <span className="dlg-toast-text">{t.msg}</span>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  )
}
