// 索引工作线程入口（W0a）：PDF 文本抽取移出主进程事件循环，
// 大库首次索引时窗口拖动/IPC 不再被逐篇解析卡顿。
// 只依赖 node 内置 + pdfjs（外部化），不碰 better-sqlite3 —— SQLite 保持主进程单写者。
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'

const assetRoot: string = workerData?.assetRoot ?? process.cwd()

async function extract(pdfPath: string, maxPages: number): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const doc = await (pdfjs as any).getDocument({
    data,
    useSystemFonts: false,
    standardFontDataUrl: path.join(assetRoot, 'node_modules/pdfjs-dist/standard_fonts/') + path.sep,
    cMapUrl: path.join(assetRoot, 'node_modules/pdfjs-dist/cmaps/') + path.sep,
    cMapPacked: true
  }).promise
  const pages: string[] = []
  for (let p = 1; p <= doc.numPages && p <= maxPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    // 按 y 坐标分行拼接，保留近似版面
    const items = tc.items as Array<{ str: string; transform: number[]; hasEOL?: boolean }>
    let line = ''
    let lastY: number | null = null
    const lines: string[] = []
    for (const it of items) {
      const y = Math.round(it.transform[5] ?? 0)
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        lines.push(line.trim())
        line = ''
      }
      line += it.str + ((it as any).hasEOL ? ' ' : '')
      lastY = y
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.join('\n'))
  }
  try {
    await doc.destroy()
  } catch {
    /* 释放失败无碍 */
  }
  return pages
}

parentPort!.on('message', async (job: { id: number; pdfPath: string; maxPages?: number }) => {
  try {
    const pages = await extract(job.pdfPath, job.maxPages && job.maxPages > 0 ? job.maxPages : Infinity)
    parentPort!.postMessage({ id: job.id, ok: true, pages })
  } catch (e) {
    parentPort!.postMessage({ id: job.id, ok: false, error: String(e) })
  }
})
