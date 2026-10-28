import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as store from '../src/main/db'
import { beginOperation, recoverOperations, runFileOperation } from '../src/main/operations/journal'

const [dataDir,target,phase]=process.argv.slice(2)
if(!dataDir||!target||!phase)throw new Error('usage: operation-crash <dataDir> <target> <before|after|recover>')
app.setPath('userData',path.resolve(dataDir))
app.whenReady().then(()=>{
  store.initDb()
  const db=store.getDb()
  if(phase==='recover') {
    db.exec('CREATE TABLE IF NOT EXISTS operation_marker(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
    const recovered=db.prepare('SELECT * FROM operation_journal ORDER BY created_at').all()
    console.log('OPERATION_RECOVERY '+JSON.stringify({recovered,marker:db.prepare('SELECT * FROM operation_marker').all()}))
    app.exit(0);return
  }
  const id=`crash-${phase}`
  if(phase==='before') {
    beginOperation(db,{id,kind:'crash.before',target,edits:[{path:target,content:'after-content'}]})
    app.exit(70);return
  }
  if(phase==='after') {
    db.exec('CREATE TABLE IF NOT EXISTS operation_marker(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
    runFileOperation(db,{id,kind:'crash.after',target,edits:[{path:target,content:'after-content'}],commit(){
      db.transaction(()=>{db.prepare('INSERT INTO operation_marker(value) VALUES (?)').run('must-not-commit');app.exit(71)})()
    }})
    throw new Error('crash did not terminate')
  }
  throw new Error('unknown phase '+phase)
}).catch(error=>{console.error(error);app.exit(1)})
