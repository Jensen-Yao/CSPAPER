// 扩展域 IPC：参考文献抓取/导入、OpenAlex 被引更新、统计概览、期刊影响因子查询/CSV 导入
import { ipcMain } from 'electron'
import { listRefs, importRef } from '../refs'
import { updateCitations, venueLookup, importVenuesCsv } from '../openalex'
import { statsOverview } from '../stats'

export function registerExtraIpc(ctx: { send: (ev: string, p: unknown) => void }): void {
  // ctx.send 预留：当前 handlers 都是 invoke 即返回，暂无主动推送事件
  void ctx

  ipcMain.handle('refs:list', (_e, paperId: number) => listRefs(Number(paperId)))
  ipcMain.handle('refs:import', (_e, paperId: number, index: number, category?: string) =>
    importRef(Number(paperId), Number(index), category ? String(category) : undefined)
  )
  ipcMain.handle('cited:update', (_e, ids: number[]) => updateCitations(Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : []))
  ipcMain.handle('stats:overview', () => statsOverview())
  ipcMain.handle('venues:lookup', (_e, name: string) => venueLookup(String(name)))
  ipcMain.handle('venues:import-csv', () => importVenuesCsv())
}
