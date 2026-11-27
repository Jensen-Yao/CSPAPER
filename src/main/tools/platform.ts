// 平台工具（v0.23）：让 Work 智能体能够使用任务 / 项目 / 日历 / 独立笔记 / 文献库清单 / 打开文献 / 导出。
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb, listPapers } from '../db'
import { ResearchProjects } from '../research-projects'
import { ResearchCalendar } from '../research-calendar'
import { taskInputOf } from '../../shared/projects'
import { calendarInputSchema } from '../../shared/calendar'
import type { ToolResult } from '../../shared/tools'
import type { ToolContext, ToolRegistry } from './registry'

export interface PlatformToolHooks { openPaper:(paperId:number)=>void }
const DEFAULT_PROJECT_NAME='研究任务'

function ok(data:unknown,summary:string,extra:Partial<ToolResult>={}):ToolResult {return {status:'success',data,summary,sources:[],artifacts:[],changes:[],...extra,durationMs:0}}

export function ensureDefaultProject(workspaceId:string) {
  const projects=new ResearchProjects(getDb())
  const existing=projects.listProjects(workspaceId).find(project=>project.status==='active')??projects.listProjects(workspaceId)[0]
  return existing??projects.saveProject(workspaceId,{name:DEFAULT_PROJECT_NAME,description:'Work 智能体默认归档项目',color:'#9e3b2f',status:'active',dueDate:null})
}

