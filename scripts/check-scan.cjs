const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const db = new Database(path.join(process.env.APPDATA, 'CSPAPER', 'cspaper.db'), { readonly: true })
const s = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value)
const lib = s.libraryPath.split(String.fromCharCode(92)).join("/")
let dirs = 0, pdfs = 0
try {
  for (const d of fs.readdirSync(lib)) {
    const p = lib + '/' + d
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) { dirs++; try { if (fs.readdirSync(p).some((f) => f.toLowerCase().endsWith('.pdf'))) pdfs++ } catch {} }
  }
  console.log(JSON.stringify({ lib, rootDirs: dirs, dirsWithPdf: pdfs }))
} catch (e) { console.log('LIB-ERR', String(e).slice(0, 120)) }
db.close()
process.exit(0)
