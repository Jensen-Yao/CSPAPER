import crypto from 'node:crypto'
import { getDb } from './db'
import { getWorkspace } from './workspaces'
import { notesFromMarkdown, readPaperMarkdown, replaceMarkdownNotes } from './paper-files'
import { runFileOperation } from './operations/journal'

export interface PaperNote { paperId:number;title:string;text:string;version:string }
function version(text:string):string { return crypto.createHash('sha256').update(text).digest('hex') }
function resolveNote(workspaceId:string,paperId:number) {
  const db=getDb(),workspace=getWorkspace(db,workspaceId)
  if(!workspace)throw new Error('工作区不存在')
  const paper=db.prepare('SELECT id,path,slug,title FROM papers WHERE id=? AND library_root=? AND deleted_at IS NULL AND missing_at IS NULL').get(paperId,workspace.normalizedRoot) as {id:number;path:string;slug:string;title:string}|undefined
  if(!paper)throw new Error('笔记所属文献不在当前工作区')
  const document=readPaperMarkdown(paper.path,paper.slug),text=notesFromMarkdown(document.raw)
  return {paper,document,text,db}
}
export function readPaperNote(workspaceId:string,paperId:number):PaperNote {
  const {paper,text}=resolveNote(workspaceId,paperId)
  return {paperId,title:paper.title,text,version:version(text)}
}
export function writePaperNote(input:{workspaceId:string;paperId:number;text:string;mode:'save'|'append';operationId:string;expectedVersion?:string;signal?:AbortSignal}):PaperNote & {beforeText:string} {
  input.signal?.throwIfAborted()
  const {paper,document,text:beforeText,db}=resolveNote(input.workspaceId,input.paperId)
  const existing=db.prepare('SELECT state FROM operation_journal WHERE id=?').get(input.operationId) as {state:string}|undefined
  if(existing) {
    if(existing.state!=='committed')throw new Error('写入操作尚待恢复，不能重复提交')
    return {...readPaperNote(input.workspaceId,input.paperId),beforeText}
  }
  if(input.expectedVersion&&input.expectedVersion!==version(beforeText))throw new Error('笔记已被其他操作修改，已保留当前内容；请重新读取后重试')
  const text=input.mode==='append'?[beforeText,input.text.trim()].filter(Boolean).join('\n\n'):input.text
  const operation=runFileOperation(db,{id:input.operationId,kind:'note.'+input.mode,target:`paper:${paper.id}`,expectedVersion:version(beforeText),edits:[{path:document.path,content:replaceMarkdownNotes(document.raw||'# '+paper.title+'\n',text)}],commit:()=>{}})
  if(operation.state!=='committed')throw new Error(operation.error??'笔记保存失败')
  return {paperId:paper.id,title:paper.title,text,version:version(text),beforeText}
}
