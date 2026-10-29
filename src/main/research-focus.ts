import type Database from 'better-sqlite3'
import { focusLogSchema, type FocusLogInput, type FocusSummary } from '../shared/calendar'

interface SummaryRow {reading_seconds:number|null;break_seconds:number|null;cycles:number|null;last_at:string|null}
interface LastRow {last_at:string|null}

export class ResearchFocus {
  constructor(private readonly db:Database.Database){}
  log(workspaceId:string,input:FocusLogInput):FocusSummary {
    const data=focusLogSchema.parse(input)
    if(!this.db.prepare('SELECT 1 FROM papers p JOIN workspaces w ON p.library_root=w.normalized_root WHERE p.id=? AND w.id=?').get(data.paperId,workspaceId))throw new Error('文献不存在')
    this.db.prepare(`INSERT INTO research_focus_sessions(workspace_id,paper_id,phase,seconds,started_at,ended_at) VALUES(?,?,?,?,?,?)`).run(workspaceId,data.paperId,data.phase,data.seconds,data.startedAt,data.endedAt)
    const ended=new Date(data.endedAt)
    return this.summary(workspaceId,`${ended.getFullYear()}-${String(ended.getMonth()+1).padStart(2,'0')}-${String(ended.getDate()).padStart(2,'0')}`)
  }
  summary(workspaceId:string,date:string):FocusSummary {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))throw new Error('日期无效')
    const row=this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN phase='reading' THEN seconds ELSE 0 END),0) AS reading_seconds,
      COALESCE(SUM(CASE WHEN phase!='reading' THEN seconds ELSE 0 END),0) AS break_seconds,
      SUM(CASE WHEN phase='reading' THEN 1 ELSE 0 END) AS cycles,
      MAX(ended_at) AS last_at
      FROM research_focus_sessions WHERE workspace_id=? AND date(ended_at,'localtime')=?`).get(workspaceId,date) as SummaryRow
    return {readingSeconds:Number(row.reading_seconds??0),breakSeconds:Number(row.break_seconds??0),cycles:Number(row.cycles??0),lastAt:row.last_at??null}
  }
  last(workspaceId:string,paperId:number):string|null {
    const row=this.db.prepare('SELECT MAX(ended_at) AS last_at FROM research_focus_sessions WHERE workspace_id=? AND paper_id=?').get(workspaceId,paperId) as LastRow
    return row?.last_at??null
  }
}


