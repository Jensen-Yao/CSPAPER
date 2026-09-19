// 阅读统计（W7 仪表盘）：逐日阅读时长流水（read_log）+ 全库概览聚合。
// papers.read_seconds 是累计值（ipc/papers.ts 的 papers:readtime 维护），
// read_log 按「天 × 论文」累加，支撑月度阅读趋势；协调者会在 papers:readtime 里追加 logReadTime 调用。
import { getDb } from './db'

// 懒初始化：逐日阅读流水（day=YYYY-MM-DD 本地时区，主键去重后累加）
let tableReady = false
function ensureTables(): void {
  if (tableReady) return
  getDb().exec(`CREATE TABLE IF NOT EXISTS read_log(
    day TEXT,
    paper_id INTEGER,
    seconds INTEGER,
    PRIMARY KEY(day, paper_id)
  );`)
  tableReady = true
}

// 记一次阅读时长（按当天累加；seconds<=0 直接忽略）
export function logReadTime(paperId: number, seconds: number): void {
  ensureTables()
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!s) return
  getDb()
    .prepare(
      `INSERT INTO read_log(day, paper_id, seconds) VALUES(date('now','localtime'), ?, ?)
       ON CONFLICT(day, paper_id) DO UPDATE SET seconds = seconds + excluded.seconds`
    )
    .run(Number(paperId), s)
}

// 与渲染端 StatsOverview 类型完全一致的概览形状
export interface StatsOverview {
  totalPapers: number
  totalReadSeconds: number
  readingPapers: number
  topRead: Array<{ id: number; title: string; seconds: number }>
  monthly: Array<{ ym: string; added: number; readSeconds: number }>
  categories: Array<{ name: string; count: number }>
  statuses: Array<{ status: string; count: number }>
  words: Array<{ w: string; n: number }>
}

// 标题词频：英文按 ≥3 字母词（小写、去停用词），中文按相邻双字 bigram
const STOP_WORDS = new Set(['the', 'of', 'for', 'and', 'a', 'an', 'in', 'on', 'to', 'with', 'based', 'via', 'using', 'from', 'by'])

function titleWords(titles: string[]): Array<{ w: string; n: number }> {
  const freq = new Map<string, number>()
  for (const raw of titles) {
    const t = (raw || '').toLowerCase()
    for (const w of t.match(/[a-zA-Z]{3,}/g) ?? []) {
      if (STOP_WORDS.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
    const cjk = t.replace(/[^\u4e00-\u9fff]/g, '')
    for (let i = 0; i < cjk.length - 1; i++) {
      const bi = cjk.slice(i, i + 2)
      freq.set(bi, (freq.get(bi) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .filter(([w]) => !/^\d+$/.test(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([w, n]) => ({ w, n }))
}

export function statsOverview(): StatsOverview {
  ensureTables()
  const db = getDb()
  const cnt = (sql: string): number => (db.prepare(sql).get() as { n: number }).n

  const totalPapers = cnt('SELECT COUNT(*) AS n FROM papers')
  const totalReadSeconds = (db.prepare('SELECT COALESCE(SUM(read_seconds), 0) AS n FROM papers').get() as { n: number }).n
  const readingPapers = cnt("SELECT COUNT(*) AS n FROM papers WHERE status='reading'")
  const topRead = db
    .prepare('SELECT id, title, read_seconds AS seconds FROM papers WHERE COALESCE(read_seconds,0) > 0 ORDER BY read_seconds DESC LIMIT 10')
    .all() as Array<{ id: number; title: string; seconds: number }>

  // 最近 12 个月（含当月），从 11 个月前到本月；空月份补零，保证图表横轴连续
  const now = new Date()
  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const start = months[0]
  const addedByYm = new Map<string, number>()
  for (const r of db
    .prepare("SELECT substr(added_at,1,7) AS ym, COUNT(*) AS n FROM papers WHERE added_at IS NOT NULL AND substr(added_at,1,7) >= ? GROUP BY ym")
    .all(start) as Array<{ ym: string; n: number }>) {
    addedByYm.set(r.ym, r.n)
  }
  const readByYm = new Map<string, number>()
  for (const r of db
    .prepare('SELECT substr(day,1,7) AS ym, SUM(seconds) AS n FROM read_log WHERE substr(day,1,7) >= ? GROUP BY ym')
    .all(start) as Array<{ ym: string; n: number }>) {
    readByYm.set(r.ym, r.n)
  }
  const monthly = months.map((ym) => ({ ym, added: addedByYm.get(ym) ?? 0, readSeconds: readByYm.get(ym) ?? 0 }))

  const categories = (
    db.prepare("SELECT category AS name, COUNT(*) AS count FROM papers WHERE category <> '' GROUP BY category ORDER BY count DESC").all() as Array<{
      name: string
      count: number
    }>
  ).map((r) => ({ name: r.name, count: r.count }))
  const statuses = (
    db.prepare('SELECT status, COUNT(*) AS count FROM papers GROUP BY status ORDER BY count DESC').all() as Array<{
      status: string
      count: number
    }>
  ).map((r) => ({ status: r.status, count: r.count }))

  const titles = (db.prepare('SELECT title FROM papers').all() as Array<{ title: string }>).map((r) => r.title)
  return {
    totalPapers,
    totalReadSeconds,
    readingPapers,
    topRead,
    monthly,
    categories,
    statuses,
    words: titleWords(titles)
  }
}
