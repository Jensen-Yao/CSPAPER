import type { RunEvent } from '../../shared/chat'
import type { ChatRepository } from './repository'

export type RunEventListener = (event:RunEvent)=>void
export interface EventSubscription { conversationId?:string|null;runId?:string|null;listener:RunEventListener }

/** Repository-backed event fan-out. Every append is persisted before it becomes visible to subscribers. */
export class ChatEventBus {
  private readonly subscriptions=new Set<EventSubscription>()
  constructor(private readonly repository:ChatRepository) {}

  appendAndPublish(runId:string,event:Parameters<ChatRepository['appendRunEvent']>[1],payload:unknown,messageId?:string):RunEvent {
    const persisted=this.repository.appendRunEvent(runId,event,payload,messageId)
    this.dispatch(persisted)
    return persisted
  }

  subscribe(input:{conversationId?:string|null;runId?:string|null;afterSeq?:number;listener:RunEventListener}):()=>void {
    const subscription:EventSubscription={conversationId:input.conversationId??null,runId:input.runId??null,listener:input.listener}
    this.subscriptions.add(subscription)
    if(input.runId) for(const event of this.repository.listRunEvents(input.runId,input.afterSeq??0)) input.listener(event)
    return () => this.subscriptions.delete(subscription)
  }

  private dispatch(event:RunEvent):void {
    for(const subscription of this.subscriptions) {
      if(subscription.conversationId&&subscription.conversationId!==event.conversationId) continue
      if(subscription.runId&&subscription.runId!==event.runId) continue
      try { subscription.listener(event) } catch(error) { console.error('Chat event subscriber failed',error) }
    }
  }
}
