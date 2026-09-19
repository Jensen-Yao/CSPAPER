import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

export interface Paper {
  id: number
  slug: string
  title: string
  authors: string
  year: number | null
  venue: string
  category: string
  path: string
  status: string
  n_pages: number
  indexed: number
  added_at: string
  opened_at?: string | null
  summary?: string | null
  doi?: string | null
  abstract?: string | null
  item_type?: string | null
  last_page?: number
  read_seconds?: number
  cited_by?: number | null
  jcr?: string | null
  csl?: string | null
  // 标签名数组（listPapers 聚合填充，非 DB 列）
  tags?: string[]
}

export type Theme = 'system' | 'light' | 'dark'

// 多服务商配置（与渲染端 types.ts 的 ProviderProfile 保持一致）
export interface ProviderProfile {
  provider: string
  apiBase: string
  apiKey: string
  models: string[]
}

export interface Settings {
  libraryPath: string
  apiBase: string
  apiKey: string
  model: string
  provider: string
  embedProvider: 'local' | 'zhipu' | 'ollama'
  ollamaUrl: string
  ollamaEmbedModel: string
  translateTarget: string
  theme: Theme
  setupDone: boolean
  models: string[]
  thinkingLevel: 'default' | 'off' | 'low' | 'medium' | 'high'
  profiles?: ProviderProfile[]
  // 导入重命名模板（W9）：{author} {year} {title} 占位符
  renameTemplate?: string
  // 关闭窗口时最小化到托盘而非退出（W10）
  closeToTray?: boolean
  // 被停用的抓取脚本 id（W13）
  disabledTranslators?: string[]
}

// 默认文献库：跟随平台放到「文档」目录（开发态 app 未 ready 前不能调 getPath，惰性求值）
let defaultLibraryPath: string | null = null
export function defaultLibrary(): string {
  if (!defaultLibraryPath) defaultLibraryPath = path.join(app.getPath('documents'), 'CSPAPER')
  return defaultLibraryPath
}

const DEFAULTS: Settings = {
  libraryPath: '', // 由 initDb 填充（依赖 app ready）
  apiBase: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.5-air',
  provider: 'zhipu',
  embedProvider: 'local',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaEmbedModel: 'bge-m3',
  translateTarget: '中文',
  theme: 'system',
  setupDone: false,
  models: [],
  thinkingLevel: 'default',
  renameTemplate: '{title}',
  closeToTray: false,
  disabledTranslators: []
}

let db: Database.Database

