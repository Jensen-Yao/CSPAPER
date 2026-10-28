import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { writeFilesAtomically, type AtomicFileEdit } from '../paper-files'

export type OperationState='pending'|'committed'|'failed'|'rolled_back'|'needs_review'|'conflict'
export interface OperationRecord { id:string;kind:string;target:string;expected_version:string|null;before_digest_json:string;after_digest_json:string;backup_dir:string;state:OperationState;error:string|null;created_at:string;updated_at:string }
type Edit = AtomicFileEdit

function digest(content:string|Buffer):string {return crypto.createHash('sha256').update(content).digest('hex')}
function editBuffer(edit:Edit):Buffer {
  if(Buffer.isBuffer(edit.content))return edit.content
  if(typeof edit.content==='string')return Buffer.from(edit.content,'utf8')
  if(!edit.sourcePath)throw new Error(`文件编辑缺少内容：${edit.path}`)
  return fs.readFileSync(edit.sourcePath)
}
function digestFile(file:string):string|null {
  try {return digest(fs.readFileSync(file))}catch{return null}
}
function backupRoot(id:string):string {return path.join(app.getPath('userData'),'operation-backups',id)}
function row(record:Record<string,unknown>):OperationRecord {return record as unknown as OperationRecord}

export function beginOperation(db:Database.Database,input:{id:string;kind:string;target:string;expectedVersion?:string;edits:Edit[]}):OperationRecord {
  const now=new Date().toISOString(),backupDir=backupRoot(input.id)
  if(db.prepare('SELECT id FROM operation_journal WHERE id=?').get(input.id))throw new Error('操作 ID 已存在，不能重复开始')
  fs.mkdirSync(backupDir,{recursive:true})
  input.edits.forEach((edit,index)=>{
    if(fs.existsSync(edit.path))fs.copyFileSync(edit.path,path.join(backupDir,`before-${index}.tmp`))
    else fs.writeFileSync(path.join(backupDir,`before-${index}.missing`),'')
    fs.writeFileSync(path.join(backupDir,`after-${index}.tmp`),editBuffer(edit))
  })
  const before=JSON.stringify(input.edits.map(edit=>({path:edit.path,sha256:digestFile(edit.path)})))
  const after=JSON.stringify(input.edits.map(edit=>({path:edit.path,sha256:digest(editBuffer(edit))})))
  db.prepare('INSERT INTO operation_journal(id,kind,target,expected_version,before_digest_json,after_digest_json,backup_dir,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(input.id,input.kind,input.target,input.expectedVersion??null,before,after,backupDir,'pending',now,now)
  return row(db.prepare('SELECT * FROM operation_journal WHERE id=?').get(input.id) as Record<string,unknown>)
}

export function finishOperation(db:Database.Database,id:string,state:Exclude<OperationState,'pending'>,error?:string):OperationRecord {
  db.prepare('UPDATE operation_journal SET state=?,error=?,updated_at=? WHERE id=? AND state=?').run(state,error??null,new Date().toISOString(),id,'pending')
  return row(db.prepare('SELECT * FROM operation_journal WHERE id=?').get(id) as Record<string,unknown>)
}

/** Files are journaled before replacement; a failed DB commit leaves a preserved backup and a failed record. */
export function runFileOperation(db:Database.Database,input:{id:string;kind:string;target:string;expectedVersion?:string;edits:Edit[];commit:()=>void}):OperationRecord {
  const record=beginOperation(db,input)
  try {
    writeFilesAtomically(input.edits,input.commit)
    return finishOperation(db,input.id,'committed')
  } catch(error) {
    return finishOperation(db,input.id,'failed',String(error).slice(0,1000))
  }
}

/** Startup triage never claims success. It compares both recorded sides with disk and preserves evidence. */
export function recoverOperations(db:Database.Database):OperationRecord[] {
  const out:OperationRecord[]=[]
  for(const pending of db.prepare("SELECT * FROM operation_journal WHERE state='pending' ORDER BY created_at").all() as Record<string,unknown>[]) {
    const record=row(pending),before=JSON.parse(record.before_digest_json) as Array<{path:string;sha256:string|null}>,after=JSON.parse(record.after_digest_json) as Array<{path:string;sha256:string}>
    const beforeMatch=before.every(entry=>digestFile(entry.path)===entry.sha256)
    const afterMatch=after.every(entry=>digestFile(entry.path)===entry.sha256)
    let state:OperationState='conflict',error='进程中断：文件内容与操作前后快照均不一致，已保留备份'
    if(afterMatch){state='needs_review';error='进程中断：文件已写入，数据库/业务提交状态需要人工或上层恢复确认'}
    else if(beforeMatch){state='rolled_back';error='进程中断：文件保持在操作前状态'}
    db.prepare('UPDATE operation_journal SET state=?,error=?,updated_at=? WHERE id=?').run(state,error,new Date().toISOString(),record.id)
    out.push(row(db.prepare('SELECT * FROM operation_journal WHERE id=?').get(record.id) as Record<string,unknown>))
  }
  return out
}
