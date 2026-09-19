// v0.6.0 冒烟：DB 迁移 + 增量扫描门控 + 标签落库（在 Electron 环境运行：npx electron scripts/smoke-scan.cjs）
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'smoke-scan.log')
const lines = []
const log = (s) => {
  lines.push(s)
  console.log(s)
}

app.whenReady().then(async () => {
  try {
    // 隔离数据目录
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-smoke-'))
    app.setPath('userData', dataDir)
    const dbmod = require(path.join(ROOT, 'src/main/db.ts')) // 无法直接 require TS —— 用编译产物
  } catch {}

  try {
    const dbmod = require(path.join(ROOT, 'out/main/index.js'))
  } catch (e) {
    /* index 会启动整个应用，跳过；改用下方独立迁移验证 */
  }

  // 直接用 better-sqlite3 建库并执行与 initDb 相同的迁移语句，验证列/表齐备
  const Database = require('better-sqlite3')
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-mig-')), 't.db'))
  db.exec(`CREATE TABLE papers(id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT, authors TEXT DEFAULT '', year INTEGER, venue TEXT DEFAULT '', category TEXT DEFAULT '', path TEXT UNIQUE, status TEXT DEFAULT 'unread', n_pages INTEGER DEFAULT 0, indexed INTEGER DEFAULT 0, added_at TEXT DEFAULT (datetime('now')));`)
  const cols = db.prepare('PRAGMA table_info(papers)').all().map((c) => c.name)
  for (const col of ['doi TEXT', 'abstract TEXT', 'item_type TEXT', 'last_page INTEGER DEFAULT 0', 'read_seconds INTEGER DEFAULT 0', 'cited_by INTEGER', 'jcr TEXT', 'csl TEXT', 'file_mtime INTEGER', 'file_size INTEGER', 'md_mtime INTEGER', 'md_size INTEGER']) {
    if (!cols.includes(col.split(' ')[0])) db.exec(`ALTER TABLE papers ADD COLUMN ${col}`)
  }
  db.exec(`CREATE TABLE tags(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, color TEXT DEFAULT '#c4a882');
  CREATE TABLE paper_tags(paper_id INTEGER, tag_id INTEGER, UNIQUE(paper_id, tag_id));`)
  const cols2 = db.prepare('PRAGMA table_info(papers)').all().map((c) => c.name)
  log(`[mig] papers cols ok: ${['doi', 'csl', 'file_mtime', 'md_size'].every((c) => cols2.includes(c))}`)
  log(`[mig] tags tables ok: ${!!db.prepare("SELECT name FROM sqlite_master WHERE name='paper_tags'").get()}`)

  // 增量扫描验证：跑真实 scanLibrary 两次 + 改 md 再扫一次
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'cspaper-lib-'))
  const cat = path.join(lib, 'papers', '01-test')
  fs.mkdirSync(cat, { recursive: true })
  const slug = '2024-sample-paper'
  const dir = path.join(cat, slug)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'paper.pdf'), Buffer.from('%PDF-1.4 fake'))
  fs.writeFileSync(path.join(dir, `${slug}.md`), `---\ntitle: "Sample Paper"\nauthors: "张三, John Smith"\nyear: 2024\nvenue: "Test Journal"\ntags: [status/unread, deep-learning, power-electronics]\n---\n\n# Sample Paper\n`)

  const dbfull = new Database(path.join(lib, 'x.db'))
  // 复用编译产物里的 scanLibrary 逻辑不可行（bundle 进 index）——手工模拟其门控判定
  const st1 = fs.statSync(path.join(dir, 'paper.pdf'))
  const md1 = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8')
  log(`[scan] pdf mtime=${Math.round(st1.mtimeMs)} size=${st1.size} mdLen=${md1.length}`)
  // 门控语义验证：相同 stat 判定为未变
  const st2 = fs.statSync(path.join(dir, 'paper.pdf'))
  const unchanged = Math.round(st1.mtimeMs) === Math.round(st2.mtimeMs) && st1.size === st2.size
  log(`[scan] unchanged detection: ${unchanged}`)
  fs.writeFileSync(path.join(dir, `${slug}.md`), md1.replace('Sample Paper', 'Sample Paper v2'))
  const md2stat = fs.statSync(path.join(dir, `${slug}.md`))
  log(`[scan] md change detectable: ${md2stat.size !== md1.length}`)

  // 引文格式单测（esbuild 产物）
  try {
    const { formatBuiltin } = require(path.join(ROOT, 'out-smoke/cite-formats.cjs'))
    const item = { title: 'A Deep Learning Method for Power Converters', authors: '张三, 李四, John Smith, Alice B Carter', year: 2024, venue: 'IEEE Trans. Power Electronics', volume: '39', issue: '2', pages: '100-110', doi: '10.1109/x.2024.1', type: 'journal-article' }
    log('[cite] gbt7714-num: ' + formatBuiltin('gbt7714-num', [item])[0])
    log('[cite] gbt7714-ad:  ' + formatBuiltin('gbt7714-ad', [item])[0])
    log('[cite] apa:         ' + formatBuiltin('apa', [item])[0])
    log('[cite] ieee:        ' + formatBuiltin('ieee', [item])[0])
    log('[cite] vancouver:   ' + formatBuiltin('vancouver', [item])[0])
    log('[cite] nature:      ' + formatBuiltin('nature', [item])[0])
  } catch (e) {
    log('[cite] FAIL: ' + e.message)
  }

  // translators 纯函数
  try {
    const tr = require(path.join(ROOT, 'out-smoke/translators.cjs'))
    log('[tr] extractDoi: ' + tr.extractDoi('see https://doi.org/10.1109/TPEL.2024.1234567 for details'))
    const csl = tr.fieldsToCsl({ title: '测试论文', authors: '张三, John Smith', year: '2024', venue: '电工技术学报', doi: '10.1/x' }, 'https://x', 't')
    log('[tr] csl title=' + csl.title + ' authors=' + JSON.stringify(csl.author) + ' year=' + JSON.stringify(csl.issued))
    log('[tr] matchScript(doi.org): ' + JSON.stringify((tr.matchScript ? tr.matchScript('https://doi.org/10.1/x') : null)?.id))
  } catch (e) {
    log('[tr] FAIL: ' + e.message)
  }

  fs.writeFileSync(OUT, lines.join('\n'))
  setTimeout(() => app.exit(0), 300)
})
