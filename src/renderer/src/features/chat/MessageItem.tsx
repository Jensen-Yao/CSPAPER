import { memo, useState } from 'react'
import type { Message } from '../../../../shared/chat'
import type { SourceRef } from '../../types'
import type { Jump } from '../../rich'
import type { RunDetails } from '../../../../shared/chat-api'
import MarkdownContent from './MarkdownContent'
import SourcePopover from './SourcePopover'
import ResultCards from './ResultCards'
import { openWorkspaceArtifact } from '../../workspace-actions'

export function messageText(message:Message):string {
  return message.parts.filter(part=>part.type==='text').map(part=>part.type==='text'?part.text:'').join('')
}
function sourceSlug(uri: unknown): string {
  try{return typeof uri==='string'?decodeURIComponent(new URL(uri).pathname.replace(/^\//,'')):''}catch{return ''}
}
export default memo(function MessageItem({message,sources: fallback=[],details,runs,jump}:{message:Message;sources?:SourceRef[];details?:RunDetails;runs?:Record<string,RunDetails>;jump:Jump}) {
  const [copied,setCopied]=useState(false)
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState('')
  const [actionError,setActionError]=useState('')
  const all=details?.sources??[]
  const ids=message.parts.flatMap(part=>part.type==='sources'?part.sourceIds:[])
  const ordered=ids.length?ids.flatMap(id=>all.find(source=>source.id===id)??[]):all
  const sources:SourceRef[]=details?ordered.map((source,index)=>({n:index+1,slug:sourceSlug(source.locator.uri),title:source.title,page:source.locator.page??1,snippet:source.snippet,documentVersion:source.documentVersion})):fallback
  const text=messageText(message)
  const userRun=Object.values(runs??{}).find(item=>item.run?.userMessageId===message.id)
  const errors=message.parts.filter(part=>part.type==='error')
  return <article className={`msg ${message.role}`} data-message-id={message.id}>
    <div className="who">{message.role==='user'?'你':'CSPAPER'}<span>{details?.run?.status==='queued'?'排队中':message.status==='cancelled'?'已停止':message.status==='failed'?'失败':message.status==='partial'?'部分完成':''}</span></div>
    <div className="bubble"><MarkdownContent text={text} sources={sources} onCitation={source=>jump(source.slug,source.page,source.snippet,text,source)} /></div>
    {errors.map((part,index)=><div className={`chat-message-error ${part.type==='error'&&part.code==='retrieval_empty'?'warning':''}`} key={index} role="status">{part.type==='error'?part.message:''}</div>)}
    {details?.run?.status==='queued'&&<div className="chat-message-actions"><button type="button" onClick={()=>void window.api.chat.cancelRun(details.run!.id).catch(error=>setActionError(String(error)))}>取消排队</button></div>}
    {message.role==='assistant'&&sources.length>0&&<details className="chat-evidence"><summary>参考来源 · {sources.length}</summary><div className="chat-sources">{sources.map((source,index)=><div className="chat-source-card" key={ordered[index]?.id??source.n}>
      {ordered[index]?<SourcePopover source={ordered[index]}/>:<b>{source.title}</b>}
      {source.versionChanged&&<span className="source-badge record small" title="来源保存时的文档版本与当前文件不同，定位可能漂移">版本变化</span>}<button type="button" onClick={()=>jump(source.slug,source.page,source.snippet,text,source)}>打开原文 [{source.n}] · 第 {source.page} 页</button>
    </div>)}</div></details>}
    {details&&<ResultCards artifacts={details.artifacts} onOpen={openWorkspaceArtifact}/>}
    {editing&&userRun&&<form className="chat-edit-form" onSubmit={event=>{event.preventDefault();void window.api.chat.editAndResubmit({conversationId:message.conversationId,messageId:message.id,text:draft,context:userRun.context?.refs??[]}).then(()=>setEditing(false)).catch(error=>setActionError(String(error)))}}><textarea value={draft} rows={3} onChange={event=>setDraft(event.target.value)} /><button type="submit">作为新分支重发</button></form>}
    {text&&<div className="chat-message-actions"><button type="button" onClick={()=>void navigator.clipboard.writeText(text).then(()=>setCopied(true))}>{copied?'已复制':'复制'}</button>{message.role==='user'&&userRun&&<button type="button" onClick={()=>{setDraft(text);setEditing(!editing)}}>编辑重发</button>}{details?.run?.status==='failed'&&<button type="button" onClick={()=>void window.api.chat.retryTurn(details.run!.id).catch(error=>setActionError(String(error)))}>重试</button>}</div>}
    {details?.run?.status==='interrupted'&&<div className="chat-message-actions"><button type="button" onClick={()=>void window.api.chat.resumeRun(details.run!.id).catch(error=>setActionError(String(error)))}>从保存的结果继续</button></div>}
    {actionError&&<div className="chat-message-error" role="alert">{actionError}</div>}
  </article>
})
