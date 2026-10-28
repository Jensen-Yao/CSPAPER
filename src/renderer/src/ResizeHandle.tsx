import { useCallback, useRef } from 'react'

export interface ResizeHandleProps {
  id: string
  label: string
  width: number
  min: number
  max: number
  defaultWidth: number
  storageKey: string
  /** Which edge the handle sits on: `right` grows by dragging right, `left` grows by dragging left. */
  edge: 'left' | 'right'
  onWidthChange: (width: number) => void
}

/** Keyboard-accessible vertical splitter used by library, assistant, and citation panes. */
export default function ResizeHandle({ id, label, width, min, max, defaultWidth, storageKey, edge, onWidthChange }: ResizeHandleProps): JSX.Element {
  const originRef = useRef({ pointer: 0, width: 0 })
  const commit = useCallback(
    (next: number) => {
      const clamped = Math.max(min, Math.min(Math.min(max, window.innerWidth - 180), Math.round(next)))
      onWidthChange(clamped)
      localStorage.setItem(storageKey, String(clamped))
    },
    [max, min, onWidthChange, storageKey]
  )
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    originRef.current = { pointer: event.clientX, width }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = event.clientX - originRef.current.pointer
    commit(edge === 'right' ? originRef.current.width + delta : originRef.current.width - delta)
  }
  const reset = (): void => {
    onWidthChange(defaultWidth)
    localStorage.setItem(storageKey, String(defaultWidth))
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="col-resizer app-resizer"
      data-resizer={id}
      title={`${label}：拖动或按 ←/→ 调整，双击复位`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 12
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          commit(edge === 'right' ? width - step : width + step)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          commit(edge === 'right' ? width + step : width - step)
        } else if (event.key === 'Home') {
          event.preventDefault()
          reset()
        }
      }}
    />
  )
}
