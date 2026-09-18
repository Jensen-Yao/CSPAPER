// 截图示例数据种子：从用户指定文件夹取真实文献，构建示例库 + 预置小结/对比表/高亮
// 用法: npx electron scripts/seed.cjs
const path = require('node:path')
const fs = require('node:fs')
const { app } = require('electron')
const Database = require('better-sqlite3')

const DATA_DIR = 'F:/tmp/cspaper-data'
const SRC = 'D:/原桌面重要文档/无人机论文/1文献/文献-韧性综述×非无人机'
const LIB = 'F:/tmp/cspaper-sample/papers'
const CATEGORY = '韧性综述'

// 各篇的 AI 小结（按文件名片段匹配）
const SUMMARIES = [
  { key: '多状态网络', summary: '系统梳理多状态下网络可靠性与韧性评估的概念演进、指标体系与解析/仿真求解方法，对比各类方法在复杂体系中的适用性，并展望韧性导向的设计方向。' },
  { key: '太空体系', summary: '面向太空体系对抗环境，辨析弹性与鲁棒性等概念内涵，构建弹性评估框架，从能力、结构与任务三个视角比较典型评估方法及适用场景。' },
  { key: '武器装备', summary: '综述武器装备体系弹性技术体系，涵盖体系结构设计、冗余备份、快速重构策略与弹性量化评估方法，给出工程落地路径与案例。' },
  { key: '韧性网络', summary: '分析韧性网络信息体系的分层技术框架，讨论骨干网络、传输与应用各层的韧性增强机制，提出多层级协同的韧性设计思路。' }
]

function slugifyFile(name) {
  return `resilience-${String(name).padStart(2, '0')}`
}

app.whenReady().then(() => {
  try {
    main()
  } catch (e) {
    console.error('SEED FAIL:', e)
    app.exit(1)
  }
})

