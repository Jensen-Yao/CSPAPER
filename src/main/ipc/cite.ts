// 引文域 IPC：样式列表 / 格式化 / 样式下载·导入·删除 / 可选引擎管理（W8）
import { app, ipcMain, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { listStyles, formatCite, downloadStyle, downloadEngine, engineStatus, importStyleFile, removeStyle, searchCatalog } from '../csl'
import type { IpcCtx } from './context'

export function registerCiteIpc(ctx: IpcCtx): void {
  ipcMain.handle('csl:styles', () => listStyles())
  ipcMain.handle('csl:format', (_e, ids: number[], styleId: string) => formatCite((ids ?? []).map(Number), String(styleId)))
  ipcMain.handle('csl:download-style', (_e, id: string) => downloadStyle(String(id)))
  ipcMain.handle('csl:remove-style', (_e, id: string) => removeStyle(String(id)))
  ipcMain.handle('csl:catalog-search', (_e, q: string) => searchCatalog(String(q)))
  ipcMain.handle('csl:engine-status', () => engineStatus())
  ipcMain.handle('csl:engine-download', () => downloadEngine())
  ipcMain.handle('csl:import-style', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, {
      title: '导入 CSL 样式文件（.csl）',
      filters: [{ name: 'CSL 样式', extensions: ['csl'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return importStyleFile(r.filePaths[0])
  })
  ipcMain.handle('csl:open-dir', async () => {
    const dir = path.join(app.getPath('userData'), 'styles')
    fs.mkdirSync(dir, { recursive: true })
    const r = await shell.openPath(dir)
    return r === '' ? true : String(r)
  })
}
