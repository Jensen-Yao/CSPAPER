import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { READING_STATUSES } from '../shared/paper'
import { collectLibrary, type LibraryInventory } from './library-inventory'
import { applyLibraryInventory, applyLibraryInventoryAsync } from './library-store'
import { backupBeforeLibraryMigration, runMigrations } from './migrations'
import { recoverOperations } from './operations/journal'
import { normalizePath, parseList, patchFrontmatter, readPaperMarkdown, writeFilesAtomically } from './paper-files'

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
  source_kind: 'pdf' | 'record'
  chunk_count?: number
  added_at: string
  opened_at?: string | null
  summary?: string | null
  doi?: string | null
  abstract?: string | null
  item_type?: string | null
  file_mtime?: number
  file_size?: number
  furthest_page?: number
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
export type { ModelCaps, ProviderProfile } from '../shared/settings-models'
import type { ProviderProfile } from '../shared/settings-models'
import { normalizeModelSettings } from './model-config'

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
  thinkingLevel: string
  profiles?: ProviderProfile[]
  modelBindingId?: string
  agentModelBindingId?: string
  // 导入重命名模板（W9）：{author} {year} {title} 占位符
  renameTemplate?: string
  // 关闭窗口时最小化到托盘而非退出（W10）
  closeToTray?: boolean
  // 被停用的抓取脚本 id（W13）
  disabledTranslators?: string[]
  // Zotero Web API（v0.9）：云端同步
  zoteroUserId?: string
  zoteroApiKey?: string
  // 启动时自动执行 Zotero 增量同步（v0.11）
  zoteroAutoSync?: boolean
  // 智能体（v0.11）：独立模型绑定与护栏参数
  agentModel?: string
  agentMaxSteps?: number
  agentTimeoutMinutes?: number
  agentGoal?: string
  imageModel?: string
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
  disabledTranslators: [],
  zoteroUserId: '',
  zoteroApiKey: '',
  zoteroAutoSync: false,
  agentModel: '',
  agentMaxSteps: 24,
  agentTimeoutMinutes: 10
}

let db: Database.Database

