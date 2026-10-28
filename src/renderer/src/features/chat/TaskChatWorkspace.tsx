import { useEffect, useSyncExternalStore } from 'react'
import { conversationStore, EMPTY_VIEW } from './conversation-store'
import ChatWorkspace from './ChatWorkspace'
import MessageList from './MessageList'
import RunPanel from './RunPanel'
import { dispatchWorkspaceAction } from '../../workspace-actions'
import { isTerminalRunStatus } from '../../../../shared/chat'

export default function TaskChatWorkspace({conversationId}:{conversationId:string}) {
  const store=conversationStore(),state=useSyncExternalStore(store.subscribe,store.getSnapshot)
  const view=state.views[conversationId]??EMPTY_VIEW
  useEffect(()=>{void store.selectConversation(conversationId)},[store,conversationId])
  const details=view.run?view.runs[view.run.id]:undefined
  return <ChatWorkspace layout="task">
    {details&&<RunPanel events={details.events} run={view.run}/>}
    <MessageList messages={view.messages} runs={view.runs} jumpFor={()=>(slug,page,snippet,probe,source)=>{
      dispatchWorkspaceAction({kind:'citation',slug,page,snippet,probe,documentVersion:source?.documentVersion})
    }} conversationId={conversationId} running={!!view.run&&!isTerminalRunStatus(view.run.status)} status={view.run?.status} hasMore={view.hasMore} onLoadOlder={store.loadOlder} loading={view.loading}/>
    {view.error&&<div className="chat-message-error" role="alert">{view.error}</div>}
  </ChatWorkspace>
}