function main() {
  // 独占重建数据目录：避免被残留进程的旧库干扰
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(path.join(DATA_DIR, 'cspaper.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE, title TEXT, authors TEXT DEFAULT '',
      year INTEGER, venue TEXT DEFAULT '', category TEXT DEFAULT '',
      path TEXT UNIQUE, status TEXT DEFAULT 'unread',
      n_pages INTEGER DEFAULT 0, indexed INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      pvec BLOB, opened_at TEXT, summary TEXT
    );
    CREATE TABLE IF NOT EXISTS chunks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      page INTEGER, ord INTEGER, text TEXT, vec BLOB
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, paper_id UNINDEXED, page UNINDEXED, tokenize='trigram');
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS highlights(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
      page INTEGER, rects TEXT, text TEXT DEFAULT '',
      color TEXT DEFAULT 'yellow',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(title, authors, venue, slug, tokenize='trigram');
    CREATE TABLE IF NOT EXISTS compare_tables(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // ---- 从用户文件夹收集真实文献 ----
  const pdfs = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
  if (pdfs.length === 0) throw new Error('源文件夹没有 PDF：' + SRC)
  const papers = pdfs.map((f, i) => {
    const base = f.replace(/\.pdf$/i, '')
    const us = base.lastIndexOf('_')
    const title = us > 0 ? base.slice(0, us).replace(/_/g, ' ') : base
    const author = us > 0 ? base.slice(us + 1) : ''
    return { file: path.join(SRC, f), title, author, slug: slugifyFile(i + 1), summary: (SUMMARIES.find((s) => base.includes(s.key)) ?? {}).summary ?? null }
  })

  // 补充两篇英文文献（全文翻译 EN→中 对照演示）
  const EXTRA = [
    {
      src: 'D:/原桌面重要文档/无人机论文/1文献/02 李艳军/Network approach for resilience evaluation of a UAV swarm by considering communication limits.pdf',
      title: 'Network approach for resilience evaluation of a UAV swarm by considering communication limits',
      summary: '以无人机集群通信网络为对象，用复杂网络方法建模通信拓扑，在通信受限条件下构建集群韧性评估指标，并通过仿真分析通信距离对任务韧性的影响。'
    },
    {
      src: 'D:/原桌面重要文档/无人机论文/1文献/03 程聪聪/Resilience evaluation for UAV Swarm performing joint reconnaissance mission.pdf',
      title: 'Resilience evaluation for UAV Swarm performing joint reconnaissance mission',
      summary: '面向联合侦察任务的无人机集群，构建「扰动—吸收—恢复」全过程的韧性量化评估流程，分析不同重构策略对任务韧性的贡献。'
    }
  ]
  for (const e of EXTRA) papers.push({ file: e.src, title: e.title, slug: slugifyFile(papers.length + 1), author: '', summary: e.summary })

  // ---- 复制到示例库结构 ----
  db.exec('DELETE FROM highlights')
  db.exec('DELETE FROM compare_tables')
  db.exec('DELETE FROM papers')
  const rows = []
  papers.forEach((p) => {
    const dir = path.join(LIB, CATEGORY, p.slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(p.file, path.join(dir, 'paper.pdf'))
    const md = `---\ntitle: "${p.title}"\nauthors: "${p.author ? p.author + ' 等' : ''}"\nvenue: ""\nstatus: unread\n---\n\n# ${p.title}\n`
    fs.writeFileSync(path.join(dir, p.slug + '.md'), md, 'utf8')
    rows.push(p)
  })

  // ---- 设置 ----
  const settings = {
    libraryPath: LIB.replace(/\//g, '\\'),
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    model: 'glm-4.6',
    provider: 'zhipu',
    embedProvider: 'local',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaEmbedModel: 'bge-m3',
    translateTarget: '中文',
    theme: 'light',
    setupDone: true,
    models: ['glm-4.6', 'glm-4.5-air'],
    thinkingLevel: 'default',
    profiles: []
  }
  db.prepare("INSERT INTO meta(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(settings))
  db.prepare("INSERT INTO meta(key,value) VALUES('extra_cats','[]') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run([])

  // ---- 文献行（含小结；路径与磁盘一致，应用扫描时按 path upsert 保留 summary）----
  const ins = db.prepare(`INSERT INTO papers(slug,title,authors,year,venue,category,path,status,summary,opened_at,indexed,added_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,datetime('now','-2 days','-'||?||' minutes'))`)
  const ids = []
  rows.forEach((p, i) => {
    const dir = path.join(LIB, CATEGORY, p.slug)
    const r = ins.run(p.slug, p.title, p.author, null, '', CATEGORY, path.join(dir, 'paper.pdf'), i === 0 ? 'reading' : i === 1 ? 'read' : 'unread', p.summary, i === 0 ? 1 : null, i)
    ids.push(Number(r.lastInsertRowid))
  })

  // ---- 划词高亮（第一篇第 1 页）----
  db.prepare('INSERT INTO highlights(paper_id,page,rects,text) VALUES(?,?,?,?)').run(
    ids[0], 1,
    JSON.stringify([
      { x: 0.12, y: 0.3, w: 0.6, h: 0.03 },
      { x: 0.12, y: 0.336, w: 0.55, h: 0.03 }
    ]),
    '韧性是指系统在遭受扰动后恢复其基本功能与性能的能力'
  )

  // ---- 对比表（三篇综述横向对比，带页码出处）----
  const cmp = {
    paperIds: [ids[0], ids[1], ids[2]],
    dimensions: ['综述对象', '方法分类', '未来方向'],
    cells: {
      [String(ids[0])]: {
        综述对象: [{ t: '多状态网络的可靠性与韧性评估', p: 1 }],
        方法分类: [
          { t: '解析法：多态系统可靠性理论', p: 2 },
          { t: '仿真法：蒙特卡洛类评估流程', p: 3 }
        ],
        未来方向: [{ t: '面向复杂体系的韧性导向设计', p: 5 }]
      },
      [String(ids[1])]: {
        综述对象: [{ t: '太空体系在对抗环境下的弹性', p: 1 }],
        方法分类: [
          { t: '基于能力的弹性评估框架', p: 2 },
          { t: '基于体系结构（SAB）的评估方法', p: 4 }
        ],
        未来方向: [{ t: '弹性评估与任务规划闭环', p: 6 }]
      },
      [String(ids[2])]: {
        综述对象: [{ t: '武器装备体系弹性技术', p: 1 }],
        方法分类: [
          { t: '冗余备份与快速重构策略', p: 3 },
          { t: '体系弹性量化与试验评估', p: 4 }
        ],
        未来方向: [{ t: '体系弹性工程化落地路径', p: 5 }]
      }
    }
  }
  db.prepare('INSERT INTO compare_tables(title, data) VALUES(?,?)').run('对比表 1', JSON.stringify(cmp))

  const n = db.prepare('SELECT COUNT(*) AS n FROM papers').get()
  console.log('seeded papers:', n.n, 'ids:', ids.join(','), '| 来源:', SRC)
  db.close()
  app.exit(0)
  process.exit(0)
}
