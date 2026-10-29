import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FocusPhase, ReadingFocusSettings } from '../../shared/calendar'
import { DEFAULT_READING_FOCUS_SETTINGS } from '../../shared/calendar'
import * as Icon from './Icon'

const PHASE_LABEL: Record<FocusPhase, string> = { reading: '文献阅读', short_break: '短休息', long_break: '长休息' }
const clampMinutes = (value: number, min: number, max: number): number => Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):min
const phaseSeconds = (settings: ReadingFocusSettings, phase: FocusPhase): number => {
  const minutes = phase === 'reading' ? settings.focusMinutes : phase === 'short_break' ? settings.shortBreakMinutes : settings.longBreakMinutes
  return Math.max(60, minutes * 60)
}
const mmss = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

type NumericFocusKey='focusMinutes'|'shortBreakMinutes'|'longBreakMinutes'|'waterMinutes'|'activityMinutes'
interface Props { paperId:number; paperTitle:string; visible:boolean }

export default function ReadingFocus({ paperId, paperTitle, visible }: Props): JSX.Element {
  const [settings,setSettings]=useState<ReadingFocusSettings>(DEFAULT_READING_FOCUS_SETTINGS)
  const [open,setOpen]=useState(false)
  const [running,setRunning]=useState(false)
  const [phase,setPhase]=useState<FocusPhase>('reading')
  const [remaining,setRemaining]=useState(DEFAULT_READING_FOCUS_SETTINGS.focusMinutes*60)
  const [cycle,setCycle]=useState(0)
  const [waterIn,setWaterIn]=useState(DEFAULT_READING_FOCUS_SETTINGS.waterMinutes*60)
  const [activityIn,setActivityIn]=useState(DEFAULT_READING_FOCUS_SETTINGS.activityMinutes*60)
  const [alert,setAlert]=useState('')
  const [error,setError]=useState('')
  const [savingSettings,setSavingSettings]=useState(false)
  const activeSecondsRef=useRef(0)

  useEffect(()=>{ void window.api.getSettings().then(settings=>{
    const focus=settings.readingFocus??DEFAULT_READING_FOCUS_SETTINGS
    setSettings(focus);setRemaining(phaseSeconds(focus,'reading'));setWaterIn(focus.waterMinutes*60);setActivityIn(focus.activityMinutes*60)
  }).catch(error=>setError(String(error))) },[])

  // Focus belongs to the currently open PDF. Switching papers or leaving Paper read mode pauses it.
  useEffect(()=>{
    setRunning(false);setPhase('reading');setCycle(0);setAlert('');activeSecondsRef.current=0
    setRemaining(phaseSeconds(settings,'reading'));setWaterIn(settings.waterMinutes*60);setActivityIn(settings.activityMinutes*60)
  },[paperId,settings])

  useEffect(()=>{ if(!visible&&phase==='reading')setRunning(false) },[visible,phase])
  useEffect(()=>{
    const pause=():void=>{ if(document.hidden&&phase==='reading')setRunning(false) }
    document.addEventListener('visibilitychange',pause)
    return ()=>document.removeEventListener('visibilitychange',pause)
  },[phase])

  const notify=useCallback((title:string,body:string):void=>{
    setAlert(body)
    if(!settings.notify)return
    try { if(Notification.permission==='denied')return; const notice=new Notification(title,{body,silent:false}); notice.onclick=()=>window.focus() } catch { /* in-app alert remains */ }
  },[settings.notify])

  const logPhase=useCallback((seconds:number,nextPhase:FocusPhase,countCycle:boolean):void=>{
    if(seconds<30)return
    const endedAt=new Date().toISOString(),startedAt=new Date(Date.now()-seconds*1000).toISOString()
    void window.api.focusLog({paperId,phase,seconds,startedAt,endedAt}).catch(error=>setError(String(error)))
    if(countCycle&&phase==='reading')setCycle(count=>(count+1)%4)
    setPhase(nextPhase);setRemaining(phaseSeconds(settings,nextPhase));activeSecondsRef.current=0;setRunning(true)
    notify(countCycle?'阶段完成':'阶段提前结束',`${PHASE_LABEL[phase]}${countCycle?'完成':'已记录'}，进入${PHASE_LABEL[nextPhase]}。`)
  },[notify,paperId,phase,settings])

  const tick=useCallback(()=>{
    setRemaining(current=>{
      const next=Math.max(0,current-1);activeSecondsRef.current+=1
      if(next>0)return next
      const nextPhase:FocusPhase=phase==='reading'?(cycle+1)%4===0?'long_break':'short_break':'reading'
      window.setTimeout(()=>logPhase(activeSecondsRef.current,nextPhase,true),0)
      return 0
    })
  },[cycle,logPhase,phase])

  useEffect(()=>{
    if(!running||(!visible&&phase==='reading'))return
    const timer=window.setInterval(tick,1000)
    return()=>window.clearInterval(timer)
  },[running,tick,visible,phase])

  // Hydration and activity reminders work even when the pomodoro timer is not started.
  useEffect(()=>{
    if(!visible||phase!=='reading')return
    const timer=window.setInterval(()=>{
      setWaterIn(current=>{
        const next=current-1
        if(next===0){notify('喝水提醒','阅读中记得喝一口水。');return settings.waterMinutes*60}
        return Math.max(0,next)
      })
      setActivityIn(current=>{
        const next=current-1
        if(next===0){notify('休息提醒','站起来活动一下，看看远处放松眼睛。');return settings.activityMinutes*60}
        return Math.max(0,next)
      })
    },1000)
    return()=>window.clearInterval(timer)
  },[notify,phase,settings.activityMinutes,settings.waterMinutes,visible])

  const updateSettings=useCallback((patch:Partial<ReadingFocusSettings>):void=>{
    setSettings(current=>{
      const next={...current,...patch}
      next.focusMinutes=clampMinutes(next.focusMinutes,1,180)
      next.shortBreakMinutes=clampMinutes(next.shortBreakMinutes,1,60)
      next.longBreakMinutes=clampMinutes(next.longBreakMinutes,1,120)
      next.waterMinutes=clampMinutes(next.waterMinutes,5,180)
      next.activityMinutes=clampMinutes(next.activityMinutes,5,180)
      if(!running){
        setRemaining(phaseSeconds(next,phase));setWaterIn(next.waterMinutes*60);setActivityIn(next.activityMinutes*60)
      }
      setSavingSettings(true)
      void window.api.saveSettings({readingFocus:next}).then(()=>setError('')).catch(error=>setError(String(error))).finally(()=>setSavingSettings(false))
      return next
    })
  },[phase,running])

  const reset=():void=>{ setRunning(false);setPhase('reading');setRemaining(phaseSeconds(settings,'reading'));activeSecondsRef.current=0;setAlert('') }
  const finishNow=():void=>{
    const nextPhase:FocusPhase=phase==='reading'?(cycle+1)%4===0?'long_break':'short_break':'reading'
    logPhase(activeSecondsRef.current,nextPhase,false)
  }
  const skip=():void=>{
    const nextPhase:FocusPhase=phase==='reading'?(cycle+1)%4===0?'long_break':'short_break':'reading'
    if(phase==='reading')setCycle(count=>(count+1)%4)
    setPhase(nextPhase);setRemaining(phaseSeconds(settings,nextPhase));activeSecondsRef.current=0;notify('跳过阶段',`已进入${PHASE_LABEL[nextPhase]}。`)
  }
  const progress=useMemo(()=>1-remaining/phaseSeconds(settings,phase),[phase,remaining,settings])
  const status=running?`${PHASE_LABEL[phase]} ${mmss(remaining)}`:'阅读专注'

  return <div className="reading-focus">
    <button type="button" className={`reading-focus-toggle ${running?'running':''}`} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(value=>!value)} title="读文献专注与提醒">
      <Icon.Clock size={13}/><span>{status}</span>
    </button>
    {open&&<div className="reading-focus-panel" role="dialog" aria-label="读文献专注与提醒">
      <header>
        <div><strong>{PHASE_LABEL[phase]}</strong><small>{paperTitle}</small></div>
        <span aria-live="polite">{running?'进行中':'已暂停'}</span>
      </header>
      <div className="reading-focus-timer" role="timer" aria-label={`${PHASE_LABEL[phase]}剩余 ${mmss(remaining)}`}>
        {mmss(remaining)}
      </div>
      <div className="reading-focus-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}><i style={{transform:`scaleX(${Math.max(0,Math.min(1,progress))})`}}/></div>
      <div className="reading-focus-cycle" aria-label={`本轮第 ${cycle+1} 次阅读`}>{[0,1,2,3].map(index=><i key={index} className={index<cycle?'on':''}/>)}</div>
      <div className="reading-focus-actions">
        <button type="button" className="primary" onClick={()=>setRunning(value=>!value)}>{running?'暂停':phase==='reading'&&remaining===phaseSeconds(settings,phase)?'开始专注':'继续'}</button>
        <button type="button" onClick={finishNow}>结束本阶段</button>
        <button type="button" onClick={reset}>重置</button>
        <button type="button" onClick={skip}>跳过阶段</button>
      </div>
      <dl className="reading-focus-reminders">
        <div><dt>喝水提醒</dt><dd>{phase==='reading'?mmss(waterIn):'休息后恢复'}</dd><button type="button" onClick={()=>{setWaterIn(settings.waterMinutes*60);setAlert('')}}>已喝水</button></div>
        <div><dt>活动提醒</dt><dd>{phase==='reading'?mmss(activityIn):'休息中'}</dd><button type="button" onClick={()=>{setActivityIn(settings.activityMinutes*60);setAlert('')}}>已活动</button></div>
      </dl>
      <div className="reading-focus-settings">
        {([['focusMinutes','阅读分钟'],['shortBreakMinutes','短休分钟'],['longBreakMinutes','长休分钟'],['waterMinutes','喝水间隔'],['activityMinutes','活动间隔']] as Array<[NumericFocusKey,string]>).map(([key,label])=>(
          <label key={key}>{label}<input type="number" min={key==='waterMinutes'||key==='activityMinutes'?5:1} max={180} value={settings[key]} onChange={event=>updateSettings({[key]:Number(event.target.value)} as Partial<ReadingFocusSettings>)} disabled={running}/></label>
        ))}
        <label className="wide"><input type="checkbox" checked={settings.notify} onChange={event=>updateSettings({notify:event.target.checked})}/>系统通知提醒</label>
      </div>
      {(alert||error)&&<p className={error?'reading-focus-error':'reading-focus-alert'} role={error?'alert':'status'}>{error||alert}</p>}
      {!error&&savingSettings&&<p className="reading-focus-alert" role="status">正在保存设置…</p>}
      <footer>只在 PDF 阅读页前台计时；离开阅读、切换论文或窗口隐藏时自动暂停。</footer>
    </div>}
  </div>
}




