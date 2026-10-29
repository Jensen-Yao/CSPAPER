import { useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, CalendarInput, FocusSummary } from '../../shared/calendar'
import * as Icon from './Icon'
import { useDialog } from './Dialog'

const kinds:Record<CalendarInput['kind'],string>={task:'研究任务',deadline:'截止日期',meeting:'会议',milestone:'里程碑'}
const recurrences:Record<CalendarInput['recurrence'],string>={none:'不重复',daily:'每天',weekly:'每周',monthly:'每月'}
const localDate=(date:Date):string=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const monthStart=(date:Date):Date=>new Date(date.getFullYear(),date.getMonth(),1)
const weekStart=(date:Date):Date=>new Date(date.getFullYear(),date.getMonth(),date.getDate()-(date.getDay()+6)%7)
const addDays=(date:Date,count:number):Date=>new Date(date.getFullYear(),date.getMonth(),date.getDate()+count)
const blank=(date:string,conversationId:string|null):CalendarInput=>({title:'',date,startTime:'09:00',endTime:'10:00',kind:'task',notes:'',completed:false,conversationId,recurrence:'none',recurrenceUntil:null})
const timeText=(value:string|null):string=>value?value.slice(0,5):'全天'
const recurrenceText=(item:CalendarEvent):string=>item.recurrence==='none'?'':` · ${recurrences[item.recurrence]}`
const minutes=(seconds:number):string=>seconds<60?`${seconds} 秒`:`${Math.round(seconds/60)} 分钟`

