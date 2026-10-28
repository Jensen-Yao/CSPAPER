import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as store from '../src/main/db'
import { ChatRepository } from '../src/main/chat/repository'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-bench-chat-'))
app.setPath('userData',path.join(root,'data'))
const rounds=Number(process.env.BENCH_CHAT_ROUNDS??300)
app.whenReady().then(()=>{
  store.initDb()
  const repository=new ChatRepository(store.getDb()),workspace=repository.ensureWorkspace(path.join(root,'library'))
  const conversation=repository.createConversation({workspaceId:workspace.id,title:'长会话基准'})
  const model={bindingId:'bench',profileId:'bench',provider:'bench',model:'bench',capabilities:['text'],reasoning:'default' as const}
  const created=Date.now()
  let parentMessageId:string|null=null,lastRunId=''
  for(let i=0;i<rounds;i++){
    const context={conversationId:conversation.id,runId:'pending',refs:[],budget:{totalChars:1,usedChars:0,reservedForOutput:0},diagnostics:[],createdAt:new Date().toISOString()}
    const turn=repository.createTurn({conversationId:conversation.id,clientMessageId:'bench-'+i,parentMessageId,text:'问题 '+i+'. '.repeat(20),context,modelBinding:model})
    for(let delta=0;delta<20;delta++) {
      const text=`回答 ${i} 的第 ${delta} 段。`.repeat(5)
      repository.appendMessageText(turn.assistantMessage.id,text)
      repository.appendRunEvent(turn.run.id,'message.delta',{delta:text},turn.assistantMessage.id)
    }
    repository.updateMessage(turn.assistantMessage.id,{status:'complete'})
    repository.updateRunStatus(turn.run.id,'completed')
    repository.appendRunEvent(turn.run.id,'run.completed',{status:'completed'})
    parentMessageId=turn.assistantMessage.id;lastRunId=turn.run.id
  }
  const writeMs=Date.now()-created
  const readStarted=performance.now(),page=repository.loadMessages({conversationId:conversation.id,limit:200}),readMs=performance.now()-readStarted
  const events=repository.listRunEvents(lastRunId).length
  const output={kind:'persistence',rounds,deltasPerRound:20,writeMs,readMs,messages:page.items.length,events,fixture:root}
  console.log(JSON.stringify(output,null,2));app.exit(page.items.length===Math.min(200,rounds*2)&&events===21&&page.items.at(-1)?.status==='complete'?0:1)
}).catch(error=>{console.error(error);app.exit(1)})
