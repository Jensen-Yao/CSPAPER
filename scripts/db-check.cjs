const path = require('node:path')
const { app } = require('electron')
const Database = require('better-sqlite3')
app.whenReady().then(() => {
  const db = new Database('F:/tmp/cspaper-data/cspaper.db', { readonly: true })
  const total = db.prepare('SELECT COUNT(*) AS n FROM chunks_fts').get().n
  console.log('chunks_fts rows:', total)
  const sample = db.prepare('SELECT text FROM chunks_fts LIMIT 2').all()
  console.log('sample text:', JSON.stringify(sample).slice(0, 200))
  for (const q of ['韧性', '"蒙特卡洛"', '蒙特卡洛']) {
    try {
      const n = db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?').get(q).n
      console.log(`MATCH ${JSON.stringify(q)} →`, n)
    } catch (e) { console.log(`MATCH ${JSON.stringify(q)} → ERR`, String(e).slice(0, 80)) }
  }
  db.close()
  app.exit(0)
  process.exit(0)
})
