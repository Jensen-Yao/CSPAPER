const Database = require('better-sqlite3')
const path = require('path')
const db = new Database(path.join(process.env.APPDATA, 'CSPAPER', 'cspaper.db'), { readonly: true })
const t = (label, fn) => { const t0 = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; console.log(label, ms.toFixed(1) + 'ms'); return r }
t('listPapers-sql(105)', () => db.prepare("SELECT id, slug, title, authors, year, venue, category, path, status, n_pages, indexed, added_at, opened_at, summary, doi, abstract, item_type, last_page, read_seconds, cited_by, jcr, volume, issue, pages, publisher, language, deleted_at FROM papers WHERE deleted_at IS NULL ORDER BY category, year, slug").all().length)
t('tags-join(105)', () => db.prepare('SELECT paper_id, tag_id FROM paper_tags').all().length)
t('chunks-count', () => db.prepare('SELECT COUNT(*) c FROM chunks').get().c)
t('fts-sample', () => db.prepare("SELECT paper_id FROM chunks_fts WHERE chunks_fts MATCH 'resilience' LIMIT 50").all().length)
db.close(); process.exit(0)
