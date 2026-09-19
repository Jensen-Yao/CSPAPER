// Translators 域 IPC：脚本管理 / 网页抓取 / 在线检索 / 题录导入（W13）
import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import {
  listScriptInfo,
  matchScript,
  runWeb,
  searchAll,
  importTranslated,
  setDisabledIds,
  invalidateCache,
  userDir,
  extractDoi,
  extractArxivId,
  type ImportTranslatedPayload
} from '../translators'
import type { IpcCtx } from './context'

export function registerTranslatorsIpc(ctx: IpcCtx): void {
  ipcMain.handle('translators:list', () => ({ scripts: listScriptInfo(), userDir: userDir() }))
  ipcMain.handle('translators:match', (_e, url: string) => {
    const s = matchScript(String(url))
    return s ? { id: s.id, name: s.name } : null
  })
  ipcMain.handle('translators:translate', (_e, url: string) => runWebScript(String(url)))
  ipcMain.handle('translators:search', (_e, q: string) => searchAll(String(q)))
  ipcMain.handle('translators:import', (_e, payload: ImportTranslatedPayload) => importTranslated(payload, ctx.send))
  ipcMain.handle('translators:set-disabled', (_e, ids: string[]) => {
    setDisabledIds(Array.isArray(ids) ? ids.map(String) : [])
    invalidateCache()
    return true
  })
  ipcMain.handle('translators:reload', () => {
    invalidateCache()
    return listScriptInfo().length
  })
  ipcMain.handle('translators:open-dir', async () => {
    const dir = userDir()
    fs.mkdirSync(dir, { recursive: true })
    const r = await shell.openPath(dir)
    return r === '' ? true : String(r)
  })
  // 在线添加智能识别：裸 DOI / arXiv ID / 普通关键词 → 建议动作
  ipcMain.handle('translators:detect-input', (_e, text: string) => {
    const t = String(text).trim()
    if (!t) return { kind: 'empty' }
    const doi = extractDoi(t)
    if (doi && /^10\./.test(t.trim())) return { kind: 'doi', doi }
    if (doi) return { kind: 'doi', doi }
    const arxiv = extractArxivId(t)
    if (arxiv && /^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(t.trim().replace(/\s/g, ''))) return { kind: 'arxiv', id: arxiv }
    if (/^https?:\/\//i.test(t)) return { kind: 'url', url: t }
    return { kind: 'query', q: t }
  })

  async function runWebScript(url: string): Promise<{ ok: boolean; translator?: string; csl?: Record<string, unknown>; pdfPath?: string; error?: string }> {
    // 裸 DOI：转成 doi.org 链接走 doi-crossref 脚本
    const doi = extractDoi(url)
    let target = url
    if (!/^https?:\/\//i.test(url)) {
      if (doi) target = `https://doi.org/${doi}`
      else {
        const arxiv = extractArxivId(url)
        if (arxiv) target = `https://arxiv.org/abs/${arxiv}`
        else return { ok: false, error: '不是有效的网址或 DOI' }
      }
    }
    const s = matchScript(target)
    if (!s) return { ok: false, error: '没有匹配的抓取脚本（可在设置里查看脚本列表或自己编写）' }
    const r = await runWeb(s, target)
    ctx.send('app:notice', { title: r.ok ? `抓取成功：${s.name}` : `抓取失败：${s.name}`, detail: r.ok ? String((r.csl as { title?: string })?.title ?? '').slice(0, 80) : (r.error ?? '') })
    return r
  }
}
