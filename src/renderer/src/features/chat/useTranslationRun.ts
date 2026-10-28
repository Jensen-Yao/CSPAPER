import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunEvent, RunStatus } from '../../../../shared/chat'
import type { ModelBindingSnapshot } from '../../../../shared/models'

const TERMINAL:RunStatus[]=['completed','partial','failed','cancelled','interrupted']

interface StartOptions { paperId?:number;page?:number;documentVersion?:string;text:string;conversationId?:string }
export interface TranslationRunState { runId:string|null;conversationId:string|null;status:RunStatus|null;output:string;error:string }

/** A persisted reader translation run. Closing the sidebar does not cancel it; stop uses the unified runtime. */
export function useTranslationRun(modelBindingId:string,reasoning:ModelBindingSnapshot['reasoning']) {
  const [state,setState]=useState<TranslationRunState>({runId:null,conversationId:null,status:null,output:'',error:''})
  const stateRef=useRef(state);stateRef.current=state
  useEffect(()=>{
    return window.api.chat.onEvent(event=>{
      const current=stateRef.current
      if(!current.runId||event.runId!==current.runId)return
      if(event.type==='message.delta')setState(prev=>({...prev,output:prev.output+String((event.payload as {delta?:string}).delta??'')}))
      else if(event.type==='run.status_changed')setState(prev=>({...prev,status:(event.payload as {status?:RunStatus}).status??prev.status}))
      else if(event.type==='error')setState(prev=>({...prev,error:String((event.payload as {message?:string}).message??'翻译失败')}))
    })
  },[])
  const start=useCallback(async(options:StartOptions)=>{
    const previous=stateRef.current
    if(previous.runId&&!TERMINAL.includes(previous.status??'queued'))await window.api.chat.cancelRun(previous.runId,'发起新翻译')
    const workspace=await window.api.chat.workspace()
    const conversation=options.conversationId?await window.api.chat.getConversation(options.conversationId):await window.api.chat.createConversation({title:`翻译：${options.text.slice(0,60)}`,mode:'ask',entry:'reader'})
    if(!conversation)throw new Error('翻译会话不存在')
    const context=options.paperId&&options.page&&options.documentVersion?[{kind:'selection' as const,workspaceId:workspace.workspaceId,paperId:options.paperId,page:options.page,text:options.text.slice(0,12000),documentVersion:options.documentVersion,origin:'pdf' as const}]:[]
    const submitted=await window.api.chat.submitTurn({conversationId:conversation.id,clientMessageId:'translation_'+crypto.randomUUID(),parentMessageId:conversation.activeLeafMessageId,text:options.text,context,modelBindingId,reasoning,mode:'ask',promptKind:'translation',permission:'readonly'})
    setState({runId:submitted.run.id,conversationId:conversation.id,status:submitted.run.status,output:'',error:''})
    return submitted
  },[modelBindingId,reasoning])
  const stop=useCallback(async()=>{if(stateRef.current.runId)await window.api.chat.cancelRun(stateRef.current.runId,'用户停止翻译')},[])
  return {...state,busy:!!state.runId&&!TERMINAL.includes(state.status??'queued'),start,stop}
}
