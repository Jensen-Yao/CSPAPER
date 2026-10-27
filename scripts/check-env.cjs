const fs = require('fs')
const path = require('path')
const os = require('os')
// launcher 指向
const home = os.homedir()
for (const f of [home + '/.cspaper-launcher.json', path.join(process.env.APPDATA, '../Local/cspaper-launcher.json')]) {
  try { console.log('LAUNCHER', f, fs.readFileSync(f, 'utf8').slice(0, 120)) } catch { }
}
// DB 里 path 前缀分布
const Database = require('better-sqlite3')
const db = new Database(path.join(process.env.APPDATA, 'CSPAPER', 'cspaper.db'), { readonly: true })
const rows = db.prepare('SELECT path FROM papers').all()
const pref = new Map()
let missing = 0
for (const r of rows) {
  const p = r.path.split(String.fromCharCode(92)).join('/')
  const key = p.split('/').slice(0, 4).join('/')
  pref.set(key, (pref.get(key) ?? 0) + 1)
  try { fs.statSync(r.path) } catch { missing++ }
}
console.log('PATH-PREFIXES', JSON.stringify([...pref.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)))
console.log('MISSING-FILES', missing, '/', rows.length)
db.close()
process.exit(0)
