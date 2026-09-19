// AI 域 IPC：深度搜索 / 小结 / 对比表 / 详情 / 图谱 / 笔记 / LLM 流式
import { ipcMain } from 'electron'
import * as dbmod from '../db'
import { hybridSearch, extractPagesCached } from '../ingest'
import { chatStream, translateMessages, explainMessages, ragMessages, paperFullMessages, testLLM, type ChatMessage } from '../llm'
import { freeTranslate } from '../free-translate'
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
  getMyNotesText,
  saveMyNotesText,
  knowledgeGraph,
  type CompareData
} from '../insight'
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
  ipcMain.handle('compare:export', (_e, id: number, format: 'md' | 'csv') => exportCompare(id, format, ctx.getWin()))
  ipcMain.handle('papers:detail', (_e, id: number) => paperDetail(id))
  ipcMain.handle('graph:data', () => knowledgeGraph())
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

  // LLM 流式：reqId 关联渲染端回调
  ipcMain.on(
    'llm:stream',
    async (
      _e,
      args: {
        reqId: number
        mode: 'chat' | 'translate' | 'explain' | 'rag'
        messages?: ChatMessage[]
        text?: string
        context?: string
        question?: string
        scopePaperId?: number
        category?: string
        paperTitle?: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
      }
    ) => {
      try {
        let msgs: ChatMessage[]
        let sources: import('../ingest').RetrievedChunk[] = []
        if (args.mode === 'translate') {
          const s = dbmod.getSettings()
          // 免 Key 开箱即用：未配置 API Key 时划词翻译走免费通道，不要求用户先配模型
          if (!s.apiKey || !s.apiKey.trim()) {
            try {
              send(`llm:delta:${args.reqId}`, await freeTranslate(args.text!, s.translateTarget))
            } catch (err) {
              send(`llm:delta:${args.reqId}`, `⚠️ ${String(err)}`)
            }
            send(`llm:end:${args.reqId}`, null)
            return
          }
          msgs = translateMessages(args.text!, args.context ?? '', s.translateTarget)
        } else if (args.mode === 'explain') msgs = explainMessages(args.text!, args.context ?? '')
        else if (args.mode === 'rag') {
          if (args.scopePaperId) {
            // 整篇模式：完整论文正文进提示词（按页标记，引用为 [页码]）
            const paper = dbmod
              .getDb()
              .prepare('SELECT id, slug, title, path FROM papers WHERE id=?')
              .get(args.scopePaperId) as { id: number; slug: string; title: string; path: string } | undefined
            if (!paper) throw new Error('论文不存在')
            let pages: string[] = []
            try {
              pages = await extractPagesCached(paper.path)
            } catch {
              pages = []
            }
            if (pages.length > 0) {
              sources = pages.map((t, i) => ({ paperId: paper.id, slug: paper.slug, title: paper.title, page: i + 1, text: t, score: 1, snippet: '' }))
              msgs = paperFullMessages(args.question!, pages, paper.title, undefined, args.history)
            } else {
              sources = await hybridSearch(args.question!, args.scopePaperId, 10, args.category)
              msgs = ragMessages(args.question!, sources.map((s, i) => ({ label: `${s.title} (p.${s.page})`, text: s.text })), paper.title, args.history)
            }
          } else {
            sources = await hybridSearch(args.question!, undefined, 16, args.category)
            if (sources.length === 0) {
              send(`llm:delta:${args.reqId}`, '⚠️ 检索不到相关片段（可能索引尚未建好），请先重建索引。')
              send(`llm:end:${args.reqId}`, null)
              return
            }
            msgs = ragMessages(
              args.question!,
              sources.map((s, i) => ({ label: `${s.title} (p.${s.page})`, text: s.text })),
              args.paperTitle,
              args.history
            )
          }
        } else msgs = args.messages ?? []

        for await (const delta of chatStream(msgs)) send(`llm:delta:${args.reqId}`, delta)
        if (args.mode === 'rag')
          send(
            `llm:sources:${args.reqId}`,
            sources.map((s, i) => ({ n: i + 1, slug: s.slug, title: s.title, page: s.page, snippet: s.snippet || undefined }))
          )
        send(`llm:end:${args.reqId}`, null)
      } catch (err) {
        send(`llm:delta:${args.reqId}`, `\n\n❌ ${String(err)}`)
        send(`llm:end:${args.reqId}`, null)
      }
    }
  )
}