export function initDb(): void {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  db = new Database(path.join(dir, 'cspaper.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE, title TEXT, authors TEXT DEFAULT '',
      year INTEGER, venue TEXT DEFAULT '', category TEXT DEFAULT '',
      path TEXT UNIQUE, status TEXT DEFAULT 'unread',
      n_pages INTEGER DEFAULT 0, indexed INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chunks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      page INTEGER, ord INTEGER, text TEXT, vec BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_paper ON chunks(paper_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, paper_id UNINDEXED, page UNINDEXED, tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS highlights(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      page INTEGER, rects TEXT, text TEXT DEFAULT '',
      color TEXT DEFAULT 'yellow',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hl_paper ON highlights(paper_id);
  `)
  // 迁移：papers 增加 pvec（整篇级向量：标题+作者+首页）与 opened_at（最近打开时间）
  const cols = (db.prepare('PRAGMA table_info(papers)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('pvec')) db.exec('ALTER TABLE papers ADD COLUMN pvec BLOB')
  if (!cols.includes('opened_at')) db.exec('ALTER TABLE papers ADD COLUMN opened_at TEXT')
  if (!cols.includes('summary')) db.exec('ALTER TABLE papers ADD COLUMN summary TEXT')
  // v0.6.0：元数据扩展（DOI/摘要/条目类型）、阅读进度与统计、影响因子/被引、CSL-JSON 原文
  for (const col of [
    'doi TEXT',
    'abstract TEXT',
    'item_type TEXT',
    'last_page INTEGER DEFAULT 0',
    'read_seconds INTEGER DEFAULT 0',
    'cited_by INTEGER',
    'jcr TEXT',
    'csl TEXT',
    // 增量扫描门控：文件未变（mtime+size 相同）跳过 md 解析与 upsert
    'file_mtime INTEGER',
    'file_size INTEGER',
    'md_mtime INTEGER',
    'md_size INTEGER'
  ]) {
    if (!cols.includes(col.split(' ')[0])) db.exec(`ALTER TABLE papers ADD COLUMN ${col}`)
  }
  // 导入去重指纹（内容 sha1 + 大小）
  db.exec(`CREATE TABLE IF NOT EXISTS import_fp(
    fp TEXT PRIMARY KEY,
    added_at TEXT DEFAULT (datetime('now'))
  );`)
  // 标签系统（对标 Zotero Style / actions-tags）
  db.exec(`CREATE TABLE IF NOT EXISTS tags(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    color TEXT DEFAULT '#c4a882'
  );
  CREATE TABLE IF NOT EXISTS paper_tags(
    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(paper_id, tag_id)
  );`)
  // AI 文献卡片小结 / 对比表格
  db.exec(`CREATE TABLE IF NOT EXISTS compare_tables(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );`)
  // 整篇级全文索引：标题/作者/出处可被 BM25 直接命中（块索引只含正文，标题查不到）
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    title, authors, venue, slug, tokenize='trigram'
  );`)
  // 清理孤儿块（外键级联默认关闭，删除论文行后块会残留）
  db.exec('DELETE FROM chunks WHERE paper_id NOT IN (SELECT id FROM papers)')
  db.exec('DELETE FROM chunks_fts WHERE paper_id NOT IN (SELECT id FROM papers)')
  db.exec('DELETE FROM papers_fts WHERE rowid NOT IN (SELECT id FROM papers)')

  const st = db.prepare("SELECT value FROM meta WHERE key='settings'")
  if (!st.get()) {
    db.prepare("INSERT INTO meta(key,value) VALUES('settings',?)").run(
      JSON.stringify({ ...DEFAULTS, libraryPath: defaultLibrary() })
    )
  } else {
    // 迁移：旧版本写死的 macOS 路径在 Windows 上必然失效。
    // 优先探测同名库目录在 Windows 的常见位置（iCloud for Windows 同步盘），保住已扫描的文献。
    const s = getSettings()
    if (s.libraryPath.startsWith('/Users/') && !fs.existsSync(s.libraryPath)) {
      const home = app.getPath('home')
      const lastSeg = s.libraryPath.split('/').filter(Boolean).pop() ?? 'Library'
      const candidates = [path.join(home, 'iCloudDrive', lastSeg), path.join(home, lastSeg)]
      const moved = candidates.find((c) => fs.existsSync(c)) ?? defaultLibrary()
      db.prepare("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify({ ...s, libraryPath: moved }))
    }
  }
}

export function getSettings(): Settings {
  const row = db.prepare("SELECT value FROM meta WHERE key='settings'").get() as { value: string }
  return { ...DEFAULTS, ...JSON.parse(row.value) }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  db.prepare("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify(next))
  return next
}

export function getMeta(key: string): string | null {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined
  return r ? r.value : null
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}

export function getDb(): Database.Database {
  return db
}

// ---------- 库扫描：papers/<分类>/<slug>/paper.pdf + <slug>.md ----------
function parseNote(mdPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = fs.readFileSync(mdPath, 'utf8')
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)
    if (fm) {
      const lines = fm[1].split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\w[\w-]*):\s*(.*)$/)
        if (m) {
          let v = m[2].trim()
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
          else if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).replace(/["']/g, '')
          // 多行字符串（如 title: | 或换行引号）拼后续行
          if (v === '|' || v === '>') {
            const parts: string[] = []
            while (i + 1 < lines.length && /^\s{2,}/.test(lines[i + 1])) parts.push(lines[++i].trim())
            v = parts.join(' ')
          }
          out[m[1]] = v
        }
      }
    }
    const h1 = raw.match(/^# (.+)$/m)
    if (h1 && !out.title) out.title = h1[1].trim()
  } catch {
    /* md 缺失就只用文件夹名 */
  }
  return out
}

export interface ScanResult {
  added: number
  updated: number
  total: number
}

export function scanLibrary(libPath: string): ScanResult {
  const res: ScanResult = { added: 0, updated: 0, total: 0 }
  if (!fs.existsSync(libPath)) return res
  const papersDir = path.join(libPath, 'papers')
  const roots = fs.existsSync(papersDir) ? [papersDir] : [libPath]
  const upsert = db.prepare(`
    INSERT INTO papers(slug,title,authors,year,venue,category,path,doi)
    VALUES(@slug,@title,@authors,@year,@venue,@category,@path,@doi)
    ON CONFLICT(path) DO UPDATE SET
      slug=excluded.slug, title=excluded.title, authors=excluded.authors,
      year=excluded.year, venue=excluded.venue, category=excluded.category,
      doi=COALESCE(NULLIF(excluded.doi,''), papers.doi)
  `)
  const exists = db.prepare('SELECT id FROM papers WHERE path=?')
  const slugOwner = db.prepare('SELECT id, path FROM papers WHERE slug=?')
  const alignPath = db.prepare('UPDATE papers SET path=? WHERE id=?')
  const statUpd = db.prepare('UPDATE papers SET file_mtime=?, file_size=?, md_mtime=?, md_size=? WHERE id=?')
  const catUpd = db.prepare('UPDATE papers SET category=? WHERE id=?')
  // 增量门控索引：path（归一化）→ 已存行。文件与 md 的 mtime+size 都没变就跳过解析
  const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  const existing = new Map<
    string,
    { id: number; category: string; file_mtime: number | null; file_size: number | null; md_mtime: number | null; md_size: number | null }
  >()
  for (const r of db.prepare('SELECT id, path, category, file_mtime, file_size, md_mtime, md_size FROM papers').all() as Array<{
    id: number
    path: string
    category: string
    file_mtime: number | null
    file_size: number | null
    md_mtime: number | null
    md_size: number | null
  }>) {
    existing.set(norm(r.path), r)
  }
  // 同一文件判定：resolve 归一化分隔符；Windows 再忽略大小写（iCloud 同步可能改写盘符/大小写）
  const samePath = (a: string, b: string): boolean =>
    process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
  // slug 全库唯一：同一 slug 出现在不同路径（重复导入/移动残留）时自动加后缀，避免整个扫描崩溃
  const uniqueSlug = (slug: string, pdf: string): string => {
    const row = slugOwner.get(slug) as { id: number; path: string } | undefined
    if (!row) return slug
    if (samePath(row.path, pdf)) {
      // 指向同一文件但字符串不一致（分隔符/大小写差异）：先把行路径对齐成扫描值，
      // 让 upsert 走 ON CONFLICT(path) 更新，而不是 INSERT 撞 slug 唯一约束
      if (row.path !== pdf) alignPath.run(pdf, row.id)
      return slug
    }
    for (let n = 2; ; n++) {
      const cand = `${slug}-${n}`
      const r2 = slugOwner.get(cand) as { id: number; path: string } | undefined
      if (!r2) return cand
      if (samePath(r2.path, pdf)) {
        if (r2.path !== pdf) alignPath.run(pdf, r2.id)
        return cand
      }
    }
  }
  const upsertOne = (params: Record<string, unknown>, pdf: string, mdPath: string, prevCat: string | undefined, fmTags: string): void => {
    try {
      let pstat: fs.Stats | null = null
      let mstat: fs.Stats | null = null
      try {
        pstat = fs.statSync(pdf)
      } catch { /* pdf 已消失则照常走旧路径 */ }
      try {
        mstat = fs.statSync(mdPath)
      } catch { /* md 缺失视为未变（md_mtime=0） */ }
      const prev = existing.get(norm(pdf))
      if (pstat && prev && prevCat !== undefined) {
        const mt = Math.round(pstat.mtimeMs)
        const mtMd = mstat ? Math.round(mstat.mtimeMs) : 0
        // 文件与 md 都未变：跳过解析与 upsert（增量扫描的核心，千篇库省数百 ms）
        if (prev.file_mtime === mt && prev.file_size === pstat.size && prev.md_mtime === mtMd && prev.md_size === (mstat?.size ?? 0)) {
          if (prevCat !== params.category) catUpd.run(params.category, prev.id)
          res.total++
          return
        }
      }
      // 先判存在再 upsert：新路径算「新增」，已有路径算「更新」（重扫描据此通知界面刷新）
      const existed = !!exists.get(pdf)
      const r = upsert.run(params)
      const id = existed ? ((exists.get(pdf) as { id: number }).id) : Number(r.lastInsertRowid)
      statUpd.run(pstat ? Math.round(pstat.mtimeMs) : 0, pstat?.size ?? 0, mstat ? Math.round(mstat.mtimeMs) : 0, mstat?.size ?? 0, id)
      // csl 侧车（translator 导入留下的完整 CSL-JSON）：重扫时保持 DB 元数据同步
      try {
        const dir = path.dirname(pdf)
        const sidecar = path.join(dir, `${path.basename(dir)}.csl.json`)
        const raw = fs.readFileSync(sidecar, 'utf8')
        if (raw.length <= 200_000) {
          const csl = JSON.parse(raw) as { abstract?: unknown; type?: unknown }
          db.prepare('UPDATE papers SET csl=?, abstract=COALESCE(NULLIF(?,""), abstract), item_type=? WHERE id=?').run(
            raw,
            typeof csl.abstract === 'string' ? csl.abstract.slice(0, 4000) : '',
            String(csl.type ?? ''),
            id
          )
        }
      } catch {
        /* 无侧车文件（绝大多数条目） */
      }
      // md frontmatter 的 tags 落库（Zotero 导入/手写的标签自动生效）
      syncPaperTags(id, fmTags)
      if (existed) res.updated++
      else res.added++
      res.total++
    } catch (err) {
      // 单条失败（如并发改写导致约束冲突）不拖垮整个扫描与后续清理
      console.error(`[scan] ${String(params.slug)} 入库失败:`, err)
    }
  }
  for (const root of roots) {
    // 根目录平铺的 PDF 也收进库（category 用根目录名），适配"直接指向一摞论文"的用法
    for (const f of fs.readdirSync(root)) {
      if (!f.toLowerCase().endsWith('.pdf')) continue
      const pdf = path.join(root, f)
      if (!fs.statSync(pdf).isFile()) continue
      const slug = f.slice(0, -4)
      const note = parseNote(path.join(root, `${slug}.md`))
      const year = parseInt(note.year || slug.slice(0, 4), 10) || null
      const dtitle = note.title || slug.replace(/^\d{4}-/, '').replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      upsertOne(
        {
          slug: uniqueSlug(slug, pdf),
          title: dtitle,
          authors: note.authors || '',
          year,
          venue: note.venue || '',
          category: path.basename(root) || 'inbox',
          path: pdf,
          doi: note.doi || ''
        },
        pdf,
        path.join(root, `${slug}.md`),
        existing.get(norm(pdf))?.category,
        note.tags ?? ''
      )
    }
    for (const cat of fs.readdirSync(root)) {
      const catDir = path.join(root, cat)
      if (!fs.statSync(catDir).isDirectory() || cat.startsWith('.')) continue
      for (const slug of fs.readdirSync(catDir)) {
        const d = path.join(catDir, slug)
        if (!fs.statSync(d).isDirectory() || slug.startsWith('.')) continue
        let pdf = path.join(d, 'paper.pdf')
        if (!fs.existsSync(pdf)) {
          const any = fs.readdirSync(d).find((f) => f.toLowerCase().endsWith('.pdf'))
          if (!any) continue
          pdf = path.join(d, any)
        }
        const note = parseNote(path.join(d, `${slug}.md`))
        const year = parseInt(note.year || slug.slice(0, 4), 10) || null
        const dtitle = note.title || slug.replace(/^\d{4}-/, '').replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        upsertOne(
          {
            slug: uniqueSlug(slug, pdf),
            title: dtitle,
            authors: note.authors || '',
            year,
            venue: note.venue || '',
            category: cat.replace(/^\d+-/, ''),
            path: pdf,
            doi: note.doi || ''
          },
          pdf,
          path.join(d, `${slug}.md`),
          existing.get(norm(pdf))?.category,
          note.tags ?? ''
        )
      }
    }
  }
  // 清掉磁盘上已不存在的论文行：目录改名/手动移动后，旧路径行不清理的话
  // 列表会新旧并存“翻倍”，且新行 indexed=0 会触发整批重新嵌入。
  // 按论文文件夹（slug 目录）判断存在性——iCloud/网盘占位文件只占文件本身，
  // 目录结构始终物化，不会误删未同步条目
  const stale = db.prepare('SELECT id, path FROM papers').all() as Array<{ id: number; path: string }>
  const delRow = db.prepare('DELETE FROM papers WHERE id=?')
  for (const row of stale) {
    try {
      if (!fs.existsSync(path.dirname(row.path))) delRow.run(row.id)
    } catch {
      /* 单行 stat 失败保守跳过 */
    }
  }
  return res
}

export function listPapers(): Paper[] {
  const rows = db.prepare('SELECT * FROM papers ORDER BY category, year, slug').all() as unknown as Paper[]
  // 标签聚合：一次查出全部映射，内存归并（比每行子查询快一个量级）
  let byPaper = new Map<number, string[]>()
  try {
    const links = db
      .prepare(
        `SELECT pt.paper_id, t.name FROM paper_tags pt JOIN tags t ON t.id=pt.tag_id ORDER BY t.name`
      )
      .all() as Array<{ paper_id: number; name: string }>
    byPaper = new Map()
    for (const l of links) {
      const arr = byPaper.get(l.paper_id) ?? []
      arr.push(l.name)
      byPaper.set(l.paper_id, arr)
    }
  } catch { /* tags 表尚未建好时忽略 */ }
  for (const r of rows) r.tags = byPaper.get(r.id) ?? []
  return rows
}

export function setStatus(id: number, status: string): void {
  db.prepare('UPDATE papers SET status=? WHERE id=?').run(status, id)
}

export function markOpened(id: number): void {
  db.prepare("UPDATE papers SET opened_at=datetime('now') WHERE id=?").run(id)
}

// ---------- 阅读进度与时长（W2 / W7） ----------
export function setLastPage(id: number, page: number): void {
  db.prepare('UPDATE papers SET last_page=max(COALESCE(last_page,0),?) WHERE id=?').run(Math.max(1, Math.floor(page)), id)
}

export function addReadSeconds(id: number, seconds: number): void {
  db.prepare('UPDATE papers SET read_seconds=COALESCE(read_seconds,0)+? WHERE id=?').run(Math.max(0, Math.floor(seconds)), id)
}

// ---------- 标签系统（W1，对标 Zotero Style / actions-tags） ----------
export interface TagRow {
  id: number
  name: string
  color: string
  count: number
}

const TAG_COLORS = ['#c4a882', '#7a9e7e', '#b0654a', '#6b7fa3', '#a37f9e', '#8a8f6a', '#b08d57', '#7e9aa3']

export function listTags(): TagRow[] {
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(pt.paper_id) AS count
       FROM tags t LEFT JOIN paper_tags pt ON pt.tag_id=t.id
       GROUP BY t.id ORDER BY t.name`
    )
    .all() as TagRow[]
}

export function createTag(name: string, color?: string): TagRow {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('标签名不能为空')
  const c = color || TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
  db.prepare('INSERT INTO tags(name,color) VALUES(?,?) ON CONFLICT(name) DO NOTHING').run(n, c)
  const row = db.prepare('SELECT id, name, color FROM tags WHERE name=?').get(n) as { id: number; name: string; color: string }
  return { ...row, count: 0 }
}

export function renameTag(id: number, name: string): void {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('标签名不能为空')
  db.prepare('UPDATE tags SET name=? WHERE id=?').run(n, id)
}

export function deleteTag(id: number): void {
  db.prepare('DELETE FROM paper_tags WHERE tag_id=?').run(id)
  db.prepare('DELETE FROM tags WHERE id=?').run(id)
}

export function setTagColor(id: number, color: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('颜色格式无效')
  db.prepare('UPDATE tags SET color=? WHERE id=?').run(color, id)
}

export function paperTags(paperId: number): Array<{ id: number; name: string; color: string }> {
  return db
    .prepare('SELECT t.id, t.name, t.color FROM paper_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.paper_id=? ORDER BY t.name')
    .all(paperId) as Array<{ id: number; name: string; color: string }>
}

export function addPaperTag(paperId: number, name: string, color?: string): TagRow {
  const t = createTag(name, color)
  db.prepare('INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) VALUES(?,?)').run(paperId, t.id)
  const count = (db.prepare('SELECT COUNT(*) AS n FROM paper_tags WHERE tag_id=?').get(t.id) as { n: number }).n
  return { ...t, count }
}

export function removePaperTag(paperId: number, tagId: number): void {
  db.prepare('DELETE FROM paper_tags WHERE paper_id=? AND tag_id=?').run(paperId, tagId)
}

// md frontmatter tags 落库：全量替换该论文的标签（扫描驱动，md 是唯一事实来源）
export function syncPaperTags(paperId: number, raw: string): void {
  const names = raw
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('status/')) // status/xxx 是阅读状态标记，不进标签系统
  const cur = paperTags(paperId)
  const want = new Set(names)
  const have = new Set(cur.map((t) => t.name))
  let dirty = want.size !== cur.length || names.some((n) => !have.has(n))
  if (!dirty) return
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM paper_tags WHERE paper_id=?').run(paperId)
    for (const n of want) {
      const t = createTag(n)
      db.prepare('INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) VALUES(?,?)').run(paperId, t.id)
    }
  })
  tx()
}

// ---------- 分类（目录）名集合：论文行已有的 + 手动新建的空分类 ----------
// 空分类目录里没有论文，扫描发现不了，单独存在 meta 里让侧栏/移动菜单可见
export function getExtraCats(): string[] {
  const r = db.prepare("SELECT value FROM meta WHERE key='extra_cats'").get() as { value: string } | undefined
  if (!r) return []
  try {
    const v = JSON.parse(r.value)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function setExtraCats(cats: string[]): void {
  db.prepare("INSERT INTO meta(key,value) VALUES('extra_cats',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    JSON.stringify([...new Set(cats)])
  )
}

export function listCategoryNames(): string[] {
  const fromPapers = (db.prepare("SELECT DISTINCT category FROM papers WHERE category<>''").all() as Array<{ category: string }>).map(
    (r) => r.category
  )
  return [...new Set([...fromPapers, ...getExtraCats()])].sort((a, b) => a.localeCompare(b))
}