export function registerPlatformTools(registry:ToolRegistry,hooks:PlatformToolHooks):void {
  registry.register({
    definition:{name:'library.list',version:1,title:'浏览文献库',description:'列出文献库中的文献：支持按分类、阅读状态筛选，recent 按最近打开排序；返回 id、标题、作者、年份、分类、状态与上次打开时间。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:15000},
    schema:z.object({category:z.string().trim().max(200).optional(),status:z.enum(['todo','unread','reading','read','paused']).optional(),recent:z.boolean().default(false),limit:z.number().int().min(1).max(100).default(30)}),
    execute:async(_ctx,args)=>{
      let papers=listPapers().filter(paper=>!args.category||paper.category===args.category).filter(paper=>!args.status||paper.status===args.status)
      if(args.recent)papers=papers.filter(paper=>paper.opened_at).sort((a,b)=>(b.opened_at??'').localeCompare(a.opened_at??''))
      papers=papers.slice(0,args.limit)
      return ok({total:listPapers().length,returned:papers.length,papers:papers.map(paper=>({id:paper.id,slug:paper.slug,title:paper.title,authors:paper.authors,year:paper.year,venue:paper.venue,category:paper.category,status:paper.status,sourceKind:paper.source_kind,openedAt:paper.opened_at??null,summary:paper.summary?.slice(0,200)??null}))},
        args.recent?`最近打开的 ${papers.length} 篇文献`:`文献库共 ${listPapers().length} 篇，返回 ${papers.length} 篇`)
    }
  })
  registry.register({
    definition:{name:'paper.open',version:1,title:'打开文献',description:'在阅读器中打开指定文献（可定位页码），便于用户查看正在讨论的论文。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperId:z.number().int().positive()}),
    execute:async(_ctx,args)=>{
      const paper=listPapers().find(item=>item.id===args.paperId)
      if(!paper)throw new Error(`文献 #${args.paperId} 不存在`)
      hooks.openPaper(args.paperId)
      return ok({paperId:paper.id,title:paper.title},`已在阅读器打开：${paper.title}`)
    }
  })
  registry.register({
    definition:{name:'task.create',version:1,title:'创建任务',description:'在研究项目中创建任务；未指定 projectId 时归入默认项目。可关联文献与当前会话。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({title:z.string().trim().min(1).max(240),projectId:z.number().int().positive().optional(),notes:z.string().max(5000).default(''),priority:z.enum(['low','medium','high']).default('medium'),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),paperId:z.number().int().positive().nullable().default(null)}),
    execute:async(ctx,args)=>{
      const projects=new ResearchProjects(getDb())
      const project=args.projectId?projects.listProjects(ctx.workspaceId).find(item=>item.id===args.projectId):ensureDefaultProject(ctx.workspaceId)
      if(!project)throw new Error('指定的项目不存在')
      const task=projects.saveTask(ctx.workspaceId,{projectId:project.id,title:args.title,notes:args.notes,priority:args.priority,status:'todo',dueDate:args.dueDate,paperId:args.paperId,conversationId:ctx.runId?ctx.repository.getRun(ctx.runId)?.conversationId??null:null})
      return ok({taskId:task.id,projectId:project.id,projectName:task.projectName,title:task.title},`已创建任务「${task.title}」（${task.projectName}）`,{changes:[{entity:'task',entityId:String(task.id),action:'create',after:{title:task.title,projectId:project.id,status:'todo',dueDate:task.dueDate},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'task.update',version:1,title:'更新任务',description:'更新任务状态（todo / doing / done）、标题、备注、优先级或截止日期。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({taskId:z.number().int().positive(),status:z.enum(['todo','doing','done']).optional(),title:z.string().trim().min(1).max(240).optional(),notes:z.string().max(5000).optional(),priority:z.enum(['low','medium','high']).optional(),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()}),
    execute:async(ctx,args)=>{
      const projects=new ResearchProjects(getDb())
      const task=projects.listTasks(ctx.workspaceId).find(item=>item.id===args.taskId)
      if(!task)throw new Error(`任务 #${args.taskId} 不存在`)
      const before={title:task.title,status:task.status,priority:task.priority,dueDate:task.dueDate}
      const input={...taskInputOf(task),...(args.title!==undefined?{title:args.title}:{}),...(args.notes!==undefined?{notes:args.notes}:{}),...(args.priority!==undefined?{priority:args.priority}:{}),...(args.dueDate!==undefined?{dueDate:args.dueDate}:{}),...(args.status!==undefined?{status:args.status}:{})}
      const updated=projects.saveTask(ctx.workspaceId,input,task.id)
      return ok({taskId:updated.id,title:updated.title,status:updated.status},`任务「${updated.title}」已更新为 ${updated.status}`,{changes:[{entity:'task',entityId:String(updated.id),action:'update',before,after:{title:updated.title,status:updated.status,priority:updated.priority,dueDate:updated.dueDate},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'project.create',version:1,title:'创建项目',description:'创建研究项目，用于归档任务、文献与日程。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({name:z.string().trim().min(1).max(120),description:z.string().max(2000).default(''),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#9e3b2f'),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)}),
    execute:async(ctx,args)=>{
      const project=new ResearchProjects(getDb()).saveProject(ctx.workspaceId,{name:args.name,description:args.description,color:args.color,status:'active',dueDate:args.dueDate})
      return ok({projectId:project.id,name:project.name},`已创建项目「${project.name}」`,{changes:[{entity:'project',entityId:String(project.id),action:'create',after:{name:project.name},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'calendar.create',version:1,title:'创建日程',description:'在科研日历中创建日程（task / deadline / meeting / milestone），可设置重复。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({title:z.string().trim().min(1).max(200),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),kind:z.enum(['task','deadline','meeting','milestone']).default('task'),notes:z.string().max(5000).default(''),recurrence:z.enum(['none','daily','weekly','monthly']).default('none'),recurrenceUntil:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)}),
    execute:async(ctx,args)=>{
      const input=calendarInputSchema.parse({...args,completed:false,conversationId:ctx.runId?ctx.repository.getRun(ctx.runId)?.conversationId??null:null})
      const event=new ResearchCalendar(getDb()).save(ctx.workspaceId,input)
      return ok({eventId:event.id,title:event.title,date:event.occurrenceDate,startTime:event.startTime},`已创建日程「${event.title}」（${event.occurrenceDate}）`,{changes:[{entity:'calendar',entityId:String(event.id),action:'create',after:{title:event.title,date:event.occurrenceDate,startTime:event.startTime},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'standalone_note.save',version:1,title:'保存独立笔记',description:'保存一篇不挂在某篇文献下的独立笔记（Markdown）；传 noteId 时覆盖更新。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({title:z.string().trim().min(1).max(300),body:z.string().trim().min(1).max(200000),noteId:z.number().int().positive().optional()}),
    execute:async(ctx,args)=>{
      const db=getDb()
      let id=args.noteId
      const before=id?db.prepare('SELECT title, body_md FROM standalone_notes WHERE id=?').get(id) as {title:string;body_md:string}|undefined:undefined
      if(before)db.prepare("UPDATE standalone_notes SET title=?, body_md=?, updated_at=datetime('now','localtime') WHERE id=?").run(args.title,args.body,id)
      else id=Number(db.prepare('INSERT INTO standalone_notes(title, body_md) VALUES(?,?)').run(args.title,args.body).lastInsertRowid)
      return ok({noteId:id,title:args.title,chars:args.body.length},before?`已更新独立笔记「${args.title}」`:`已保存独立笔记「${args.title}」`,{artifacts:[ctx.repository.addArtifact({id:'art_'+randomUUID(),runId:ctx.runId,kind:'note',entityId:`standalone-${id}`,title:args.title,uri:`cspaper://note/${id}`})],changes:[{entity:'note',entityId:`standalone-${id}`,action:before?'update':'create',before,after:{title:args.title,chars:args.body.length},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'standalone_note.read',version:1,title:'读取独立笔记',description:'按 id 读取独立笔记，或按关键词检索独立笔记标题与正文。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({noteId:z.number().int().positive().optional(),query:z.string().trim().max(200).optional(),limit:z.number().int().min(1).max(20).default(10)}),
    execute:async(_ctx,args)=>{
      const db=getDb()
      if(args.noteId) {
        const note=db.prepare('SELECT id, title, body_md, updated_at FROM standalone_notes WHERE id=?').get(args.noteId) as {id:number;title:string;body_md:string;updated_at:string}|undefined
        if(!note)throw new Error(`独立笔记 #${args.noteId} 不存在`)
        return ok({id:note.id,title:note.title,updatedAt:note.updated_at,body:note.body_md.slice(0,30000)},`已读取独立笔记「${note.title}」`)
      }
      const term=(args.query??'').trim()
      const rows=term?db.prepare('SELECT id, title, updated_at, length(body_md) AS chars FROM standalone_notes WHERE title LIKE ? OR body_md LIKE ? ORDER BY updated_at DESC LIMIT ?').all(`%${term}%`,`%${term}%`,args.limit):db.prepare('SELECT id, title, updated_at, length(body_md) AS chars FROM standalone_notes ORDER BY updated_at DESC LIMIT ?').all(args.limit)
      return ok({notes:rows},rows.length?`${rows.length} 篇独立笔记`:'没有匹配的独立笔记')
    }
  })
  registry.register({
    definition:{name:'export.markdown',version:1,title:'导出 Markdown',description:'把报告、笔记或对比结论导出为 Markdown 文件（文档目录下的 CSPAPER/exports）。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true},
    schema:z.object({title:z.string().trim().min(1).max(200),content:z.string().trim().min(1).max(500000)}),
    execute:async(ctx,args)=>{
      const dir=path.join(app.getPath('documents'),'CSPAPER','exports')
      fs.mkdirSync(dir,{recursive:true})
      const safe=args.title.replace(/[<>:"/\\|?*\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,80)||'导出'
      const file=path.join(dir,`${new Date().toISOString().slice(0,10)}-${safe}.md`)
      fs.writeFileSync(file,args.content.endsWith('\n')?args.content:args.content+'\n','utf8')
      return ok({file,chars:args.content.length},`已导出：${file}`,{artifacts:[ctx.repository.addArtifact({id:'art_'+randomUUID(),runId:ctx.runId,kind:'file',title:safe,uri:file})],changes:[{entity:'file',entityId:file,action:'create',after:{chars:args.content.length},reversible:true}]})
    }
  })
}
