import fs from 'node:fs'
import path from 'node:path'
import { getDb, getSettings, scanLibraryAsync } from './db'
import { parseFrontmatter, patchFrontmatter, readPaperMarkdown } from './paper-files'
import { runFileOperation } from './operations/journal'
import { previewZotero, type ZoteroPaper } from './zotero'

export type ZoteroRepairStatus = 'repairable' | 'no_zotero_key' | 'item_missing' | 'pdf_missing_or_absent' | 'already_pdf' | 'error'

export interface ZoteroRepairCandidate {
  paperId: number
  slug: string
  title: string
  zoteroKey: string
  status: ZoteroRepairStatus
  sourcePath?: string
  reason?: string
}

export interface ZoteroRepairPreview {
  dataDir: string
  error?: string
  total: number
  counts: Record<ZoteroRepairStatus, number>
  candidates: ZoteroRepairCandidate[]
}

export interface ZoteroRepairOutcome extends ZoteroRepairCandidate {
  repaired: boolean
  operationId?: string
  backupDir?: string
  error?: string
}

export interface ZoteroRepairApplyResult {
  dataDir: string
  total: number
  repaired: number
  failed: number
  skipped: number
  outcomes: ZoteroRepairOutcome[]
}

type RecordPaper = { id:number;slug:string;title:string;path:string;source_kind:'pdf'|'record' }

function emptyCounts():Record<ZoteroRepairStatus,number> {
  return {repairable:0,no_zotero_key:0,item_missing:0,pdf_missing_or_absent:0,already_pdf:0,error:0}
}

function planRepairs(items:ZoteroPaper[],paperIds?:number[]):ZoteroRepairCandidate[] {
  const db=getDb()
  const allowed=paperIds?.length?new Set(paperIds):null
  const rows=(allowed
    ? db.prepare('SELECT id,slug,title,path,source_kind FROM active_papers WHERE source_kind=\'record\' AND id IN ('+[...allowed].map(()=>'?').join(',')+') ORDER BY id').all(...allowed)
    : db.prepare("SELECT id,slug,title,path,source_kind FROM active_papers WHERE source_kind='record' ORDER BY id").all()) as RecordPaper[]
  const byKey=new Map(items.map(item=>[item.key.toLowerCase(),item]))
  const out:ZoteroRepairCandidate[]=[]
  for(const paper of rows) {
    const doc=readPaperMarkdown(paper.path,paper.slug)
    const fm=parseFrontmatter(doc.raw)
    const key=String(fm.zotero??'').trim()
    const base={paperId:paper.id,slug:paper.slug,title:paper.title,zoteroKey:key}
    if(!key) {
      out.push({...base,status:'no_zotero_key',reason:'Markdown frontmatter 没有 zotero key，无法精确匹配'})
      continue
    }
    const item=byKey.get(key.toLowerCase())
    if(!item) {
      out.push({...base,status:'item_missing',reason:'Zotero 数据库中没有这个 key'})
      continue
    }
    if(!item.pdf || !fs.existsSync(item.pdf)) {
      out.push({...base,status:'pdf_missing_or_absent',reason:'Zotero 有条目但当前没有可读取的 PDF 附件文件'})
      continue
    }
    out.push({...base,status:'repairable',sourcePath:item.pdf})
  }
  return out
}

function summarize(candidates:ZoteroRepairCandidate[]):Record<ZoteroRepairStatus,number> {
  const counts=emptyCounts()
  for(const item of candidates)counts[item.status]++
  return counts
}

export function previewZoteroRepairs(dataDir?:string):ZoteroRepairPreview {
  const detected=dataDir?.trim()||previewZotero().dataDir
  const preview=previewZotero(detected)
  if(preview.error) {
    const counts=emptyCounts()
    return {dataDir:preview.dataDir,error:preview.error,total:0,counts,candidates:[]}
  }
  const candidates=planRepairs(preview.items)
  return {dataDir:preview.dataDir,total:candidates.length,counts:summarize(candidates),candidates}
}

