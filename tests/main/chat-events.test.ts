import assert from 'node:assert/strict'
import type Database from 'better-sqlite3'
import { ChatRepository } from '../../src/main/chat/repository'
import { ChatEventBus } from '../../src/main/chat/events'

export type Test = (name:string,fn:()=>unknown)=>Promise<void>
export async function testChatEvents(test:Test,db:Database.Database,root:string):Promise<void> {
  await test('conversation replay cursor spans runs whose local sequence restarts',()=>{
    const repository=new ChatRepository(db),workspace=repository.ensureWorkspace(root+'/event-tests')
    const conversation=repository.createConversation({workspaceId:workspace.id})
    const make=(clientMessageId:string)=>repository.createTurn({conversationId:conversation.id,clientMessageId,text:clientMessageId,modelBinding:{bindingId:'p:m',profileId:'p',provider:'mock',model:'m',capabilities:['text'],reasoning:'default'},context:{conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:100,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}})
    const first=make('first'),second=make('second'),bus=new ChatEventBus(repository)
    const one=bus.appendAndPublish(first.run.id,'message.delta',{delta:'A'})
    const two=bus.appendAndPublish(first.run.id,'message.delta',{delta:'B'})
    const three=bus.appendAndPublish(second.run.id,'message.delta',{delta:'C'})
    assert.deepEqual([one.seq,two.seq,three.seq],[1,2,1])
    assert.deepEqual([one.cursor,two.cursor,three.cursor],[1,2,3])
    assert.deepEqual(repository.listConversationEvents(conversation.id,two.cursor).map(event=>event.payload),[{delta:'C'}])
    assert.equal(repository.conversationEventCursor(conversation.id),3)
    assert.equal(repository.listConversationEvents(conversation.id,3).length,0)
  })
}
