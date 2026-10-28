import assert from 'node:assert/strict'
import type { ChatApi, ConversationSnapshot } from '../../src/shared/chat-api'
import type { Conversation, RunEvent } from '../../src/shared/chat'
import { ConversationStore } from '../../src/renderer/src/features/chat/conversation-store'
import type { Test } from '../main/chat-events.test'

export async function testConversationStore(test:Test):Promise<void> {
  await test('shared conversation store switches listeners, deduplicates deltas and closes snapshot races',async()=>{
    const now=new Date().toISOString()
    const conversations:Conversation[]=['a','b'].map(id=>({id,workspaceId:'w',title:id,mode:'ask',entry:'global',activeLeafMessageId:'message-'+id,createdAt:now,updatedAt:now,archivedAt:null}))
    const snapshots:Record<string,ConversationSnapshot>=Object.fromEntries(conversations.map(conversation=>[conversation.id,{conversation,items:[{id:'message-'+conversation.id,conversationId:conversation.id,parentId:null,clientMessageId:null,role:'assistant',parts:[{type:'text',text:''}],status:'streaming',runId:'run-'+conversation.id,createdAt:now,updatedAt:now}],hasMore:false,eventCursor:0,runs:[]}]))
    let listener:(event:RunEvent)=>void=()=>{},registrations=0,hold:((snapshot:ConversationSnapshot)=>void)|undefined
    let held=false
    const api={
      workspace:async()=>({workspaceId:'w'}),listConversations:async()=>({items:conversations,nextCursor:null}),
      onEvent:(cb:(event:RunEvent)=>void)=>{listener=cb;registrations++;return ()=>{}},
      snapshot:async({conversationId}:{conversationId:string})=>{
        const copy=structuredClone(snapshots[conversationId])
        if(held)return new Promise<ConversationSnapshot>(resolve=>hold=resolve)
        return copy
      }
    } as unknown as ChatApi
    const store=new ConversationStore(api)
    const event=(id:string,cursor:number,delta:string):RunEvent=>({conversationId:id,messageId:'message-'+id,runId:'run-'+id,seq:cursor,cursor,type:'message.delta',payload:{delta},createdAt:now})
    await store.initialize();assert.equal(registrations,1)
    listener(event('a',1,'A'));listener(event('a',1,'A'))
    assert.equal(JSON.stringify(store.getSnapshot().views.a.messages[0].parts),'[{"type":"text","text":"A"}]')
    await store.selectConversation('b');listener(event('b',1,'B'));listener(event('a',2,'2'))
    assert.equal(store.getSnapshot().activeId,'b')
    assert.ok(JSON.stringify(store.getSnapshot().views.b.messages[0].parts).includes('B'))
    assert.ok(!JSON.stringify(store.getSnapshot().views.b.messages[0].parts).includes('A'))
    held=true
    const reload=store.reload('b')
    const captured=structuredClone(snapshots.b);captured.eventCursor=1;captured.items[0].parts=[{type:'text',text:'B'}]
    listener(event('b',2,'2'))
    hold!(captured);held=false;await reload
    assert.equal(JSON.stringify(store.getSnapshot().views.b.messages[0].parts),'[{"type":"text","text":"B2"}]')
    assert.equal(store.getSnapshot().views.b.cursor,2)
    store.dispose()
  })
}
