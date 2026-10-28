// 生态与设置域 IPC：设置 / Zotero 迁移 / 题录导入 / 移动端互导 / 数据目录 / 应用状态
import { app, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as dbmod from '../db'
import { buildIndex, isIndexRunning, indexNeedsRebuild } from '../ingest'
import { detectZoteroDataDir, previewZoteroForUi, importFromZotero, type ZoteroImportItem } from '../zotero'
import { parseRecords, importRecords, type RecordEntry } from '../records'
import { exportMobilePack, mergeMobileNotes } from '../mobilepack'
import { bridgeStatus } from '../bridge'
import { LAUNCHER_DIR, LAUNCHER_FILE } from '../launcher'
import type { IpcCtx } from './context'

export function registerEcoIpc(ctx: IpcCtx): void {
  const { send } = ctx

  ipcMain.handle('settings:get', () => dbmod.getSettings())
  ipcMain.handle('settings:save', (_e, patch) => dbmod.saveSettings(patch))

  // Zotero 文献库迁移：探测数据目录 → 预览（只读副本，Zotero 开着也能读）→ 选择导入
  ipcMain.handle('zotero:detect', () => detectZoteroDataDir())
  ipcMain.handle('zotero:pick-dir', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, { properties: ['openDirectory'], message: '选择 Zotero 数据目录（内含 zotero.sqlite）' })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('zotero:preview', (_e, dataDir?: string) => previewZoteroForUi(dataDir))
  ipcMain.handle('zotero:import', (_e, items: ZoteroImportItem[]) => importFromZotero(items, send))

  // 题录文件导入：RIS / EndNote(.enw) / CNKI 自定义格式 → 生成题录页入库（可后续替换为原文 PDF）
  ipcMain.handle('records:pick-parse', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, {
      title: '选择题录文件（RIS / EndNote / CNKI 导出）',
      filters: [{ name: '题录文件', extensions: ['ris', 'enw', 'txt', 'ciw', 'bib'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const entries = parseRecords(fs.readFileSync(r.filePaths[0], 'utf8'))
    return { file: path.basename(r.filePaths[0]), entries }
  })
  ipcMain.handle('records:import', (_e, entries: RecordEntry[], category: string) => importRecords(entries, category, send))

  // 移动端数据互导：导出 .cspack 数据包 / 合并手机端阅读数据
  ipcMain.handle('mobile:export-pack', async () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const r = await dialog.showSaveDialog(ctx.getWin()!, {
      title: '导出移动端数据包',
      defaultPath: `CSPAPER-Mobile-${stamp}.cspack`,
      filters: [{ name: 'CSPAPER 数据包', extensions: ['cspack'] }]
    })
    if (r.canceled || !r.filePath) return null
    return exportMobilePack(r.filePath, send)
  })
  ipcMain.handle('mobile:merge-notes', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, {
      title: '选择手机端导出的阅读数据',
      filters: [{ name: 'CSPAPER 阅读数据', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const result = mergeMobileNotes(r.filePaths[0])
    send('papers:changed', { ids: [] })
    return result
  })

  ipcMain.handle('data:open', async () => {
    const r = await shell.openPath(app.getPath('userData'))
    return r === '' ? true : String(r)
  })
  // 更改数据存储目录：迁移当前数据（跳过缓存）+ 写引导文件，重启后生效
  ipcMain.handle('data:change-dir', async () => {
    const cur = app.getPath('userData')
    const r = await dialog.showOpenDialog(ctx.getWin()!, {
      properties: ['openDirectory', 'createDirectory'],
      message: '选择新的数据存储位置（将复制现有数据，重启后生效）'
    })
    if (r.canceled || !r.filePaths[0]) return null
    const target = path.resolve(r.filePaths[0])
    if (path.resolve(cur).toLowerCase() === target.toLowerCase()) return null
    fs.mkdirSync(target, { recursive: true })
    // WAL 库必须先 checkpoint 再拷：否则 db/-wal/-shm 三个文件时间点不一致，
    // 迁移后的库可能丢最近事务甚至打不开
    try {
      dbmod.getDb().pragma('wal_checkpoint(TRUNCATE)')
    } catch { /* checkpoint 失败仍尝试拷贝 */ }
    const skip = new Set(['Caches', 'GPUCache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'Crashpad'])
    for (const entry of fs.readdirSync(cur)) {
      if (skip.has(entry)) continue
      const from = path.join(cur, entry)
      const to = path.join(target, entry)
      // force:false 遇已有文件会中途抛错留半截拷贝：先清目标同名，失败时回滚删除本次写入
      try {
        fs.rmSync(to, { recursive: true, force: true })
        fs.cpSync(from, to, { recursive: true, force: false })
      } catch (err) {
        try { fs.rmSync(to, { recursive: true, force: true }) } catch { /* 回滚失败忽略 */ }
        throw new Error(`迁移「${entry}」失败：${String(err).slice(0, 120)}（目标目录已回滚，请重试）`)
      }
    }
    fs.mkdirSync(LAUNCHER_DIR, { recursive: true })
    fs.writeFileSync(LAUNCHER_FILE, JSON.stringify({ dataDir: target }, null, 2))
    return target
  })
  ipcMain.handle('app:status', () => ({
    bridge: bridgeStatus(),
    papers: (dbmod.getDb().prepare('SELECT COUNT(*) AS n FROM papers').get() as { n: number }).n,
    categories: (dbmod.getDb().prepare("SELECT COUNT(DISTINCT category) AS n FROM papers").get() as { n: number }).n,
    version: app.getVersion(),
    dataDir: app.getPath('userData')
  }))

  ipcMain.handle('library:scan-pending', () => {
    const pending = indexNeedsRebuild()
    if (pending && !isIndexRunning()) void buildIndex(send).catch((e) => send('index:error', String(e)))
    return pending
  })

  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
}

// ---------- Zotero Web API 同步（v0.9） ----------
import { apiStatus as zoteroApiStatus, verifyApi as zoteroVerifyApi, syncZotero, pushHighlightsToZotero } from '../zotero-api'

export function registerZoteroApiIpc(ctx: IpcCtx): void {
  ipcMain.handle('zotero:api-status', () => zoteroApiStatus())
  ipcMain.handle('zotero:api-verify', (_e, userId: string, apiKey: string) => zoteroVerifyApi(String(userId ?? '').trim(), String(apiKey ?? '').trim()))
  ipcMain.handle('zotero:push-highlights', (_e, paperId: number) => pushHighlightsToZotero(paperId))
  ipcMain.handle('zotero:api-sync', (_e, mode: 'full' | 'incremental') => {
    void (async () => {
      try {
        const r = await syncZotero({
          mode,
          onProgress: (p) => ctx.send('zotero:progress', p)
        })
        if (r.ok) ctx.send('zotero:sync-done', { ok: true, imported: r.imported, skipped: r.skipped, failed: r.failed, fetched: r.fetched })
        else ctx.send('zotero:sync-done', { ok: false, error: r.error })
      } catch (err) {
        // 异步 IIFE 必须 catch：否则重复 handle/网络异常被吞，UI 的 sync-done 永不到达而卡死
        ctx.send('zotero:sync-done', { ok: false, error: String(err).slice(0, 200) })
      }
    })()
    return { ok: true }
  })
}
