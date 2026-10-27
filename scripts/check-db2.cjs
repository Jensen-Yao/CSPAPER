const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
for (const d of ['CSPAPER', 'cspaper']) {
  const f = path.join(process.env.APPDATA, d, 'cspaper.db')
  try {
    const st = fs.statSync(f)
    const db = new Database(f, { readonly: true })
    const n = db.prepare('SELECT COUNT(*) c FROM papers').get().c
    console.log(d, 'size=', st.size, 'mtime=', st.mtime.toISOString().slice(0, 16), 'papers=', n)
    db.close()
  } catch (e) { console.log(d, 'ERR', String(e).slice(0, 80)) }
}
process.exit(0)
