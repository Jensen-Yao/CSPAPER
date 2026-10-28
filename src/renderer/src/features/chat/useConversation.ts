import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ContextRef } from '../../../../shared/context'
import type { ModelBindingSnapshot } from '../../../../shared/models'
import { conversationStore, EMPTY_VIEW } from './conversation-store'

export function useConversation(modelBindingId:string,reasoning:ModelBindingSnapshot['reasoning'],buildContext:(workspaceId:string)=>ContextRef[]) {
  const store=conversationStore()
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot)
  const view=state.activeId?state.views[state.activeId]??EMPTY_VIEW:EMPTY_VIEW
  const modelRef=useRef({modelBindingId,reasoning});modelRef.current={modelBindingId,reasoning}
  const contextRef=useRef(buildContext);contextRef.current=buildContext
  useEffect(()=>{void store.initialize().catch(()=>{})},[store])
  const send=useCallback(async(text:string)=>{
    const latest=store.getSnapshot(),conversation=latest.activeId?latest.views[latest.activeId]?.conversation:null
    if(!conversation)throw new Error('会话尚未初始化')
    return store.send({conversationId:conversation.id,clientMessageId:'client_'+crypto.randomUUID(),parentMessageId:conversation.activeLeafMessageId,text,context:contextRef.current(conversation.workspaceId),...modelRef.current,mode:'ask',promptKind:'ask',permission:'readonly'})
  },[store])
  return {...view,conversations:state.conversations,sources:Object.values(view.runs).flatMap(item=>item.sources),loading:state.loading||view.loading,error:view.error||state.error,includeArchived:state.includeArchived,nextCursor:state.nextCursor,
    send,stop:store.stop,newConversation:store.newConversation,selectConversation:store.selectConversation,refreshConversations:store.refreshConversations,renameConversation:store.renameConversation,archiveConversation:store.archiveConversation,showArchived:store.showArchived,loadOlder:store.loadOlder}
}
