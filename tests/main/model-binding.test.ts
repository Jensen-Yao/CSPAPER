import assert from 'node:assert/strict'
import type { Settings } from '../../src/main/db'
import { modelSettings, normalizeModelSettings, snapshotModelBinding } from '../../src/main/model-config'

export async function testModelBinding(test:(name:string,fn:()=>unknown)=>Promise<void>):Promise<void> {
  await test('model binding resolves same model name across providers by profile ID',()=>{
    const base={
      libraryPath:'C:/binding-library',apiBase:'',apiKey:'',model:'same-model',provider:'custom',embedProvider:'local',ollamaUrl:'',ollamaEmbedModel:'',translateTarget:'中文',theme:'light',setupDone:true,models:[],thinkingLevel:'default'
    } as Settings
    const profiles=[
      {id:'profile-open',provider:'openai',apiBase:'http://127.0.0.1:1/v1',apiKey:'key-open',models:['same-model'],modelCaps:{'same-model':{reasoningLevels:[] as string[],caps:['json' as const,'system' as const],toolCalling:true}}},
      {id:'profile-other',provider:'other',apiBase:'http://127.0.0.1:2/v1',apiKey:'key-other',models:['same-model']}
    ]
    const settings=normalizeModelSettings({...base,modelBindingId:'profile-other:same-model',profiles})
    assert.equal(settings.modelBindingId,'profile-other:same-model')
    assert.equal(settings.apiBase,'http://127.0.0.1:2/v1')
    assert.equal(modelSettings(settings,'same-model','profile-open').apiBase,'http://127.0.0.1:1/v1')
    const open=snapshotModelBinding(settings,'profile-open:same-model','low','act')
    const other=snapshotModelBinding(settings,'profile-other:same-model','low','ask')
    assert.equal(open.apiBase,'http://127.0.0.1:1/v1')
    assert.equal(other.apiBase,'http://127.0.0.1:2/v1')
    assert.ok(open.capabilities.includes('tool_calling'))
    assert.throws(()=>snapshotModelBinding(settings,'profile-other:same-model','default','act'),/能力/)
  })
}
