// 撤销工具写入（v0.23 · W-A5）：根据工具结果里记录的 changes 把可逆写入恢复原状；不可逆的（外部效应、网页读取）明确跳过。
import fs from 'node:fs'
import { getDb, setStatus, addPaperTag, removePaperTag, paperTags } from '../db'
import type { ChatRepository } from '../chat/repository'
import { deleteCompare, saveMyNotesText } from '../insight'
import { removeCollection, setPaperInCollection } from '../collection-service'
import { ResearchProjects } from '../research-projects'
import { ResearchCalendar } from '../research-calendar'
import { updatePaperMetadata } from '../paper-service'
import type { DomainChange } from '../../shared/tools'

export interface UndoResult { undone:string[];skipped:string[] }

function trashBySlug(slug:string):boolean {
  const row=getDb().prepare("SELECT id FROM active_papers WHERE slug=? AND deleted_at IS NULL").get(slug) as {id:number}|undefined
  if(!row)return false
  getDb().prepare("UPDATE papers SET deleted_at=datetime('now','localtime') WHERE id=?").run(row.id)
  return true
}

function restoreTags(paperId:number,names:string[]):void {
  const current=paperTags(paperId)
  for(const tag of current)if(!names.includes(tag.name))removePaperTag(paperId,tag.id)
  for(const name of names)if(!current.some(tag=>tag.name===name))addPaperTag(paperId,name)
}

/** Apply one recorded change in reverse. Returns a human-readable outcome or null when unsupported. */
function revert(change:DomainChange,workspaceId:string):string|null {
  const {entity,entityId,action,before,after}=change
  if(entity==='note') {
    const standalone=/^standalone-(\d+)$/.exec(entityId)
    if(standalone) {
      const id=Number(standalone[1])
      if(before&&typeof before==='object'&&'body_md' in (before as Record<string,unknown>)) {
        const previous=before as {title:string;body_md:string}
        getDb().prepare("UPDATE standalone_notes SET title=?, body_md=?, updated_at=datetime('now','localtime') WHERE id=?").run(previous.title,previous.body_md,id)
        return '已恢复独立笔记原文'
      }
      getDb().prepare('DELETE FROM standalone_notes WHERE id=?').run(id)
      return '已删除本次创建的独立笔记'
    }
    if(typeof before==='string') { saveMyNotesText(Number(entityId),before); return '已恢复笔记原文' }
    return null
  }
  if(entity==='paper') {
    if(action==='import')return trashBySlug(entityId)?'已把导入的文献移入回收站':'文献不存在，无法撤销'
    if(before&&typeof before==='object'&&'status' in (before as Record<string,unknown>)) { setStatus(Number(entityId),String((before as {status:string}).status)); return '已恢复阅读状态' }
    if(before&&typeof before==='object') { updatePaperMetadata(Number(entityId),before as Record<string,unknown>); return '已恢复题录字段' }
    return null
  }
  if(entity==='tag') { if(Array.isArray(before)) { restoreTags(Number(entityId),before.map(String)); return '已恢复标签' } return null }
  if(entity==='task') {
    const projects=new ResearchProjects(getDb()),id=Number(entityId)
    if(action==='create')return projects.removeTask(workspaceId,id)?'已删除本次创建的任务':'任务不存在'
    if(before&&typeof before==='object') {
      const task=projects.listTasks(workspaceId).find(item=>item.id===id)
      if(!task)return '任务不存在，无法恢复'
      const previous=before as {title?:string;status?:'todo'|'doing'|'done';priority?:'low'|'medium'|'high';dueDate?:string|null}
      projects.saveTask(workspaceId,{projectId:task.projectId,title:previous.title??task.title,notes:task.notes,status:previous.status??task.status,priority:previous.priority??task.priority,dueDate:previous.dueDate===undefined?task.dueDate:previous.dueDate,paperId:task.paperId,conversationId:task.conversationId},id)
      return '已恢复任务'
    }
    return null
  }
  if(entity==='project')return new ResearchProjects(getDb()).removeProject(workspaceId,Number(entityId))?'已删除本次创建的项目':'项目不存在'
  if(entity==='calendar') {
    if(action==='create')return new ResearchCalendar(getDb()).remove(workspaceId,Number(entityId))?'已删除本次创建的日程':'日程不存在'
    return null
  }
  if(entity==='comparison') {
    const id=Number(entityId)
    if(action==='create')return deleteCompare(id)?'已删除本次创建的对比表':'对比表不存在'
    return null
  }
  if(entity==='synthesis')return trashBySlug(entityId)?'已把综述移入回收站':'综述不存在，无法撤销'
  if(entity==='collection') {
    const id=Number(entityId)
    if(action==='create')return removeCollection(id)?'已删除本次创建的集合':'集合不存在'
    const added=(after as {addedPaperIds?:number[]}|undefined)?.addedPaperIds
    if(Array.isArray(added)) { for(const paperId of added)setPaperInCollection(id,paperId,false); return `已从集合移除 ${added.length} 篇文献` }
    const removed=(after as {removedPaperId?:number}|undefined)?.removedPaperId
    if(typeof removed==='number') { setPaperInCollection(id,removed,true); return '已把文献加回集合' }
    return null
  }
  if(entity==='file'&&typeof entityId==='string'&&fs.existsSync(entityId)) { fs.rmSync(entityId,{force:true}); return '已删除导出的文件' }
  return null
}

/** Undo every reversible change of a finished tool call, newest first. */
export function undoToolCall(repository:ChatRepository,toolCallId:string,workspaceId:string):UndoResult {
  const call=repository.getToolCall(toolCallId)
  if(!call)throw new Error('工具调用不存在')
  if(call.status==='awaiting_approval'||call.status==='running')throw new Error('工具仍在执行，不能撤销')
  const result=JSON.parse(call.result_json??'{}') as {changes?:DomainChange[]}
  const changes=[...(result.changes??[])].reverse()
  if(!changes.length)throw new Error('这次调用没有可撤销的写入')
  const undone:string[]=[],skipped:string[]=[]
  for(const change of changes) {
    const outcome=change.reversible?revert(change,workspaceId):null
    if(outcome)undone.push(`${change.entity}：${outcome}`)
    else skipped.push(`${change.entity}.${change.action}`)
  }
  return {undone,skipped}
}