export function initDb(): void {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  db = new Database(path.join(dir, 'cspaper.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  backupBeforeLibraryMigration(db,dir)
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE, title TEXT, authors TEXT DEFAULT '',
      year INTEGER, venue TEXT DEFAULT '', category TEXT DEFAULT '',
      path TEXT UNIQUE, status TEXT DEFAULT 'unread',
      n_pages INTEGER DEFAULT 0, indexed INTEGER DEFAULT 0,
      source_kind TEXT NOT NULL DEFAULT 'pdf',
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
  // v0.13：标注增强——备注 + 语义标签（高亮色即标签：yellow=重要 blue=方法 green=结论 red=疑问）
  const hcols = (db.prepare('PRAGMA table_info(highlights)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!hcols.includes('comment')) db.exec('ALTER TABLE highlights ADD COLUMN comment TEXT')
  if (!hcols.includes('tag')) db.exec("ALTER TABLE highlights ADD COLUMN tag TEXT DEFAULT ''")
  // 迁移：papers 增加 pvec（整篇级向量：标题+作者+首页）与 opened_at（最近打开时间）
  const cols = (db.prepare('PRAGMA table_info(papers)').all() as Array<{ name: string }>).map((c) => c.name)
  // v0.15.2：结构化元数据（卷/期/页/出版社/语言 + 结构化作者）与软删除
  for (const col of [
    'volume TEXT', 'issue TEXT', 'pages TEXT', 'publisher TEXT', 'language TEXT',
    'creators TEXT',            // [{family,given}] JSON，兼容旧 authors 字符串
    'deleted_at TEXT'           // 软删除（回收站）
  ]) {
    if (!cols.includes(col.split(' ')[0])) db.exec(`ALTER TABLE papers ADD COLUMN ${col}`)
  }
  // 一次性回填：从 papers.csl JSON 侧车提取卷期页出版社到独立列
  try {
    const needBackfill = (db.prepare("SELECT COUNT(*) c FROM papers WHERE (volume IS NULL OR volume='') AND csl IS NOT NULL").get() as { c: number }).c
    if (needBackfill > 0) {
      const rows = db.prepare('SELECT id, csl FROM papers WHERE csl IS NOT NULL').all() as Array<{ id: number; csl: string }>
      const upd = db.prepare('UPDATE papers SET volume=?, issue=?, pages=?, publisher=?, language=? WHERE id=?')
      for (const r of rows) {
        try {
          const j = JSON.parse(r.csl) as Record<string, unknown>
          const g = (k: string): string => {
            const v = j[k]
            return v == null ? '' : String(v)
          }
          if (g('volume') || g('issue') || g('page') || g('publisher') || g('language')) {
            upd.run(g('volume'), g('issue'), g('page'), g('publisher'), g('language'), r.id)
          }
        } catch { /* csl 损坏跳过 */ }
      }
    }
  } catch { /* 回填失败不阻断启动 */ }
  // 多分类（逻辑归属；物理目录仍用 category 单值）
  db.exec(`CREATE TABLE IF NOT EXISTS collections(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS paper_collections(
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY(paper_id, collection_id)
  )`)
  // 保存的搜索（迁出 localStorage）
  db.exec(`CREATE TABLE IF NOT EXISTS standalone_notes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body_md TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS saved_searches(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    conditions TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)

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
  for (const column of ['library_root TEXT', 'source_stamp TEXT', 'missing_at TEXT', 'furthest_page INTEGER DEFAULT 0']) {
    if (!cols.includes(column.split(' ')[0])) db.exec(`ALTER TABLE papers ADD COLUMN ${column}`)
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_papers_library ON papers(library_root,deleted_at,missing_at);
    CREATE TABLE IF NOT EXISTS library_exclusions(path TEXT PRIMARY KEY,library_root TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS paper_related(paper_id INTEGER NOT NULL,related_id INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'manual',created_at TEXT DEFAULT (datetime('now','localtime')),PRIMARY KEY(paper_id,related_id));
    CREATE TABLE IF NOT EXISTS read_log(day TEXT,paper_id INTEGER,seconds INTEGER,PRIMARY KEY(day,paper_id));
    CREATE TABLE IF NOT EXISTS paper_attachments(paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,path TEXT,name TEXT,UNIQUE(paper_id,path));
    CREATE VIEW IF NOT EXISTS active_papers AS SELECT * FROM papers WHERE deleted_at IS NULL AND missing_at IS NULL
      AND library_root=(SELECT value FROM meta WHERE key='active_library');
  `)
  // 清理孤儿块（外键级联默认关闭，删除论文行后块会残留）
  db.exec('DELETE FROM chunks WHERE paper_id NOT IN (SELECT id FROM papers)')
  db.exec('DELETE FROM chunks_fts WHERE paper_id NOT IN (SELECT id FROM papers)')
  db.exec('DELETE FROM papers_fts WHERE rowid NOT IN (SELECT id FROM papers)')
  runMigrations(db)
  recoverOperations(db)

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
  const activeRoot = normalizePath(getSettings().libraryPath || defaultLibrary())
  setMeta('active_library', activeRoot)
  db.prepare("UPDATE papers SET library_root=? WHERE library_root IS NULL OR library_root=''").run(activeRoot)
}

export function getSettings(): Settings {
  const row = db.prepare("SELECT value FROM meta WHERE key='settings'").get() as { value: string }
  const parsed={ ...DEFAULTS, ...JSON.parse(row.value) } as Settings
  const normalized=normalizeModelSettings(parsed)
  if(JSON.stringify(parsed)!==JSON.stringify(normalized))db.prepare("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify(normalized))
  return normalized
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings()
  let next = { ...cur, ...patch }
  if(patch.model!==undefined&&patch.model!==cur.model&&patch.modelBindingId===undefined)next.modelBindingId=undefined
  if(patch.agentModel!==undefined&&patch.agentModel!==cur.agentModel&&patch.agentModelBindingId===undefined)next.agentModelBindingId=undefined
  // 防 Key 误清空：patch 显式传空串不能抹掉已配置的 Key（曾致用户的 agnes 配置丢失）
  // 想真正换 Key 必须传非空值；传 null 表示有意清除
  if (next.apiKey === '' && cur.apiKey) next.apiKey = cur.apiKey
  if (next.zoteroApiKey === '' && cur.zoteroApiKey) next.zoteroApiKey = cur.zoteroApiKey
  if(patch.profiles===undefined&&['apiBase','apiKey','provider','models'].some(key=>Object.hasOwn(patch,key))) {
    const profileId=cur.modelBindingId?.split(':')[0]
    next.profiles=cur.profiles?.map(profile=>profile.id===profileId?{...profile,apiBase:patch.apiBase??profile.apiBase,apiKey:patch.apiKey===null?'':patch.apiKey?patch.apiKey:profile.apiKey,provider:patch.provider??profile.provider,models:patch.models??[...new Set([...profile.models,...(patch.model?[patch.model]:[])])]}:profile)
  }
  next=normalizeModelSettings(next)
  db.prepare("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify(next))
  if (next.libraryPath) setMeta('active_library', normalizePath(next.libraryPath))
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

// Filesystem discovery is independent from SQLite reconciliation.
export type { ScanResult } from './library-store'
function scanStamps(root: string): Record<string, string> {
  return Object.fromEntries((db.prepare('SELECT path,source_stamp FROM papers WHERE library_root=?').all(normalizePath(root)) as Array<{path:string;source_stamp:string}>).map(p=>[normalizePath(p.path),p.source_stamp || '']))
}
export function scanLibrary(libPath: string): import('./library-store').ScanResult {
  return applyLibraryInventory(db, collectLibrary(libPath, scanStamps(libPath)))
}
export interface ScanLibraryOptions { signal?:AbortSignal; onProgress?:(found:number,current:string)=>void }
const pendingScans=new Map<string,Promise<import('./library-store').ScanResult>>()
let dbApplyChain:Promise<void>=Promise.resolve()
export function scanLibraryAsync(libPath:string,options:ScanLibraryOptions={}):Promise<import('./library-store').ScanResult> {
  const root=normalizePath(libPath),pending=pendingScans.get(root)
  if(pending) return pending
  options.signal?.throwIfAborted()
  const workerStarted=Date.now()
  const promise=new Promise<import('./library-store').ScanResult>((resolve,reject)=>{
    let releaseApply:()=>void=()=>{}
    const worker=new Worker(path.join(__dirname,'library-worker.js'),{workerData:{root:libPath,previous:scanStamps(libPath),dbFile:path.join(app.getPath('userData'),'cspaper.db')}})
    let aborted=false
    const abort=():void=>{
      aborted=true
      reject(new DOMException('文献库扫描已取消','AbortError'))
      void worker.terminate()
    }
    options.signal?.addEventListener('abort',abort,{once:true})
    worker.on('message',(message:{batch?:boolean;ready?:boolean;found?:number;ok?:boolean;result?:import('./library-store').ScanResult;timing?:{workerMs:number;applyMs:number};error?:string})=>{
      if(message.batch){options.onProgress?.(message.found??0,'');return}
      if(message.ready){
        // Discovery remains parallel; SQLite writers are serialized across roots.
        dbApplyChain=dbApplyChain.then(()=>new Promise<void>(resolve=>{
          releaseApply=resolve
          worker.postMessage({apply:true})
        }))
        return
      }
      if(message.ok){
        releaseApply()
        options.signal?.removeEventListener('abort',abort)
        resolve({...message.result!,timing:message.timing})
        return
      }
      if(!message.ok){
        options.signal?.removeEventListener('abort',abort)
        releaseApply()
        reject(new Error(message.error??'文献库扫描失败'))
      }
    })
    worker.once('error',error=>{options.signal?.removeEventListener('abort',abort);releaseApply();if(aborted)return;reject(error instanceof Error?error:new Error(String(error)))})
    worker.once('exit',code=>{
      options.signal?.removeEventListener('abort',abort)
      releaseApply()
      if(!aborted&&code!==0)reject(new Error('文献库扫描中断'))
    })
  })
  pendingScans.set(root,promise)
  promise.finally(()=>{pendingScans.delete(root)}).catch(()=>{})
  return promise
}

type RawStatement = ReturnType<Database.Database['prepare']>
let listPapersStatement: RawStatement | undefined
let listPaperTagsStatement: RawStatement | undefined
let listChunkCountsStatement: RawStatement | undefined
export function listPapers(): Paper[] {
  // The partial index supplies index order; raw rows avoid native property-bag construction for 29 columns.
  const statement=listPapersStatement ??=db.prepare("SELECT id, slug, title, authors, year, venue, category, path, status, n_pages, indexed, source_kind, added_at, opened_at, summary, doi, abstract, item_type, file_mtime, furthest_page, last_page, read_seconds, cited_by, jcr, volume, issue, pages, publisher, language, deleted_at, file_size FROM active_papers ORDER BY category, year, slug").raw()
  const rows=statement.all() as unknown[][]
  const chunkCounts=listChunkCountsStatement ??=db.prepare('SELECT paper_id, COUNT(*) AS n FROM chunks GROUP BY paper_id').raw()
  const chunkCountById=new Map<number,number>()
  for(const [paperId,count] of chunkCounts.all() as unknown[][]) chunkCountById.set(Number(paperId),Number(count))
  const tagsStatement=listPaperTagsStatement ??=db.prepare('SELECT pt.paper_id, t.name FROM paper_tags pt JOIN tags t ON t.id=pt.tag_id ORDER BY t.name').raw()
  const byPaper=new Map<number,string[]>()
  for(const [paperId,name] of tagsStatement.all() as unknown[][]) {
    const paperIdNumber=Number(paperId),names=byPaper.get(paperIdNumber) ?? []
    names.push(String(name));byPaper.set(paperIdNumber,names)
  }
  return rows.map(row=>({
    id:Number(row[0]),slug:String(row[1]),title:String(row[2]),authors:String(row[3]),year:row[4]===null?null:Number(row[4]),venue:String(row[5]),category:String(row[6]),path:String(row[7]),status:String(row[8]),n_pages:Number(row[9]),indexed:Number(row[10]),source_kind:row[11]==='record'?'record':'pdf',chunk_count:chunkCountById.get(Number(row[0]))??0,added_at:String(row[12]),opened_at:row[13]===null?null:String(row[13]),summary:row[14]===null?null:String(row[14]),doi:row[15]===null?null:String(row[15]),abstract:row[16]===null?null:String(row[16]),item_type:row[17]===null?null:String(row[17]),file_mtime:row[18]===null?undefined:Number(row[18]),furthest_page:row[19]===null?undefined:Number(row[19]),last_page:row[20]===null?undefined:Number(row[20]),read_seconds:row[21]===null?undefined:Number(row[21]),cited_by:row[22]===null?null:Number(row[22]),jcr:row[23]===null?null:String(row[23]),volume:row[24]===null?undefined:String(row[24]),issue:row[25]===null?undefined:String(row[25]),pages:row[26]===null?undefined:String(row[26]),publisher:row[27]===null?undefined:String(row[27]),language:row[28]===null?undefined:String(row[28]),deleted_at:row[29]===null?null:String(row[29]),file_size:row[30]===null?undefined:Number(row[30]),tags:byPaper.get(Number(row[0])) ?? []
  })) as Paper[]
}

export function setStatus(id: number, status: string): void {
  if (!(READING_STATUSES as readonly string[]).includes(status)) throw new Error('阅读状态无效')
  const paper = db.prepare('SELECT path,slug,title FROM active_papers WHERE id=?').get(id) as {path:string;slug:string;title:string}|undefined
  if(!paper) throw new Error('文献不存在')
  const doc=readPaperMarkdown(paper.path,paper.slug)
  writeFilesAtomically([{path:doc.path,content:patchFrontmatter(doc.raw || '# '+paper.title+'\n',{status})}],()=>{
    db.prepare('UPDATE papers SET status=?,source_stamp=NULL WHERE id=?').run(status,id)
  })
}

export function markOpened(id: number): void {
  db.prepare("UPDATE papers SET opened_at=datetime('now') WHERE id=?").run(id)
}

// ---------- 阅读进度与时长（W2 / W7） ----------
export function setLastPage(id: number, page: number): void {
  db.prepare('UPDATE papers SET last_page=?,furthest_page=max(COALESCE(furthest_page,0),?) WHERE id=?').run(Math.max(1,Math.floor(page)),Math.max(1,Math.floor(page)),id)
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
      `SELECT t.id, t.name, t.color, COUNT(p.id) AS count
       FROM tags t LEFT JOIN paper_tags pt ON pt.tag_id=t.id LEFT JOIN active_papers p ON p.id=pt.paper_id
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

function tagMarkdownEdit(id: number, names: string[]): { path:string; content:string } {
  const paper=db.prepare('SELECT path,slug,title FROM papers WHERE id=?').get(id) as {path:string;slug:string;title:string}|undefined
  if(!paper) throw new Error('文献不存在')
  const doc=readPaperMarkdown(paper.path,paper.slug)
  return {path:doc.path,content:patchFrontmatter(doc.raw || '# '+paper.title+'\n',{tags:names})}
}
export function renameTag(id: number, name: string): void {
  const n=name.trim().slice(0,40)
  if(!n) throw new Error('标签名不能为空')
  const old=db.prepare('SELECT name FROM tags WHERE id=?').get(id) as {name:string}|undefined
  if(!old) throw new Error('标签不存在')
  const conflict=db.prepare('SELECT id FROM tags WHERE name=? AND id<>?').get(n,id)
  if(conflict) throw new Error('已有同名标签，请使用其他名称')
  const ids=(db.prepare('SELECT paper_id FROM paper_tags WHERE tag_id=?').all(id) as Array<{paper_id:number}>).map(r=>r.paper_id)
  const edits=ids.map(pid=>tagMarkdownEdit(pid,paperTags(pid).map(t=>t.id===id?n:t.name)))
  writeFilesAtomically(edits,()=>db.transaction(()=>{
    db.prepare('UPDATE tags SET name=? WHERE id=?').run(n,id)
    for(const pid of ids) db.prepare('UPDATE papers SET source_stamp=NULL WHERE id=?').run(pid)
  })())
}
export function deleteTag(id: number): void {
  const ids=(db.prepare('SELECT paper_id FROM paper_tags WHERE tag_id=?').all(id) as Array<{paper_id:number}>).map(r=>r.paper_id)
  const edits=ids.map(pid=>tagMarkdownEdit(pid,paperTags(pid).filter(t=>t.id!==id).map(t=>t.name)))
  writeFilesAtomically(edits,()=>db.transaction(()=>{
    db.prepare('DELETE FROM paper_tags WHERE tag_id=?').run(id)
    db.prepare('DELETE FROM tags WHERE id=?').run(id)
    for(const pid of ids) db.prepare('UPDATE papers SET source_stamp=NULL WHERE id=?').run(pid)
  })())
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
  const names=[...new Set([...paperTags(paperId).map(t=>t.name),name.trim().slice(0,40)])]
  let result!:TagRow
  writeFilesAtomically([tagMarkdownEdit(paperId,names)],()=>db.transaction(()=>{
    result=createTag(name,color)
    db.prepare('INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) VALUES(?,?)').run(paperId,result.id)
    db.prepare('UPDATE papers SET source_stamp=NULL WHERE id=?').run(paperId)
  })())
  return {...result,count:(db.prepare('SELECT COUNT(*) n FROM paper_tags WHERE tag_id=?').get(result.id) as {n:number}).n}
}
export function removePaperTag(paperId: number, tagId: number): void {
  writeFilesAtomically([tagMarkdownEdit(paperId,paperTags(paperId).filter(t=>t.id!==tagId).map(t=>t.name))],()=>db.transaction(()=>{
    db.prepare('DELETE FROM paper_tags WHERE paper_id=? AND tag_id=?').run(paperId,tagId)
    db.prepare('UPDATE papers SET source_stamp=NULL WHERE id=?').run(paperId)
  })())
}

// md frontmatter tags 落库：全量替换该论文的标签（扫描驱动，md 是唯一事实来源）
export function syncPaperTags(paperId: number, raw: string): void {
  const names = parseList(raw)
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
  const fromPapers = (db.prepare("SELECT DISTINCT category FROM active_papers WHERE category<>''").all() as Array<{ category: string }>).map(
    (r) => r.category
  )
  return [...new Set([...fromPapers, ...getExtraCats()])].sort((a, b) => a.localeCompare(b))
}