export default function CalendarPane({conversationId,onStartTask,onOpenConversation}:{conversationId:string|null;onStartTask:(item:CalendarEvent)=>void;onOpenConversation:(id:string)=>void}):JSX.Element {
  const dialog=useDialog()
  const today=localDate(new Date())
  const [view,setView]=useState<'month'|'week'|'day'|'agenda'>('month')
  const [anchor,setAnchor]=useState(()=>monthStart(new Date()))
  const [selected,setSelected]=useState(today)
  const [events,setEvents]=useState<CalendarEvent[]>([])
  const [focus,setFocus]=useState<FocusSummary|null>(null)
  const [editId,setEditId]=useState<number|null>(null)
  const [draft,setDraft]=useState<CalendarInput|null>(null)
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
  const first=localDate(addDays(anchor,-7)),last=localDate(addDays(new Date(anchor.getFullYear(),anchor.getMonth()+1,0),7))
  const days=useMemo(()=>{
    const start=weekStart(new Date(anchor.getFullYear(),anchor.getMonth(),1))
    return Array.from({length:42},(_,index)=>addDays(start,index))
  },[anchor])
  const weekDays=useMemo(()=>Array.from({length:7},(_,index)=>addDays(weekStart(new Date(selected+'T12:00:00')),index)),[selected])
  const refresh=async():Promise<void>=>{
    setLoading(true);setError('')
    try{
      const [list,summary]=await Promise.all([window.api.calendarList(first,last),window.api.focusSummary(today)])
      setEvents(list);setFocus(summary)
    }catch(e){setError(String(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[first,last,today])
  const choose=(date:Date):void=>{const day=localDate(date);setSelected(day);setDraft(null);setEditId(null);if(view==='month'&&(date.getMonth()!==anchor.getMonth()||date.getFullYear()!==anchor.getFullYear()))setAnchor(monthStart(date))}
  const move=(direction:1|-1):void=>{
    const base=new Date(selected+'T12:00:00')
    if(view==='month')setAnchor(new Date(anchor.getFullYear(),anchor.getMonth()+direction,1))
    else if(view==='week')choose(addDays(weekStart(base),direction*7))
    else if(view==='day')choose(addDays(base,direction))
    else choose(addDays(base,direction*7))
  }
  const openEditor=(item?:CalendarEvent):void=>{
    setEditId(item?.id??null)
    setDraft(item?{title:item.title,date:item.date,startTime:item.startTime,endTime:item.endTime,kind:item.kind,notes:item.notes,completed:item.completed,conversationId:item.conversationId,recurrence:item.recurrence,recurrenceUntil:item.recurrenceUntil}:blank(selected,conversationId))
  }
  const save=async():Promise<void>=>{
    if(!draft||saving)return
    setSaving(true);setError('')
    try{
      const saved=await window.api.calendarSave(draft,editId??undefined)
      setSelected(saved.date);setAnchor(monthStart(new Date(saved.date+'T12:00:00')));setDraft(null);setEditId(null);await refresh()
    }catch(e){setError(String(e))}finally{setSaving(false)}
  }
  const toggle=async(item:CalendarEvent):Promise<void>=>{
    try{await window.api.calendarSave({title:item.title,date:item.date,startTime:item.startTime,endTime:item.endTime,kind:item.kind,notes:item.notes,conversationId:item.conversationId,recurrence:item.recurrence,recurrenceUntil:item.recurrenceUntil,completed:!item.completed},item.id);await refresh()}catch(e){setError(String(e))}
  }
  const remove=async(item:CalendarEvent):Promise<void>=>{
    if(!await dialog.confirm({title:'删除这条日程？',message:item.recurrence==='none'?`将删除「${item.title}」。`:`将删除整条重复日程「${item.title}」。`,okText:'删除',danger:true}))return
    try{await window.api.calendarRemove(item.id);if(editId===item.id){setDraft(null);setEditId(null)}await refresh()}catch(e){setError(String(e))}
  }
  const dayItems=(date:string):CalendarEvent[]=>events.filter(item=>item.occurrenceDate===date).sort((a,b)=>(a.startTime??'99:99').localeCompare(b.startTime??'99:99')||a.id-b.id)
  const selectedItems=dayItems(selected)
  const agendaItems=events.filter(item=>item.occurrenceDate>=selected).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)||(a.startTime??'99:99').localeCompare(b.startTime??'99:99')||a.id-b.id).slice(0,40)
  const title=view==='month'?`${anchor.getFullYear()} 年 ${anchor.getMonth()+1} 月`:view==='week'?`${localDate(weekDays[0])} ~ ${localDate(weekDays[6])}`:view==='day'?selected:'未来日程'
  return <div className="research-calendar">
    <header className="research-calendar-heading">
      <div><h1>科研日历</h1><p>安排研究任务、会议和截止日期；专注数据来自 Paper 阅读器</p></div>
      <div className="research-calendar-heading-actions">
        <div className="research-calendar-views" role="group" aria-label="日历视图">
          {(['month','week','day','agenda'] as const).map(item=><button key={item} className={view===item?'on':''} onClick={()=>setView(item)}>{({month:'月',week:'周',day:'日',agenda:'议程'})[item]}</button>)}
        </div>
        <button className="wb-run" onClick={()=>openEditor()}><Icon.Plus size={14}/> 新建日程</button>
      </div>
    </header>
    <div className="research-calendar-layout">
      <section className="research-calendar-main" aria-label="科研日历">
        <div className="research-calendar-nav">
          <div><button className="wb-icon-btn" aria-label="上一段时间" onClick={()=>move(-1)}><Icon.ChevronL/></button><strong>{title}</strong><button className="wb-icon-btn" aria-label="下一段时间" onClick={()=>move(1)}><Icon.ChevronR/></button></div>
          <button className="wb-mini" onClick={()=>{const now=new Date();setAnchor(monthStart(now));setSelected(localDate(now));setDraft(null)}}>今天</button>
        </div>
        {loading&&<p className="research-calendar-empty">正在加载日程…</p>}
        {!loading&&view==='month'&&<><div className="research-calendar-grid research-calendar-week">{['一','二','三','四','五','六','日'].map(day=><span key={day}>周{day}</span>)}</div>
          <div className="research-calendar-grid">
            {days.map(date=>{const day=localDate(date),items=dayItems(day);return <button key={day} className={`research-calendar-day ${day===selected?'selected':''} ${date.getMonth()!==anchor.getMonth()?'outside':''}`} aria-label={day+(items.length?`，${items.length} 条日程`:'')} aria-pressed={day===selected} onClick={()=>choose(date)}><span>{date.getDate()}</span>{day===today&&<small>今天</small>}{items.length>0&&<i>{items.length} 条</i>}</button>})}
          </div></>}
        {!loading&&view==='week'&&<div className="research-calendar-week-view">{weekDays.map(date=>{const day=localDate(date);return <section key={day}><header className={day===today?'today':''}><button onClick={()=>{setView('day');choose(date)}}>{day.slice(5)}</button><span>{day===today?'今天':''}</span></header>{dayItems(day).map(item=><button key={`${item.id}-${day}`} onClick={()=>choose(date)}><strong>{timeText(item.startTime)}</strong><span>{item.title}</span></button>)}</section>})}</div>}
        {!loading&&(view==='day'||view==='agenda')&&<div className="research-calendar-list">{(view==='day'?selectedItems:agendaItems).map((item,key)=>(
          <article key={`${item.id}-${item.occurrenceDate}-${key}`} className="research-calendar-list-row">
            <button className={`research-calendar-check ${item.completed?'done':''}`} aria-label={item.completed?`标记未完成：${item.title}`:`标记完成：${item.title}`} onClick={()=>void toggle(item)}>{item.completed?'✓':''}</button>
            <div><small>{view==='agenda'?item.occurrenceDate+' · ':''}{timeText(item.startTime)}{item.endTime?` ~ ${item.endTime}`:''} · {kinds[item.kind]}{recurrenceText(item)}</small><strong className={item.completed?'done':''}>{item.title}</strong>{item.notes&&<p>{item.notes}</p>}</div>
          </article>))}
          {(view==='day'?selectedItems:agendaItems).length===0&&<p className="research-calendar-empty">{view==='day'?'这一天还没有日程。':'暂无未来日程。'}</p>}</div>}
        <p className="research-calendar-foot">重复日程按整条管理；自动执行任务请使用“自动化”。</p>
      </section>
      <aside className="research-calendar-detail" aria-label="选中日期与今日专注">
        <div className="research-calendar-detail-head"><div><small>{view==='day'?'选中日期':'今日阅读'}</small><h2>{view==='day'?selected:today}</h2></div><button className="wb-mini" onClick={()=>openEditor()}>添加</button></div>
        {view!=='day'&&<section className="research-focus-summary">
          <strong>阅读专注</strong>
          <dl><div><dt>阅读</dt><dd>{focus?minutes(focus.readingSeconds):'—'}</dd></div><div><dt>休息</dt><dd>{focus?minutes(focus.breakSeconds):'—'}</dd></div><div><dt>完成轮</dt><dd>{focus?String(focus.cycles):'—'}</dd></div></dl>
          <p>计时只在 PDF 阅读页前台进行，离开阅读自动暂停。</p>
        </section>}
        {view!=='day'&&<div className="research-calendar-detail-head secondary"><div><small>选中日期</small><h2>{selected}</h2></div><button className="wb-mini" onClick={()=>setView('day')}>看当天</button></div>}
        {selectedItems.length===0&&view!=='day'&&<p className="research-calendar-empty">这一天还没有日程。</p>}
        {selectedItems.map(item=><article className="research-calendar-event" key={`${item.id}-${item.occurrenceDate}`}>
          <div className="research-calendar-event-head"><button className={`research-calendar-check ${item.completed?'done':''}`} aria-label={item.completed?`标记未完成：${item.title}`:`标记完成：${item.title}`} onClick={()=>void toggle(item)}>{item.completed?'✓':''}</button><div><small>{timeText(item.startTime)}{item.endTime?` ~ ${item.endTime}`:''} · {kinds[item.kind]}{recurrenceText(item)}</small><strong className={item.completed?'done':''}>{item.title}</strong></div></div>
          {item.notes&&<p>{item.notes}</p>}
          <div className="research-calendar-event-actions"><button onClick={()=>onStartTask(item)}>交给 Work</button>{item.conversationId&&<button onClick={()=>onOpenConversation(item.conversationId!)}>打开关联会话</button>}<button onClick={()=>openEditor(item)}>编辑</button><button onClick={()=>void remove(item)}>删除</button></div>
        </article>)}
        {draft&&<form className="research-calendar-form" onSubmit={e=>{e.preventDefault();void save()}}>
          <h3>{editId?'编辑日程':'新建日程'}</h3>
          <label>标题<input required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
          <div className="research-calendar-form-row">
            <label>日期<input required type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
            <label>类型<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as CalendarInput['kind']})}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <div className="research-calendar-form-row">
            <label>开始<input type="time" value={draft.startTime??''} onChange={e=>setDraft({...draft,startTime:e.target.value||null})}/></label>
            <label>结束<input type="time" value={draft.endTime??''} onChange={e=>setDraft({...draft,endTime:e.target.value||null})}/></label>
          </div>
          <div className="research-calendar-form-row">
            <label>重复<select value={draft.recurrence} onChange={e=>setDraft({...draft,recurrence:e.target.value as CalendarInput['recurrence']})}>{Object.entries(recurrences).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label>重复至<input type="date" disabled={draft.recurrence==='none'} value={draft.recurrenceUntil??''} onChange={e=>setDraft({...draft,recurrenceUntil:e.target.value||null})}/></label>
          </div>
          <label>备注<textarea rows={3} maxLength={5000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
          {draft.conversationId&&<small>已关联当前 Work 会话</small>}
          <div><button type="submit" className="wb-run" disabled={saving||!draft.title.trim()}>{saving?'保存中…':'保存日程'}</button><button type="button" className="wb-mini" onClick={()=>setDraft(null)}>取消</button></div>
        </form>}
        {error&&<p className="chat-message-error" role="alert">{error}</p>}
      </aside>
    </div>
  </div>
}
