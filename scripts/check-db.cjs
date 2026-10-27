const Database = require('better-sqlite3')
const path = require('path')
const db = new Database(path.join(process.env.APPDATA, 'CSPAPER', 'cspaper.db'), { readonly: true })
const total = db.prepare('SELECT COUNT(*) c FROM papers').get().c
const notDeleted = db.prepare('SELECT COUNT(*) c FROM papers WHERE deleted_at IS NULL').get().c
const cats = db.prepare('SELECT category, COUNT(*) n FROM papers WHERE deleted_at IS NULL GROUP BY category ORDER BY n DESC LIMIT 8').all()
const s = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value)
console.log(JSON.stringify({ total, notDeleted, cats, libraryPath: s.libraryPath }, null, 1))
db.close()
process.exit(0)
