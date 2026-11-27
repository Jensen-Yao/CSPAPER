import { useEffect, useMemo, useState } from 'react'
import * as Icon from '../Icon'
import { useDialog } from '../Dialog'
import type { SkillChoice } from './defs'
export default function SkillsPane({skills,selected,onToggle,onRefresh,onUse}:{skills:SkillChoice[];selected:Array<Pick<SkillChoice,'name'|'source'>>;onToggle:(skill:SkillChoice)=>void;onRefresh:()=>void;onUse:()=>void}): JSX.Element {
  useEffect(onRefresh, [])
  const dialog=useDialog()
  const [editing,setEditing]=useState<{originalName?:string;name:string;description:string;body:string}|null>(null)
  const [err,setErr]=useState('')
  const openEditor=async(skill?:SkillChoice)=>{
    setErr('')
    if(!skill){setEditing({name:'',description:'',body:''});return}
    try{const full=await window.api.agentSkillsGet(skill.name);setEditing(full?{originalName:full.name,name:full.name,description:full.description,body:full.body}:{name:skill.name,description:skill.description,body:''})}catch(error){setErr(String(error))}
  }
  const save=async():Promise<void>=>{
    if(!editing||!editing.name.trim())return
    try{await window.api.agentSkillsSave({...editing,name:editing.name.trim()});setEditing(null);onRefresh()}catch(error){setErr(String(error).replace(/^Error: /,'').slice(0,160))}
  }
  return (
    <div className="wb-pane-full">
      <div className="wb-pane-head">
        技能
        <span style={{ flex: 1 }} />
        <button className="wb-mini" onClick={() => void openEditor()}>新建技能</button>
        <button className="wb-mini" onClick={() => void window.api.agentSkillsImport().then(() => onRefresh())}>导入 .md</button>
        <button className="wb-mini" onClick={() => void window.api.agentSkillsOpenDir()}>
          打开技能目录
        </button>
      </div>
      {err&&<div className="chat-message-error" role="alert">{err}</div>}
      {editing&&<div className="wb-card" style={{margin:'0 0 12px'}}>
        <div className="wb-card-title">{editing.originalName?'编辑技能':'新建技能'}</div>
        <input className="wb-side-search" style={{width:'100%',margin:'8px 0 6px'}} placeholder="技能名称" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/>
        <input className="wb-side-search" style={{width:'100%',margin:'0 0 6px'}} placeholder="一句话说明（何时使用）" value={editing.description} onChange={e=>setEditing({...editing,description:e.target.value})}/>
        <textarea className="wb-plan-purpose" style={{width:'100%',minHeight:120}} placeholder="技能正文：流程步骤、质量要求、用到的工具名…" value={editing.body} onChange={e=>setEditing({...editing,body:e.target.value})}/>
        <div style={{display:'flex',gap:6}}><button className="wb-run" disabled={!editing.name.trim()} onClick={()=>void save()}>保存</button><button className="wb-mini" onClick={()=>setEditing(null)}>取消</button></div>
      </div>}
      <div className="wb-dim" style={{ marginBottom: 10 }}>
        技能是可复用的研究流程说明。选择后，其正文会随任务一起发送给模型；工具执行仍遵循当前权限设置。
      </div>
      <div className="wb-card-grid">
        {skills.map((sk) => (
          <div key={`${sk.source}:${sk.name}`} className="wb-card">
            <div className="wb-card-head">
              <span className="wb-card-title">{sk.name}</span>
              <span className={`wb-task-status ${sk.source === 'builtin' ? 'done' : 'running'}`}>{sk.source === 'builtin' ? '内置' : '用户'}</span>
            </div>
            <div className="wb-card-body">{sk.description || '—'}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <button className="wb-mini" aria-pressed={selected.some(item=>item.name===sk.name&&item.source===sk.source)} onClick={()=>onToggle(sk)}>{selected.some(item=>item.name===sk.name&&item.source===sk.source)?'移除技能':'添加到任务'}</button>
              {sk.source==='user'&&<>
                <button className="wb-mini" onClick={()=>void openEditor(sk)}>编辑</button>
                <button className="wb-mini danger" onClick={()=>void dialog.confirm({title:`删除技能「${sk.name}」？`,message:'只删除用户目录中的这份技能文件。',okText:'删除',danger:true}).then(ok=>ok?window.api.agentSkillsDelete(sk.name):false).then(deleted=>{if(deleted)onRefresh()})}>删除</button>
              </>}
            </div>
          </div>
        ))}
      </div>
      {selected.length>0&&<button className="wb-run" onClick={onUse}>返回任务 · 已选 {selected.length} 个技能</button>}
    </div>
  )
}

// ---------- 自动化面板 ----------