export function applyZoteroRepairs(input:{dataDir?:string;items:ZoteroPaper[];paperIds?:number[]}):ZoteroRepairApplyResult {
  const db=getDb(),candidates=planRepairs(input.items,input.paperIds)
  const outcomes:ZoteroRepairOutcome[]=[]
  for(const candidate of candidates) {
    if(candidate.status!=='repairable') {
      outcomes.push({...candidate,repaired:false,error:candidate.reason})
      continue
    }
    try {
      const sourcePath=candidate.sourcePath!
      const source=fs.statSync(sourcePath)
      const operationId=`zotero-repair-${candidate.paperId}-${Math.round(source.mtimeMs)}-${source.size}`
      const existing=db.prepare('SELECT state,error FROM operation_journal WHERE id=?').get(operationId) as {state:string;error:string|null}|undefined
      if(existing?.state==='committed') {
        outcomes.push({...candidate,repaired:false,operationId,reason:'该原文版本已修复过，操作日志幂等拦截重复替换'})
        continue
      }
      if(existing) throw new Error(`存在未恢复的修复操作 ${operationId}（${existing.state}），请先处理操作记录`)
      const pdf=getDb().prepare('SELECT path,slug FROM active_papers WHERE id=?').get(candidate.paperId) as {path:string;slug:string}
      const doc=readPaperMarkdown(pdf.path,pdf.slug)
      const target=pdf.path
      if(path.resolve(target)===path.resolve(sourcePath)) throw new Error('Zotero 原文路径与当前 CSPAPER 文件相同')
      const magic=fs.readFileSync(sourcePath).subarray(0,5).toString('latin1')
      if(magic!=='%PDF-') throw new Error('Zotero 附件不是有效 PDF')
      const markdown=patchFrontmatter(doc.raw||`# ${candidate.title}\n`,{source_kind:'pdf'})
      const record=runFileOperation(db,{
        id:operationId,
        kind:'zotero.repair_pdf',
        target:`paper:${candidate.paperId}`,
        expectedVersion:String((db.prepare('SELECT file_mtime,file_size FROM active_papers WHERE id=?').get(candidate.paperId) as {file_mtime?:number;file_size?:number}).file_mtime??0),
        edits:[{path:target,sourcePath},{path:doc.path,content:markdown}],
        commit:()=>{
          db.prepare(`UPDATE papers SET source_kind='pdf',source_stamp=NULL,file_mtime=?,file_size=?,indexed=0,pvec=NULL,missing_at=NULL WHERE id=?`)
            .run(Math.round(source.mtimeMs),source.size,candidate.paperId)
        }
      })
      if(record.state==='failed') throw new Error(record.error||'PDF 替换失败')
      outcomes.push({...candidate,repaired:true,operationId,backupDir:record.backup_dir})
    } catch(error) {
      outcomes.push({...candidate,repaired:false,error:String(error).slice(0,500)})
    }
  }
  const repaired=outcomes.filter(item=>item.repaired).length
  const failed=outcomes.filter(item=>item.status==='repairable'&&!item.repaired).length
  return {dataDir:input.dataDir??'',total:outcomes.length,repaired,failed,skipped:outcomes.length-repaired-failed,outcomes}
}

export async function repairZoteroPdfs(dataDir?:string,paperIds?:number[]):Promise<ZoteroRepairApplyResult> {
  const detected=dataDir?.trim()||previewZotero().dataDir
  const preview=previewZotero(detected)
  if(preview.error) return {dataDir:preview.dataDir,total:0,repaired:0,failed:0,skipped:0,outcomes:[]}
  const result=applyZoteroRepairs({dataDir:preview.dataDir,items:preview.items,paperIds})
  if(result.repaired>0) await scanLibraryAsync(getSettings().libraryPath)
  return result
}
