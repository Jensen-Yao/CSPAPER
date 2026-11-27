import { useEffect, useMemo, useState } from 'react'
import * as Icon from '../Icon'
import { useDialog } from '../Dialog'
import { relTime } from './defs'
interface AutoRow {
  id: number
  name: string
  goal: string
  interval_minutes: number
  enabled: number
  last_run_at: string | null
  last_result: string | null
}
const AUTOS: Array<{ label: string; minutes: number }> = [
  { label: '每天', minutes: 1440 },
  { label: '每 6 小时', minutes: 360 },
  { label: '每 30 分钟', minutes: 30 }
]
function AutoRowCard({r,onChanged}:{r:AutoRow;onChanged:()=>void}): JSX.Element {
  const [runs,setRuns]=useState<Array<{id:number;started_at:string;finished_at:string|null;status:string;error:string|null;conversation_id:string|null}>|null>(null)
  const [next,setNext]=useState<string|null>(null)
  const [running,setRunning]=useState(false)
  const [editing,setEditing]=useState<{name:string;goal:string;interval:number}|null>(null)
  const [err,setErr]=useState('')
  const dialog=useDialog()
  useEffect(()=>{void window.api.agentAutoNext(r.id).then(setNext).catch(()=>setNext(null))},[r.id,r.last_run_at,r.enabled,r.interval_minutes])
  const intervalLabel=(minutes:number):string=>minutes%1440===0?`每 ${minutes/1440} 天`:minutes%60===0?`每 ${minutes/60} 小时`:`每 ${minutes} 分钟`
  const runNow=async():Promise<void>=>{setRunning(true);setErr('');try{const result=await window.api.agentAutoRunNow(r.id);if(!result.ok)setErr(result.error??'运行失败');onChanged();setRuns(await window.api.agentAutoRuns(r.id).catch(()=>[]))}catch(error){setErr(String(error).replace(/^Error: /,'').slice(0,180))}finally{setRunning(false)}}
  return <div className="wb-card">
    <div className="wb-card-head">
      <span className={`wb-task-status ${r.enabled ? 'done' : 'error'}`}>{r.enabled ? '启用' : '停用'}</span>
      <span className="wb-card-title ellipsis">{r.name}</span>
      <span style={{ flex: 1 }} />
      <button className="wb-mini" disabled={running||!r.enabled} title="立即执行一次并记录历史" onClick={()=>void runNow()}>{running?'运行中…':'立即运行'}</button>
      <button className="wb-mini" onClick={()=>setEditing({name:r.name,goal:r.goal,interval:r.interval_minutes})}>编辑</button>
      <button className="wb-mini" onClick={()=>void window.api.agentAutoToggle(r.id,!r.enabled).then(onChanged)}>{r.enabled?'停用':'启用'}</button>
      <button className="wb-mini danger" title="删除自动化" onClick={()=>void dialog.confirm({title:`删除自动化「${r.name}」？`,okText:'删除',danger:true}).then(ok=>ok?window.api.agentAutoRemove(r.id):false).then(deleted=>{if(deleted)onChanged()})}>✕</button>
    </div>
    {editing&&<div style={{margin:'6px 0'}}>
      <input className="wb-plan-purpose" style={{width:'100%',marginBottom:6}} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/>
      <textarea className="wb-plan-purpose" style={{width:'100%',minHeight:52,marginBottom:6}} value={editing.goal} onChange={e=>setEditing({...editing,goal:e.target.value})}/>
      <div style={{display:'flex',gap:6,alignItems:'center'}}><span className="wb-dim">间隔（分钟）</span><input className="wb-side-search" style={{width:100}} type="number" min={30} value={editing.interval} onChange={e=>setEditing({...editing,interval:Number(e.target.value)})}/><button className="wb-run" onClick={()=>void window.api.agentAutoUpdate(r.id,{name:editing.name,goal:editing.goal,intervalMinutes:editing.interval}).then(()=>{setEditing(null);onChanged()})}>保存</button><button className="wb-mini" onClick={()=>setEditing(null)}>取消</button></div>
    </div>}
    <div className="wb-card-body ellipsis-2">{r.goal}</div>
    <div className="wb-dim">{intervalLabel(r.interval_minutes)} · 下次：{r.enabled&&next?new Date(next).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—'} · 上次：{r.last_run_at?relTime(r.last_run_at):'未运行'}{r.last_result?` · ${r.last_result}`:''}</div>
    {err&&<div className="chat-message-error" role="alert">{err}</div>}
    <button className="wb-mini" onClick={()=>void window.api.agentAutoRuns(r.id).then(setRuns).catch(()=>setRuns([]))}>{runs?'收起历史':'运行历史'}</button>
    {runs&&<div className="wb-auto-runs">{runs.length===0&&<span className="wb-dim">还没有运行记录</span>}{runs.map(run=><div key={run.id} className={`wb-auto-run ${run.status}`}><span className={`wb-task-status ${run.status==='completed'?'done':run.status==='failed'||run.status==='interrupted'?'error':'running'}`}>{run.status}</span><span className="ellipsis" title={run.error??''}>{run.error??(run.conversation_id?`会话 ${run.conversation_id.slice(0,8)}`:'')}</span><span className="wb-dim">{new Date(run.started_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>)}</div>}
  </div>
}

export default function AutoPane(): JSX.Element {
  const [rows, setRows] = useState<AutoRow[] | null>(null)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState(1440)
  const [custom, setCustom] = useState('')
  const [err, setErr] = useState('')
  const refresh = (): void => {
    void window.api.agentAutoList().then((r) => setRows(r as unknown as AutoRow[])).catch(() => {})
  }
  useEffect(refresh, [])
  const resolvedMinutes=custom.trim()?Number(custom):minutes
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        自动化
        <span className="wb-dim">· 定时无头执行，结果进任务列表并通知</span>
      </div>
      <div className="wb-card">
        <div className="wb-pane-head">新建自动化</div>
        <input className="wb-plan-purpose" style={{ width: '100%', marginBottom: 6 }} placeholder="任务名（如：每日文献日报）" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="wb-plan-purpose" style={{ width: '100%', marginBottom: 6, minHeight: 52 }} placeholder="研究目标（同工作台指令，可指定技能如「文献日报」）" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {AUTOS.map((a) => (
            <button key={a.minutes} className={`wb-chip ${!custom.trim()&&minutes === a.minutes ? 'on' : ''}`} onClick={() => {setMinutes(a.minutes);setCustom('')}}>{a.label}</button>
          ))}
          <span className="wb-dim">自定义</span>
          <input className="wb-side-search" style={{ width: 90 }} type="number" min={30} placeholder="分钟" value={custom} onChange={(e)=>setCustom(e.target.value)} />
          <span style={{ flex: 1 }} />
          <button
            className="wb-run"
            disabled={!name.trim() || !goal.trim() || !(Number.isFinite(resolvedMinutes)&&resolvedMinutes>=30)}
            onClick={() => {
              void window.api.agentAutoCreate(name, goal, resolvedMinutes).then(() => {
                setName('')
                setGoal('')
                setErr('')
                refresh()
              }).catch(error=>setErr(String(error).replace(/^Error: /,'').slice(0,180)))
            }}
          >
            创建
          </button>
        </div>
        {err&&<div className="chat-message-error" role="alert">{err}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {(rows ?? []).map((r) => <AutoRowCard key={r.id} r={r} onChanged={refresh} />)}
        {rows && rows.length===0 && <div className="wb-dim">还没有自动化任务：创建后会按间隔自动执行，也可随时“立即运行”。</div>}
      </div>
    </div>
  )
}
