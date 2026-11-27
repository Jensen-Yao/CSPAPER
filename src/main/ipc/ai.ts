// AI 域 IPC：深度搜索 / 小结 / 对比表 / 详情 / 图谱 / 笔记 / LLM 流式
import { ipcMain } from 'electron'
import * as dbmod from '../db'
import { hybridSearch } from '../ingest'
import { testLLM } from '../llm'
import { embed } from '../embed'
import {
  listCompare,
  createCompare,
  deleteCompare,
  saveCompare,
  generateCells,
  summarizePaper,
  deepSearch,
  exportCompare,
  paperDetail,
  getExtract,
  extractPaper,
  extractPaperField,
  getMyNotesText,
  saveMyNotesText,
  knowledgeGraph,
  type CompareData
} from '../insight'
import { createComparison, updateComparison } from '../comparison-service'
import type { IpcCtx } from './context'

export function registerAiIpc(ctx: IpcCtx): void {
  const { send } = ctx

  // 深度搜索：正文（FTS）+ 划词笔记
  ipcMain.handle('search:deep', (_e, q: string) => deepSearch(q))

  // AI 文献卡片小结 / AI 对比表格（可追溯引用）
  ipcMain.handle('papers:summarize', (_e, id: number) => summarizePaper(id))
  ipcMain.handle('compare:list', () => listCompare())
  ipcMain.handle('compare:create', (_e, title?: string) => createCompare(title))
  ipcMain.handle('compare:delete', (_e, id: number) => deleteCompare(id))
  ipcMain.handle('compare:save', (_e, id: number, data: CompareData) => saveCompare(id, data))
  ipcMain.handle('compare:generate', (_e, paperId: number, dimensions: string[]) => generateCells(paperId, dimensions, send))
  ipcMain.handle('comparison:create', (_e, paperIds: number[], dimensions?: string[]) => createComparison(paperIds, dimensions))
  ipcMain.handle('comparison:update', (_e, id: number, paperIds: number[], dimensions: string[]) => updateComparison(id, paperIds, dimensions))
  ipcMain.handle('compare:export', (_e, id: number, format: 'md' | 'csv') => exportCompare(id, format, ctx.getWin()))
  ipcMain.handle('papers:detail', (_e, id: number) => paperDetail(id))
  ipcMain.handle('papers:extract-get', (_e, id: number) => getExtract(id))
  ipcMain.handle('papers:similar', async (_e, id: number) => {
    const db = dbmod.getDb()
    const p = db.prepare('SELECT id, title, abstract, summary FROM papers WHERE id=?').get(id) as
      | { id: number; title: string; abstract: string | null; summary: string | null }
      | undefined
    if (!p) return []
    // 通道 1：标题+摘要 embed 对全库整篇向量（pvec）最近邻——真正的语义相似
    // 通道 2：库内混合检索（chunk 级）——落到具体段落证据
    // 两路 RRF 融合，取前 5
    const query = `${p.title}\n${(p.abstract || p.summary || '').slice(0, 300)}`.trim()
    const seenScore = new Map<number, number>()
    try {
      const pvs = db.prepare('SELECT id, pvec FROM papers WHERE pvec IS NOT NULL AND id != ?').all(id) as Array<{ id: number; pvec: Buffer }>
      if (pvs.length > 0) {
        const { embed } = await import('../embed')
        const { vectors: qvs } = await embed([query], true)
        const qv = qvs[0]
        const sims: Array<{ id: number; s: number }> = []
        for (const r of pvs) {
          const v = new Float32Array(r.pvec.buffer, r.pvec.byteOffset, r.pvec.byteLength / 4)
          let dot = 0
          const n = Math.min(v.length, qv.length)
          for (let d = 0; d < n; d++) dot += v[d] * qv[d]
          sims.push({ id: r.id, s: dot })
        }
        sims.sort((a, b) => b.s - a.s)
        sims.slice(0, 10).forEach((x, i) => seenScore.set(x.id, (seenScore.get(x.id) ?? 0) + 1 / (60 + i + 1)))
      }
    } catch {
      /* embed 不可用（未配 Key 且本地模型未下载）时只用通道 2 */
    }
    const rs = await hybridSearch(p.title.slice(0, 120), undefined, 8)
    rs.forEach((r, i) => {
      if (r.paperId === id) return
      seenScore.set(r.paperId, (seenScore.get(r.paperId) ?? 0) + 1 / (60 + i + 1))
    })
    const snippetOf = new Map(rs.map((r) => [r.paperId, r.snippet.slice(0, 100)]))
    const ranked = [...seenScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const out: Array<{ id: number; title: string; snippet: string }> = []
    for (const [pid] of ranked) {
      const row = db.prepare('SELECT id, title FROM papers WHERE id=?').get(pid) as { id: number; title: string } | undefined
      if (row) out.push({ id: row.id, title: row.title, snippet: snippetOf.get(pid) ?? '' })
    }
    return out
  })
  ipcMain.handle('graph:data', (_e, category?: string) => knowledgeGraph(typeof category === 'string' && category ? category : undefined))
  ipcMain.handle('notes:mine-get', (_e, id: number) => getMyNotesText(id))
  ipcMain.handle('notes:mine-save', (_e, id: number, text: string) => saveMyNotesText(id, text))

  // 连接测试：over = 渲染端当前编辑值（先保存再测会读到旧全局配置，正确 key 也测不过）
  ipcMain.handle('llm:test', (_e, over?: import('../llm').LlmEndpoint) => testLLM(over))
  ipcMain.handle('embed:test', async () => {
    try {
      const { dim } = await embed(['connection test'])
      return { ok: true, dim }
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 300) }
    }
  })

  // 深度精读走统一的后台模型任务（有运行记录、可取消、支持单字段重跑）
  const extraction=new Map<number,AbortController>()
  ipcMain.handle('papers:extract-run',(_e,id:number)=>{
    extraction.get(id)?.abort(new Error('重新精读'))
    const controller=new AbortController();extraction.set(id,controller)
    return extractPaper(id,controller.signal).finally(()=>{if(extraction.get(id)===controller)extraction.delete(id)})
  })
  ipcMain.handle('papers:extract-cancel',(_e,id:number)=>{extraction.get(id)?.abort(new Error('用户停止精读'));return true})
  ipcMain.handle('papers:extract-field',(_e,id:number,field:string)=>extractPaperField(id,String(field)))
}
