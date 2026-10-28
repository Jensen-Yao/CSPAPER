import { useState } from 'react'
import type { Conversation } from '../../../../shared/chat'
import { useDialog } from '../../Dialog'

interface Props {
  conversations:Conversation[];activeId?:string|null;onSelect:(id:string)=>void;onNew:()=>void
  onRename?:(id:string,title:string)=>Promise<void>;onArchive?:(id:string,archived:boolean)=>Promise<void>
  includeArchived?:boolean;onShowArchived?:(value:boolean)=>void;hasMore?:boolean;onLoadMore?:()=>void
}
export default function ConversationList({conversations,activeId,onSelect,onNew,onRename,onArchive,includeArchived,onShowArchived,hasMore,onLoadMore}:Props) {
  const [query,setQuery]=useState(''),[error,setError]=useState('')
  const dialog=useDialog(),active=conversations.find(item=>item.id===activeId)
  const rename=async()=>{
    if(!active||!onRename)return
    const title=await dialog.prompt({title:'重命名会话',defaultValue:active.title,validate:value=>value.trim()?'':'请输入名称'})
    if(title?.trim())try{await onRename(active.id,title.trim());setError('')}catch(error){setError(String(error))}
  }
  return <aside className="chat-conversations" aria-label="会话列表">
    <header><b>对话</b><button type="button" onClick={onNew}>新建</button></header>
    <input className="chat-conversation-search" aria-label="搜索会话" placeholder="搜索会话…" value={query} onChange={event=>setQuery(event.target.value)}/>
    <div className="chat-conversation-list">
      {conversations.filter(item=>item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(conversation=><div key={conversation.id} className={`chat-conversation-row ${conversation.id===activeId?'active':''}`}>
        <button type="button" aria-current={conversation.id===activeId?'page':undefined} title={conversation.title} onClick={()=>onSelect(conversation.id)}>{conversation.archivedAt?'[已归档] ':''}{conversation.title||'新会话'}</button>
      </div>)}
      {hasMore&&<button className="chat-history-load" onClick={onLoadMore}>加载更多会话</button>}
    </div>
    {active&&<div className="chat-conversation-options">
      <button className="chat-history-load" onClick={()=>void rename()}>重命名</button>
      <button className="chat-history-load" onClick={()=>void onArchive?.(active.id,!active.archivedAt).catch(error=>setError(String(error)))}>{active.archivedAt?'恢复':'归档'}</button>
    </div>}
    <label className="chat-conversation-options"><input type="checkbox" checked={!!includeArchived} onChange={event=>onShowArchived?.(event.target.checked)}/>显示已归档会话</label>
    {error&&<div className="chat-message-error" role="alert">{error}</div>}
  </aside>
}
