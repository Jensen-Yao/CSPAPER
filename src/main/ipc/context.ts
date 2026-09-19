// IPC 注册共享上下文：各域模块只依赖此接口，不反向依赖 index.ts（避免环依赖）
import type { BrowserWindow } from 'electron'

export interface IpcCtx {
  getWin(): BrowserWindow | null
  send(ev: string, payload: unknown): void
  // 渲染端主题变化回调（Windows 标题栏 overlay 同色），index.ts 装配时注入
  onThemeChanged?(theme: string): void
}
