import crypto from 'node:crypto'
import fs from 'node:fs'
import type { ContextRef, ContextSnapshot } from '../../shared/context'
import { getDb } from '../db'
import { getWorkspace } from '../workspaces'

export const DEFAULT_CONTEXT_CHARS=100000
export const DEFAULT_OUTPUT_RESERVED_CHARS=16000

function fail(code:string,message:string){return {level:'error' as const,code,message}}

/** Validate refs against current workspace objects and snapshot the bounded context used by a run. */
export function buildContextSnapshot(input:{conversationId:string;runId:string;workspaceId:string;refs:ContextRef[];totalChars?:number;reservedForOutput?:number;permission?:ContextSnapshot['permission'];promptKind?:ContextSnapshot['promptKind'];researchGoal?:string;skills?:ContextSnapshot['skills']}):ContextSnapshot {
  const workspace=getWorkspace(getDb(),input.workspaceId)
  const diagnostics:ContextSnapshot['diagnostics']=[]
  if(!workspace) throw new Error('工作区不存在')
  const refs:ContextRef[]=[]
  let used=0
  for(const ref of input.refs) {
    if('workspaceId' in ref&&ref.workspaceId!==input.workspaceId) {diagnostics.push(fail('workspace_mismatch','上下文对象不属于当前工作区'));continue}
    if(ref.kind==='paper') {
      const paper=getDb().prepare('SELECT id FROM active_papers WHERE id=?').get(ref.paperId)
      if(!paper) {diagnostics.push(fail('paper_missing',`文献 #${ref.paperId} 不存在或不可见`));continue}
      refs.push(ref);used+=200
    } else if(ref.kind==='selection') {
      const paper=getDb().prepare('SELECT id FROM active_papers WHERE id=?').get(ref.paperId)
      if(!paper) {diagnostics.push(fail('paper_missing',`文献 #${ref.paperId} 不存在或不可见`));continue}
      used+=ref.text.length;refs.push(ref)
    } else if(ref.kind==='category') {
      const exists=getDb().prepare('SELECT DISTINCT category FROM active_papers WHERE category=?').get(ref.name)
      if(!exists) {diagnostics.push(fail('category_missing',`分类 ${ref.name} 不存在`));continue}
      refs.push(ref);used+=120
    } else if(ref.kind==='collection'||ref.kind==='saved_search') {
      const table=ref.kind==='collection'?'collections':'saved_searches'
      const exists=getDb().prepare(`SELECT id FROM ${table} WHERE id=?`).get(ref.kind==='collection'?ref.collectionId:ref.savedSearchId)
      if(!exists) {diagnostics.push(fail(`${ref.kind}_missing`,'集合或保存搜索不存在'));continue}
      refs.push(ref);used+=200
    } else if(ref.kind==='note'||ref.kind==='artifact') {
      refs.push(ref);used+=ref.kind==='note'?200:80
    } else if(ref.kind==='web') {
      try{if(new URL(ref.url).protocol!=='https:')throw new Error('invalid')}catch{diagnostics.push(fail('web_invalid',`Web 来源地址无效：${ref.url}`));continue}
      used+=ref.snippet.length;refs.push(ref)
    }
  }
  used+=(input.skills??[]).reduce((sum,skill)=>sum+skill.body.length,0)
  const total=input.totalChars??DEFAULT_CONTEXT_CHARS,reserved=input.reservedForOutput??DEFAULT_OUTPUT_RESERVED_CHARS
  if(used>total-reserved) diagnostics.push({level:'warning',code:'context_truncated',message:'上下文超过预算，需要检索而非全文塞入'})
  return {permission:input.permission,promptKind:input.promptKind,researchGoal:input.researchGoal?.trim().slice(0,4000)||undefined,skills:input.skills,conversationId:input.conversationId,runId:input.runId,refs,budget:{totalChars:total,usedChars:used,reservedForOutput:Math.min(reserved,total)},diagnostics,createdAt:new Date().toISOString()}
}

export function documentVersion(pdfPath:string):string {
  try {const stat=fs.statSync(pdfPath);return `${Math.round(stat.mtimeMs)}:${stat.size}`} catch {return 'missing'}
}

export function newSourceId():string {return 'src_'+crypto.randomUUID()}
