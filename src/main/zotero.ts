// Zotero 文献库导入：读取 Zotero 数据目录下的 zotero.sqlite（只读副本），
// 把条目元数据 + PDF 附件 + 分类（collection → CSPAPER 分类）迁入本地文献库。
// 兼容 Zotero 7 / 6：默认数据目录与 prefs.js 指定目录都支持；Zotero 正在运行时通过
// 复制数据库副本规避文件锁与 WAL 未合并问题。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { getSettings, scanLibrary } from './db'
import { sanitizeCategoryName, findCategoryDir, nextCategoryDir } from './import'

export interface ZoteroPaper {
  key: string
  itemType: string
  title: string
  authors: string
  year: number | null
  venue: string
  collections: string[]
  pdf: string // PDF 附件绝对路径
}

export interface ZoteroDetectResult {
  dataDir: string | null
  candidates: string[]
}

export interface ZoteroPreviewResult {
  dataDir: string
  items: ZoteroPaper[]
  error?: string
}

export interface ZoteroImportItem {
  key: string
  // 目标分类：空 = 用条目在 Zotero 里的第一个分类；'inbox' = 未分类
  category?: string
}

export interface ZoteroOutcome {
  key: string
  title: string
  ok: boolean
  category?: string
  skipped?: boolean // 库里已有同 key 文献，跳过避免重复导入
  error?: string
}

const PDF_TYPES = new Set([
  'journalArticle',
  'conferencePaper',
  'preprint',
  'report',
  'thesis',
  'book',
  'bookSection',
  'manuscript',
  'document',
  'dictionaryEntry',
  'encyclopediaArticle'
])

