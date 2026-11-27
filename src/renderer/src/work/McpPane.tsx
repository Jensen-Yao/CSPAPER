import { useEffect, useMemo, useState } from 'react'
import * as Icon from '../Icon'
import { useDialog } from '../Dialog'

export default function McpPane(): JSX.Element {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.api.agentMcpStatus>> | null>(null)
  const [servers,setServers]=useState<Array<{name:string;def:{command:string;args?:string[];env?:Record<string,string>}}>>([])
  const [presets,setPresets]=useState<Array<{name:string;description:string;command:string;args:string[]}>>([])
  const [form,setForm]=useState<{original?:string;name:string;command:string;args:string;env:string}|null>(null)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const dialog=useDialog()
  const refresh = (): void => {
    void window.api.agentMcpStatus().then(setSt).catch(() => {})
    void window.api.agentMcpServers().then(setServers).catch(()=>setServers([]))
  }
  useEffect(()=>{refresh();void window.api.agentMcpPresets().then(setPresets).catch(()=>{})},[])
  const save=async():Promise<void>=>{
    if(!form||!form.name.trim()||!form.command.trim())return
    setBusy(true);setErr('')
    try{
      let env:Record<string,string>|undefined
      if(form.env.trim()){try{env=JSON.parse(form.env)}catch{throw new Error('环境变量必须是 JSON 对象，如 {"API_KEY":"..."}')}}
      await window.api.agentMcpUpsert(form.name.trim(),{command:form.command.trim(),args:form.args.trim()?form.args.split(/\s+/):[],env})
      setForm(null);refresh()
    }catch(error){setErr(String(error).replace(/^Error: /,'').slice(0,180))}finally{setBusy(false)}
  }
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        插件 · MCP 服务器
        <span style={{ flex: 1 }} />
        <button className="wb-mini" onClick={() => void window.api.agentMcpOpenConfig()}>编辑 mcp.json</button>
        <button className="wb-mini" onClick={refresh} disabled={busy}>重新连接</button>
      </div>
      <div className="wb-dim" style={{ marginBottom: 10 }}>
        配置任意外部 MCP 服务器（Zotero / arXiv / 文件系统 / 联网搜索…），其工具自动挂载给智能体。下面可直接添加、编辑或删除服务器。
      </div>
      <div className="wb-card">
        <div className="wb-pane-head">{form?.original?'编辑服务器':'添加服务器'}</div>
        <div className="wb-mcp-presets">{presets.map(p=><button key={p.name} className="wb-chip" title={p.description} onClick={()=>setForm({name:p.name,command:p.command,args:p.args.join(' '),env:''})}>{p.name}</button>)}</div>
        {form&&<div className="wb-mcp-form">
          <input className="wb-plan-purpose" style={{width:'100%'}} placeholder="名称（英文，如 zotero）" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
          <input className="wb-plan-purpose" style={{width:'100%'}} placeholder="启动命令（如 npx / uvx / python）" value={form.command} onChange={e=>setForm({...form,command:e.target.value})}/>
          <input className="wb-plan-purpose" style={{width:'100%'}} placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem .）" value={form.args} onChange={e=>setForm({...form,args:e.target.value})}/>
          <input className="wb-plan-purpose" style={{width:'100%'}} placeholder={'环境变量 JSON（可选），如 {"API_KEY":"..."}'} value={form.env} onChange={e=>setForm({...form,env:e.target.value})}/>
          <div style={{display:'flex',gap:6}}><button className="wb-run" disabled={busy||!form.name.trim()||!form.command.trim()} onClick={()=>void save()}>{busy?'保存并连接中…':'保存并连接'}</button><button className="wb-mini" onClick={()=>setForm(null)}>取消</button></div>
        </div>}
        {!form&&<button className="wb-mini" onClick={()=>setForm({name:'',command:'',args:'',env:''})}>手动添加</button>}
        {err&&<div className="chat-message-error" role="alert">{err}</div>}
      </div>
      {servers.map(server=>{const r=st?.results.find(x=>x.server===server.name);return <div key={server.name} className="wb-card">
        <div className="wb-card-head">
          <span className="wb-card-title">{server.name}</span>
          <span className="wb-dim ellipsis">{server.def.command} {(server.def.args??[]).join(' ')}</span>
          <span style={{ flex: 1 }} />
          <span className={`wb-task-status ${r?.ok ? 'done' : 'error'}`}>{r?(r.ok?`✓ ${r.tools} 工具`:'连接失败'):'未连接'}</span>
        </div>
        {r?.error && <div className="wb-card-body">{r.error}</div>}
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <button className="wb-mini" onClick={()=>setForm({original:server.name,name:server.name,command:server.def.command,args:(server.def.args??[]).join(' '),env:server.def.env?JSON.stringify(server.def.env):''})}>编辑</button>
          <button className="wb-mini danger" onClick={()=>void dialog.confirm({title:`删除 MCP 服务器「${server.name}」？`,message:'只从 mcp.json 移除配置。',okText:'删除',danger:true}).then(ok=>ok?window.api.agentMcpRemove(server.name):null).then(()=>refresh())}>删除</button>
        </div>
      </div>})}
      {(st?.tools ?? []).length > 0 && (
        <div className="wb-card">
          <div className="wb-card-head"><span className="wb-card-title">已挂载 MCP 工具</span></div>
          <div className="wb-card-body">{(st!.tools ?? []).map((t) => t.fullName).join('、')}</div>
        </div>
      )}
      <div className="wb-dim">配置文件：{st?.configPath ?? ''}</div>
    </div>
  )
}
