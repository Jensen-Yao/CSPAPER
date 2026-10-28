import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import * as store from '../src/main/db'
import { snapshotModelBinding } from '../src/main/model-config'
import { streamModel } from '../src/main/models/provider'

const sourcePath=process.env.CSPAPER_REAL_SETTINGS_DB
if(!sourcePath||!fs.existsSync(sourcePath))throw new Error('real settings database missing')
const source=new Database(sourcePath,{readonly:true})
const row=source.prepare("SELECT value FROM meta WHERE key='settings'").get() as {value:string}|undefined
source.close()
if(!row?.value)throw new Error('real settings missing')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cspaper-real-model-'))
const target=new Database(path.join(temp,'cspaper.db'))
target.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)')
target.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('settings',row.value)
target.close()
app.setPath('userData',temp)
app.whenReady().then(async()=>{
  const started=Date.now()
  try {
    store.initDb()
    const settings=store.getSettings(),cases=[]
    for(const profile of settings.profiles??[]) {
      for(const model of profile.models.slice(0,2)) {
        const caseStarted=Date.now()
        const binding=snapshotModelBinding(settings,`${profile.id}:${model}`,settings.thinkingLevel??'default','ask')
        let output=''
        for await(const delta of streamModel([{role:'user',content:`只输出 JSON：{"ok":true,"model":"${model}"}。不要输出其他文字。`}],binding,{apiKey:profile.apiKey,signal:AbortSignal.timeout(60000)}))output+=delta
        let parsed:unknown=null
        try{parsed=JSON.parse(output.replace(/^```json\s*|```\s*$/g,'').trim())}catch{}
        cases.push({provider:binding.provider,model:binding.model,bindingId:binding.bindingId,latencyMs:Date.now()-caseStarted,length:output.length,sha256:crypto.createHash('sha256').update(output).digest('hex'),preview:output.slice(0,100),structuredJson:parsed!==null,parsedMatchesModel:(parsed as {model?:string}|null)?.model===model})
      }
    }
    const ok=cases.length>=2&&cases.every(item=>item.structuredJson&&item.parsedMatchesModel)
    console.log(JSON.stringify({ok,cases,totalLatencyMs:Date.now()-started},null,2))
    app.exit(ok?0:1)
  } catch(error) {
    console.error(JSON.stringify({ok:false,error:String(error).slice(0,500),latencyMs:Date.now()-started},null,2))
    app.exit(1)
  }
})
