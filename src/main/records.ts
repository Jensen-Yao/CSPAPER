// 题录文件导入：支持 RIS（万方/百度学术/Zotero 通用）、EndNote .enw（CNKI「EndNote」导出）、
// CNKI「自定义/文献格式」等按行 key-value 的中文题录。
// 无 PDF 全文的条目会生成一张「题录页」占位 PDF（元数据排版好、中文正常显示），
// 进库后可被检索、可生成引文；拿到原文后把文件夹里的 paper.pdf 替换掉即可读全文。
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { getSettings, scanLibrary } from './db'
import { sanitizeCategoryName, findCategoryDir, nextCategoryDir } from './import'
import { parseRecords, type RecordEntry } from './record-parse'

export { parseRecords }
export type { RecordEntry } from './record-parse'

// ---------- 占位题录页：离屏渲染 → JPEG → 包成单页 PDF ----------
// 导出给 translators 等模块复用（在线添加无 PDF 时同样生成题录占位）
export async function createPlaceholderPdf(rec: RecordEntry): Promise<Buffer> {
  return titlePagePdf(rec)
}

async function titlePagePdf(rec: RecordEntry): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { offscreen: true }
  })
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; width:794px; height:1123px; font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;
           color:#24242a; background:#fff; box-sizing:border-box; padding:96px 84px; position:relative; }
    .kicker { color:#a6093d; font-size:15px; letter-spacing:6px; margin-bottom:30px; font-weight:600; }
    h1 { font-size:31px; line-height:1.5; margin:0 0 36px; }
    .meta { font-size:16.5px; line-height:2.1; color:#3d3d46; }
    .meta b { color:#98122e; font-weight:600; margin-right:10px; }
    .abs { margin-top:44px; font-size:15px; line-height:1.95; color:#55555e;
           border-top:1px solid #e8e5e2; padding-top:26px; text-align:justify; }
    .foot { position:absolute; bottom:64px; left:84px; right:84px; font-size:13px; color:#9a958f;
            border-top:1px solid #e8e5e2; padding-top:16px; line-height:1.7; }
  </style></head><body>
    <div class="kicker">CSPAPER · 文献题录</div>
    <h1>${esc(rec.title)}</h1>
    <div class="meta">
      <div><b>作　者</b>${esc(rec.authors || '（待补全）')}</div>
      <div><b>来　源</b>${esc(rec.venue || '（待补全）')}${rec.year ? ` · ${rec.year}` : ''}</div>
      ${rec.doi ? `<div><b>DOI</b>${esc(rec.doi)}</div>` : ''}
    </div>
    ${rec.abstract ? `<div class="abs"><b style="color:#98122e">摘　要　</b>${esc(rec.abstract)}</div>` : ''}
    <div class="foot">本条目由题录文件导入，暂无 PDF 全文。获取原文后，将文件重命名为 paper.pdf 替换当前文件，即可正常阅读与检索。</div>
  </body></html>`
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((r) => setTimeout(r, 150))
    const img = await win.webContents.capturePage()
    const size = img.getSize()
    return wrapJpegPdf(img.toJPEG(88), size.width, size.height)
  } finally {
    win.destroy()
  }
}

// JPEG 包裹为单页 PDF（DCTDecode 图像铺满页面，页面尺寸=像素尺寸）
function wrapJpegPdf(jpeg: Buffer, w: number, h: number): Buffer {
  const parts: Buffer[] = []
  const offsets: number[] = []
  let len = 0
  const push = (b: Buffer): void => {
    parts.push(b)
    len += b.length
  }
  const beginObj = (n: number): void => {
    offsets[n] = len
    push(Buffer.from(`${n} 0 obj\n`, 'latin1'))
  }
  push(Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'))
  beginObj(1)
  push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'))
  beginObj(2)
  push(Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'))
  beginObj(3)
  push(
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n`,
      'latin1'
    )
  )
  beginObj(4)
  push(
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      'latin1'
    )
  )
  push(jpeg)
  push(Buffer.from('\nendstream\nendobj\n', 'latin1'))
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
  beginObj(5)
  push(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, 'latin1'))
  const xrefPos = len
  const lines = ['xref', '0 6', '0000000000 65535 f ']
  for (let i = 1; i <= 5; i++) lines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `)
  lines.push('trailer', '<< /Size 6 /Root 1 0 R >>', 'startxref', String(xrefPos), '%%EOF', '')
  push(Buffer.from(lines.join('\n'), 'latin1'))
  return Buffer.concat(parts)
}

// ---------- 导入 ----------
const slugOf = (rec: RecordEntry): string => {
  const t = rec.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
  return `${rec.year ?? 'nd'}-${t || 'record'}`
}

export interface RecordOutcome {
  title: string
  ok: boolean
  slug?: string
  error?: string
}

export async function importRecords(
  entries: RecordEntry[],
  rawCategory: string,
  send: (ev: string, payload: unknown) => void
): Promise<RecordOutcome[]> {
  const s = getSettings()
  const libPapers = path.join(s.libraryPath, 'papers')
  fs.mkdirSync(libPapers, { recursive: true })
  const catName = sanitizeCategoryName(rawCategory || 'inbox') || 'inbox'
  let dir = catName === 'inbox' ? path.join(libPapers, '99-inbox') : findCategoryDir(libPapers, catName)
  if (!dir) dir = nextCategoryDir(libPapers, catName)
  fs.mkdirSync(dir, { recursive: true })

  const outcomes: RecordOutcome[] = []
  for (let i = 0; i < entries.length; i++) {
    const rec = entries[i]
    send('records:progress', { done: i, total: entries.length, current: rec.title })
    const oc: RecordOutcome = { title: rec.title, ok: false }
    try {
      let slug = slugOf(rec)
      let dest = path.join(dir, slug)
      let k = 2
      while (fs.existsSync(dest)) slug = `${slugOf(rec)}-${k++}`, dest = path.join(dir, slug)
      fs.mkdirSync(dest, { recursive: true })
      fs.writeFileSync(path.join(dest, 'paper.pdf'), await titlePagePdf(rec))
      const q = (v: string): string => v.replace(/"/g, "'")
      const md = [
        '---',
        `title: "${q(rec.title)}"`,
        `authors: "${q(rec.authors)}"`,
        `year: ${rec.year ?? 'null'}`,
        `venue: "${q(rec.venue)}"`,
        ...(rec.doi ? [`doi: "${q(rec.doi)}"`] : []),
        'source: 题录导入',
        'tags: [status/unread, no-pdf]',
        'status: unread',
        '---',
        '',
        `# ${rec.title}`,
        '',
        `- **作者:** ${rec.authors || '（待补全）'}`,
        `- **发表:** ${rec.venue || ''}${rec.year ? ` · ${rec.year}` : ''}`,
        ...(rec.doi ? [`- **DOI:** ${rec.doi}`] : []),
        '',
        '## 摘要',
        '',
        rec.abstract || '（题录中未包含摘要）',
        ''
      ].join('\n')
      fs.writeFileSync(path.join(dest, `${slug}.md`), md)
      oc.ok = true
      oc.slug = slug
    } catch (err) {
      oc.error = String(err)
    }
    outcomes.push(oc)
    send('records:file', oc)
  }
  send('records:progress', { done: entries.length, total: entries.length, current: '' })
  scanLibrary(s.libraryPath)
  return outcomes
}
