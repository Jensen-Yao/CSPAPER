import type Database from 'better-sqlite3'
import { calendarDateSchema, calendarInputSchema, type CalendarEvent, type CalendarInput, type CalendarRecurrence } from '../shared/calendar'

interface Row {id:number;title:string;event_date:string;start_time:string|null;end_time:string|null;kind:CalendarEvent['kind'];notes:string;completed:number;conversation_id:string|null;recurrence:CalendarRecurrence;recurrence_until:string|null;created_at:string;updated_at:string}
const DAY=86400000
const dayMs=(date:string):number=>Date.parse(date+'T00:00:00Z')
const localDay=(date:Date):string=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`
function event(row:Row,occurrenceDate:string):CalendarEvent {
  return {id:row.id,title:row.title,date:row.event_date,occurrenceDate,startTime:row.start_time,endTime:row.end_time,kind:row.kind,notes:row.notes,completed:!!row.completed,conversationId:row.conversation_id,recurrence:row.recurrence,recurrenceUntil:row.recurrence_until,createdAt:row.created_at,updatedAt:row.updated_at}
}
function nextOccurrence(date:string,recurrence:CalendarRecurrence):string {
  const current=new Date(date+'T00:00:00Z')
  if(recurrence==='daily')current.setUTCDate(current.getUTCDate()+1)
  else if(recurrence==='weekly')current.setUTCDate(current.getUTCDate()+7)
  else current.setUTCMonth(current.getUTCMonth()+1)
  return localDay(current)
}

export class ResearchCalendar {
  constructor(private readonly db:Database.Database){}
  list(workspaceId:string,start:string,end:string):CalendarEvent[] {
    calendarDateSchema.parse(start);calendarDateSchema.parse(end)
    if(start>end)throw new Error('日历日期范围无效')
    const rows=this.db.prepare(`SELECT * FROM research_calendar_events
      WHERE workspace_id=? AND ((recurrence='none' AND event_date BETWEEN ? AND ?) OR (recurrence!='none' AND event_date<=? AND (recurrence_until IS NULL OR recurrence_until>=?)))
      ORDER BY event_date,start_time,id`).all(workspaceId,start,end,end,start) as Row[]
    const result:CalendarEvent[]=[]
    for(const row of rows) {
      let date=row.event_date,guard=0
      while(dayMs(date)<=dayMs(end)&&guard++<1000) {
        if(date>=start)result.push(event(row,date))
        if(row.recurrence==='none'||dayMs(date)>=dayMs(end))break
        if(row.recurrence_until&&date>=row.recurrence_until)break
        date=nextOccurrence(date,row.recurrence)
      }
    }
    return result.sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)||(a.startTime??'99:99').localeCompare(b.startTime??'99:99')||a.id-b.id)
  }
  save(workspaceId:string,input:CalendarInput,id?:number):CalendarEvent {
    const data=calendarInputSchema.parse(input)
    if(data.conversationId&&!this.db.prepare('SELECT 1 FROM conversations WHERE id=? AND workspace_id=?').get(data.conversationId,workspaceId))throw new Error('关联会话不属于当前工作区')
    const now=new Date().toISOString()
    if(id!==undefined) {
      if(!Number.isSafeInteger(id)||id<1)throw new Error('日程编号无效')
      const result=this.db.prepare(`UPDATE research_calendar_events SET title=?,event_date=?,start_time=?,end_time=?,kind=?,notes=?,completed=?,conversation_id=?,recurrence=?,recurrence_until=?,updated_at=? WHERE id=? AND workspace_id=?`).run(data.title,data.date,data.startTime,data.endTime,data.kind,data.notes,data.completed?1:0,data.conversationId,data.recurrence,data.recurrenceUntil,now,id,workspaceId)
      if(!result.changes)throw new Error('日程不存在或不属于当前工作区')
    } else {
      const result=this.db.prepare(`INSERT INTO research_calendar_events(workspace_id,title,event_date,start_time,end_time,kind,notes,completed,conversation_id,recurrence,recurrence_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(workspaceId,data.title,data.date,data.startTime,data.endTime,data.kind,data.notes,data.completed?1:0,data.conversationId,data.recurrence,data.recurrenceUntil,now,now)
      id=Number(result.lastInsertRowid)
    }
    const row=this.db.prepare('SELECT * FROM research_calendar_events WHERE id=? AND workspace_id=?').get(id,workspaceId) as Row
    return event(row,row.event_date)
  }
  remove(workspaceId:string,id:number):boolean {
    if(!Number.isSafeInteger(id)||id<1)throw new Error('日程编号无效')
    return this.db.prepare('DELETE FROM research_calendar_events WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0
  }
}



