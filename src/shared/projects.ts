import { z } from 'zod'

const dateSchema=z.string().refine(value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
  const date=new Date(value+'T00:00:00Z')
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value
},'日期无效')

export const projectStatusSchema=z.enum(['active','paused','done'])
export const taskStatusSchema=z.enum(['todo','doing','done'])
export const taskPrioritySchema=z.enum(['low','medium','high'])

export const projectInputSchema=z.object({
  name:z.string().trim().min(1).max(120),
  description:z.string().trim().max(2000).default(''),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#9e3b2f'),
  status:projectStatusSchema.default('active'),
  dueDate:dateSchema.nullable().default(null)
}).strict()
export type ProjectInput=z.infer<typeof projectInputSchema>
export type ProjectStatus=z.infer<typeof projectStatusSchema>

export const taskInputSchema=z.object({
  projectId:z.number().int().positive(),
  title:z.string().trim().min(1).max(240),
  notes:z.string().trim().max(5000).default(''),
  status:taskStatusSchema.default('todo'),
  priority:taskPrioritySchema.default('medium'),
  dueDate:dateSchema.nullable().default(null),
  paperId:z.number().int().positive().nullable().default(null),
  conversationId:z.string().max(128).nullable().default(null)
}).strict()
export type TaskInput=z.infer<typeof taskInputSchema>
export type TaskStatus=z.infer<typeof taskStatusSchema>
export type TaskPriority=z.infer<typeof taskPrioritySchema>

export interface ResearchProject {
  id:number
  name:string
  description:string
  color:string
  status:ProjectStatus
  dueDate:string|null
  taskCounts:{todo:number;doing:number;done:number}
  createdAt:string
  updatedAt:string
}
/** 把已保存的任务还原成可写回的输入（改状态 / 拖拽换列 / 编辑时复用）。 */
export function taskInputOf(task:ResearchTask):TaskInput {
  return {projectId:task.projectId,title:task.title,notes:task.notes,status:task.status,priority:task.priority,dueDate:task.dueDate,paperId:task.paperId,conversationId:task.conversationId}
}

export interface ResearchTask {
  id:number
  projectId:number
  projectName:string
  title:string
  notes:string
  status:TaskStatus
  priority:TaskPriority
  dueDate:string|null
  paperId:number|null
  conversationId:string|null
  completedAt:string|null
  createdAt:string
  updatedAt:string
}