function eqName(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

// ---------- 数据目录探测 ----------
// 1) 各平台 Zotero profile 的 prefs.js 里 extensions.zotero.dataDir；2) 常见默认路径
export function detectZoteroDataDir(): ZoteroDetectResult {
  const home = os.homedir()
  const candidates: string[] = []
  const profileRoots: string[] = []
  if (process.platform === 'win32') {
    profileRoots.push(path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Zotero', 'Zotero', 'Profiles'))
  } else if (process.platform === 'darwin') {
    profileRoots.push(path.join(home, 'Library', 'Application Support', 'Zotero', 'Profiles'))
  } else {
    profileRoots.push(path.join(home, '.zotero', 'Profiles'))
  }
  for (const root of profileRoots) {
    try {
      for (const p of fs.readdirSync(root)) {
        const prefs = path.join(root, p, 'prefs.js')
        if (!fs.existsSync(prefs)) continue
        const m = fs.readFileSync(prefs, 'utf8').match(/user_pref\("extensions\.zotero\.dataDir",\s*"((?:[^"\\]|\\.)*)"\)/)
        if (m) candidates.push(m[1].replace(/\\(.)/g, '$1'))
      }
    } catch {
      /* 无 profile 目录 */
    }
  }
  candidates.push(path.join(home, 'Zotero'), path.join(home, 'Documents', 'Zotero'))
  const dataDir = candidates.find((c) => c && fs.existsSync(path.join(c, 'zotero.sqlite'))) ?? null
  return { dataDir, candidates }
}

// ---------- 预览：读取副本库，列出可导入条目 ----------
interface ZoteroRow {
  itemID: number
  key: string
  typeName: string
}

export function previewZotero(dataDirRaw?: string): ZoteroPreviewResult {
  const detected = dataDirRaw?.trim() || detectZoteroDataDir().dataDir
  if (!detected) return { dataDir: '', items: [], error: '未找到 Zotero 数据目录（可手动选择）' }
  const dataDir = detected
  const sqlite = path.join(dataDir, 'zotero.sqlite')
  if (!fs.existsSync(sqlite)) return { dataDir, items: [], error: '该目录下没有 zotero.sqlite' }

  // 复制主库与 WAL/SHM 到临时目录再打开：Zotero 运行中也不受锁影响，WAL 里未合并的数据不丢
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-zotero-'))
  for (const suffix of ['', '-wal', '-shm']) {
    const src = `${sqlite}${suffix}`
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, `zotero.sqlite${suffix}`))
  }
  let db: Database.Database
  try {
    db = new Database(path.join(tmp, 'zotero.sqlite'), { readonly: true })
  } catch (err) {
    return { dataDir, items: [], error: `无法读取 zotero.sqlite：${String(err)}` }
  }

  try {
    const rows = db
      .prepare(
        `SELECT i.itemID AS itemID, i.key AS key, it.typeName AS typeName
         FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
         WHERE it.typeName IN (${[...PDF_TYPES].map(() => '?').join(',')})
           AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID = i.itemID)`
      )
      .all(...PDF_TYPES) as ZoteroRow[]

    const fieldStmt = db.prepare(
      `SELECT f.fieldName AS name, v.value AS value
       FROM itemData d JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID
       WHERE d.itemID = ?`
    )
    const creatorStmt = db.prepare(
      `SELECT c.firstName AS firstName, c.lastName AS lastName
       FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID
       WHERE ic.itemID = ? ORDER BY ic.orderIndex`
    )
    const attStmt = db.prepare(
      `SELECT a.itemID AS itemID, a.linkMode AS linkMode, a.path AS path, i.key AS key
       FROM itemAttachments a JOIN items i ON i.itemID = a.itemID
       WHERE a.parentItemID = ? AND a.contentType = 'application/pdf'
         AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID = a.itemID)`
    )
    const collStmt = db.prepare(
      `SELECT c.collectionName AS name FROM collectionItems ci JOIN collections c ON c.collectionID = ci.collectionID
       WHERE ci.itemID = ? ORDER BY c.collectionName`
    )

    const items: ZoteroPaper[] = []
    for (const row of rows) {
      const fields: Record<string, string> = {}
      for (const f of fieldStmt.all(row.itemID) as Array<{ name: string; value: string }>) fields[f.name] = f.value
      const title = (fields.title || fields.bookTitle || fields.caseName || '').replace(/\s+/g, ' ').trim()
      if (!title) continue

      // PDF 附件：imported_file（storage:<文件名>，文件在 storage/<附件key>/ 下）或 linked_file（绝对路径）
      let pdf = ''
      for (const att of attStmt.all(row.itemID) as Array<{ itemID: number; linkMode: number; path: string; key: string }>) {
        let p = ''
        if ((att.linkMode === 0 || att.linkMode === 1) && att.path?.startsWith('storage:')) {
          p = path.join(dataDir, 'storage', att.key, att.path.slice('storage:'.length))
        } else if (att.linkMode === 2 && att.path && path.isAbsolute(att.path)) {
          p = att.path
        }
        if (p && fs.existsSync(p)) {
          pdf = p
          break
        }
      }
      if (!pdf) continue // 没有 PDF 附件或文件缺失的条目不导入

      const authors = (creatorStmt.all(row.itemID) as Array<{ firstName: string; lastName: string }>)
        .map((c) => `${c.firstName} ${c.lastName}`.trim())
        .filter(Boolean)
        .join(', ')
      const year = parseInt((fields.date ?? '').match(/(19|20)\d{2}/)?.[0] ?? '', 10) || null
      const venue = fields.publicationTitle || fields.proceedingsTitle || fields.bookTitle || fields.publisher || ''
      const collections = (collStmt.all(row.itemID) as Array<{ name: string }>).map((c) => c.name)

      items.push({ key: row.key, itemType: row.typeName, title, authors, year, venue, collections, pdf })
    }
    items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title))
    return { dataDir, items }
  } catch (err) {
    return { dataDir, items: [], error: `解析 Zotero 库失败：${String(err)}` }
  } finally {
    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- 导入 ----------
const eqKey = (dirName: string, key: string): boolean => dirName.toLowerCase().endsWith(`-${key.toLowerCase()}`)

function noteMd(p: ZoteroPaper): string {
  const q = (s: string): string => s.replace(/"/g, "'")
  return `---\ntitle: "${q(p.title)}"\nauthors: "${q(p.authors)}"\nyear: ${p.year ?? 'null'}\nvenue: "${q(p.venue)}"\nzotero: "${p.key}"\ntags: [status/unread]\nstatus: unread\n---\n\n# ${p.title}\n\n- **作者:** ${p.authors || '（作者见原文）'}\n- **发表:** ${p.venue || `${p.year ?? ''}（待核实）`}\n- **来源:** Zotero 导入（key: ${p.key}）\n`
}

export async function importFromZotero(
  selected: ZoteroImportItem[],
  send: (ev: string, payload: unknown) => void
): Promise<ZoteroOutcome[]> {
  const cache = lastPreview
  if (!cache || cache.items.length === 0) throw new Error('请先完成 Zotero 库预览再导入')
  const byKey = new Map(cache.items.map((it) => [it.key, it]))
  const s = getSettings()
  const libPapers = path.join(s.libraryPath, 'papers')
  fs.mkdirSync(libPapers, { recursive: true })

  const outcomes: ZoteroOutcome[] = []
  for (let i = 0; i < selected.length; i++) {
    const sel = selected[i]
    const item = byKey.get(sel.key)
    const title = item?.title ?? sel.key
    send('zotero:progress', { done: i, total: selected.length, current: title })
    const oc: ZoteroOutcome = { key: sel.key, title, ok: false }
    try {
      if (!item) throw new Error('预览数据过期，请重新预览')
      // 目标分类：用户明确选择（含「未分类」）优先；未选择时沿用 Zotero 的第一个分类；分类名保留中文
      const manual = sanitizeCategoryName(sel.category ?? '')
      const catName = manual ? (manual === 'inbox' ? 'inbox' : manual) : sanitizeCategoryName(item.collections[0] ?? '') || 'inbox'
      let dir = catName === 'inbox' ? path.join(libPapers, '99-inbox') : findCategoryDir(libPapers, catName)
      if (!dir) dir = nextCategoryDir(libPapers, catName)
      fs.mkdirSync(dir, { recursive: true })
      // 去重：同分类下已有以 -<key> 结尾的文件夹说明导入过，跳过
      const existing = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => eqKey(d, item.key)) : undefined
      if (existing) {
        oc.ok = true
        oc.skipped = true
        oc.category = path.basename(dir).replace(/^\d+-/, '')
        outcomes.push(oc)
        send('zotero:file', oc)
        continue
      }
      const slug = `${item.year ?? 'nd'}-${item.key.toLowerCase()}`
      const dest = path.join(dir, slug)
      fs.mkdirSync(dest, { recursive: true })
      fs.copyFileSync(item.pdf, path.join(dest, 'paper.pdf'))
      fs.writeFileSync(path.join(dest, `${slug}.md`), noteMd(item))
      oc.ok = true
      oc.category = path.basename(dir).replace(/^\d+-/, '')
    } catch (err) {
      oc.error = String(err)
    }
    outcomes.push(oc)
    send('zotero:file', oc)
  }
  send('zotero:progress', { done: selected.length, total: selected.length, current: '' })
  scanLibrary(s.libraryPath)
  return outcomes
}

// 预览结果缓存：导入按 key 取条目；预览数据过期（数据目录被移动等）时报错提示重新预览
let lastPreview: ZoteroPreviewResult | null = null

// IPC 预览入口：缓存完整结果供导入使用，并返回给界面展示
export function previewZoteroForUi(dataDir?: string): ZoteroPreviewResult {
  lastPreview = previewZotero(dataDir)
  return lastPreview
}
