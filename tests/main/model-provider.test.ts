import assert from 'node:assert/strict'
import { streamModel, toSdkPrompt } from '../../src/main/models/provider'

export async function testModelProvider(test:(name:string,fn:()=>unknown)=>Promise<void>):Promise<void> {
  await test('AI SDK v7 system prompts are converted to instructions',async()=>{
    const prompt=toSdkPrompt([
      {role:'system',content:'SYSTEM-A'},
      {role:'user',content:'Q1'},
      {role:'system',content:'SYSTEM-B'},
      {role:'assistant',content:'A1'},
      {role:'user',content:'Q2'}
    ])
    assert.equal(prompt.instructions,'SYSTEM-A\n\nSYSTEM-B')
    assert.deepEqual(prompt.messages,[{role:'user',content:'Q1'},{role:'assistant',content:'A1'},{role:'user',content:'Q2'}])
  })
  await test('streaming transport serializes system guidance once and completes',async()=>{
    const bodies:unknown[]=[]
    const chunks=[
      `data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{content:'OK'},finish_reason:null}]})}\n\n`,
      `data: ${JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`,
      'data: [DONE]\n\n'
    ]
    let output=''
    for await(const delta of streamModel(
      [{role:'system',content:'SYSTEM'}, {role:'user',content:'QUESTION'}],
      {bindingId:'local:mock',profileId:'local',provider:'mock',model:'mock',apiBase:'http://127.0.0.1/v1',capabilities:['text','streaming'],reasoning:'default'},
      {apiKey:'',fetch:async(_url,init)=>{
        bodies.push(JSON.parse(String(init?.body??'{}')))
        const encoder=new TextEncoder()
    const body=new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(encoder.encode(chunk));controller.close()}})
    return new Response(body,{status:200,headers:{'content-type':'text/event-stream'}})
      }}
    )) output+=delta
    assert.equal(output,'OK')
    assert.equal(bodies.length,1)
    const body=bodies[0] as {instructions?:string;messages?:Array<{role:string;content?:string}>}
    assert.equal(body.messages?.filter(message=>message.role==='system').length,1)
    assert.equal(body.messages?.find(message=>message.role==='system')?.content,'SYSTEM')
    assert.equal(body.messages?.filter(message=>message.role==='user').length,1)
  })
}
