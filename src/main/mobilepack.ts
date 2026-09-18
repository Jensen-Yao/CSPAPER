// 移动端数据互导：
// 导出 —— 文献库打包为 .cspack（STORE 型 ZIP：元数据 JSON + PDF + 高亮标注），手机端 App 直接打开；
// 合并 —— 手机端阅读产生的标注/已读状态导出为 .csnotes.json，桌面端一键合并回库。
import fs from 'node:fs'
import path from 'node:path'
import { createZip, type ZipEntry } from './zip'
import { getDb } from './db'

export interface MobilePackResult {
  papers: number
  highlights: number
  bytes: number
}

export interface MobileMergeResult {
  mergedHighlights: number
  mergedStatus: number
  mergedSummaries: number
  skipped: number
}

export function exportMobilePack(destPath: string, send: (ev: string, payload: unknown) => void): MobilePackResult {
  const db = getDb()
  const papers = db
    .prepare('SELECT slug, title, authors, year, venue, category, path, status, summary FROM papers ORDER BY category, slug')
    .all() as Array<{ slug: string; title: string; authors: string; year: number | null; venue: string; category: string; path: string; status: string; summary: string | null }>
  const highlights = db
    .prepare(`SELECT h.page, h.text, h.rects, p.slug FROM highlights h JOIN papers p ON p.id = h.paper_id ORDER BY p.slug, h.page, h.id`)
    .all() as Array<{ slug: string; page: number; text: string; rects: string }>

  const entries: ZipEntry[] = []
  const packPapers: unknown[] = []
  let done = 0
  for (const p of papers) {
    send('mobile:progress', { done: done++, total: papers.length, current: p.title })
    try {
      const pdf = fs.readFileSync(p.path)
      entries.push({ name: `pdfs/${p.slug}.pdf`, data: pdf })
      packPapers.push({
        slug: p.slug,
        title: p.title,
        authors: p.authors,
        year: p.year,
        venue: p.venue,
        category: p.category,
        status: p.status,
        summary: p.summary,
        pdf: `pdfs/${p.slug}.pdf`
      })
    } catch {
      /* 文件缺失（未同步/已移动）跳过，其余照常 */
    }
  }
  const manifest = {
    format: 1,
    app: 'CSPAPER',
    exportedAt: new Date().toISOString(),
    papers: packPapers,
    highlights: highlights.map((h) => ({ slug: h.slug, page: h.page, text: h.text, rects: JSON.parse(h.rects) }))
  }
  entries.push({ name: 'library.json', data: Buffer.from(JSON.stringify(manifest, null, 1), 'utf8') })
  const zip = createZip(entries)
  fs.writeFileSync(destPath, zip)
  send('mobile:progress', { done: papers.length, total: papers.length, current: '' })
  return { papers: packPapers.length, highlights: highlights.length, bytes: zip.length }
}

export function mergeMobileNotes(jsonPath: string): MobileMergeResult {
  const db = getDb()
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    highlights?: Array<{ slug: string; page: number; text: string; rects?: Array<{ x: number; y: number; w: number; h: number }> }>
    statuses?: Array<{ slug: string; status: string }>
    summaries?: Array<{ slug: string; summary: string }>
  }
  const bySlug = db.prepare('SELECT id FROM papers WHERE slug=?')
  const insHl = db.prepare('INSERT INTO highlights(paper_id,page,rects,text) VALUES(?,?,?,?)')
  const setStatus = db.prepare('UPDATE papers SET status=? WHERE slug=? AND status<>?')
  const seen = new Set<string>()
  let mergedHighlights = 0
  let mergedStatus = 0
  let skipped = 0
  for (const h of raw.highlights ?? []) {
    const key = `${h.slug}|${h.page}|${h.text.slice(0, 80)}`
    const row = bySlug.get(h.slug) as { id: number } | undefined
    if (!row || seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    insHl.run(row.id, h.page, JSON.stringify(h.rects ?? []), (h.text ?? '').slice(0, 500))
    mergedHighlights++
  }
  for (const s of raw.statuses ?? []) {
    const r = setStatus.run(s.status, s.slug, s.status)
    mergedStatus += Number(r.changes > 0)
  }
  // 手机端生成的 AI 小结：回写文献 summary（仅覆盖空小结，不覆盖桌面已生成的）
  const setSummary = db.prepare("UPDATE papers SET summary=? WHERE slug=? AND (summary IS NULL OR summary='')")
  let mergedSummaries = 0
  for (const sm of raw.summaries ?? []) {
    const r = setSummary.run((sm.summary ?? '').slice(0, 2000), sm.slug)
    mergedSummaries += Number(r.changes > 0)
  }
  return { mergedHighlights, mergedStatus, mergedSummaries, skipped }
}
