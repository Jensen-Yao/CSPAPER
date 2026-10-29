import { z } from 'zod'

const datePattern=/^\d{4}-\d{2}-\d{2}$/
const dateSchema=z.string().refine(value=>{
  if(!datePattern.test(value))return false
  const date=new Date(value+'T00:00:00Z')
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
},'日期无效')
const timeSchema=z.string().refine(value=>{
  const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if(!match)return false
  return Number(match[1])*60+Number(match[2])<24*60
},'时间无效')
export const calendarDateSchema=dateSchema
export const calendarTimeSchema=timeSchema
export const calendarRecurrenceSchema=z.enum(['none','daily','weekly','monthly'])
export const calendarInputSchema=z.object({
  title:z.string().trim().min(1).max(200),
  date:dateSchema,
  startTime:timeSchema.nullable().default(null),
  endTime:timeSchema.nullable().refine(value=>value===null||true,'时间无效').default(null),
  kind:z.enum(['task','deadline','meeting','milestone']),
  notes:z.string().max(5000).default(''),
  completed:z.boolean().default(false),
  conversationId:z.string().max(128).nullable().default(null),
  recurrence:calendarRecurrenceSchema.default('none'),
  recurrenceUntil:dateSchema.nullable().default(null)
}).strict().superRefine(value=>{
  if(value.startTime&&value.endTime&&value.endTime<=value.startTime)throw new Error('结束时间必须晚于开始时间')
  if(value.recurrence!=='none'&&value.recurrenceUntil&&value.recurrenceUntil<value.date)throw new Error('重复截止不能早于开始日期')
})
export type CalendarRecurrence=z.infer<typeof calendarRecurrenceSchema>
export type CalendarInput=z.infer<typeof calendarInputSchema>
export interface CalendarEvent extends CalendarInput {id:number;occurrenceDate:string;createdAt:string;updatedAt:string}

export const focusPhaseSchema=z.enum(['reading','short_break','long_break'])
export const focusLogSchema=z.object({
  paperId:z.number().int().positive(),
  phase:focusPhaseSchema,
  seconds:z.number().int().min(1).max(24*60*60),
  startedAt:z.string().datetime(),
  endedAt:z.string().datetime()
}).strict().refine(value=>value.endedAt>value.startedAt,'结束时间必须晚于开始时间')
export type FocusPhase=z.infer<typeof focusPhaseSchema>
export type FocusLogInput=z.infer<typeof focusLogSchema>
export interface FocusSummary {
  readingSeconds:number
  breakSeconds:number
  cycles:number
  lastAt:string|null
}

export interface ReadingFocusSettings {
  focusMinutes:number
  shortBreakMinutes:number
  longBreakMinutes:number
  waterMinutes:number
  activityMinutes:number
  notify:boolean
}
export const DEFAULT_READING_FOCUS_SETTINGS:ReadingFocusSettings={focusMinutes:25,shortBreakMinutes:5,longBreakMinutes:15,waterMinutes:30,activityMinutes:45,notify:true}

