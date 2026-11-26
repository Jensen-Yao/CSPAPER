import type Database from 'better-sqlite3'
import { projectInputSchema, taskInputSchema, type ProjectInput, type ResearchProject, type ResearchTask, type TaskInput } from '../shared/projects'

interface ProjectRow {id:number;workspace_id:string;name:string;description:string;color:string;status:ResearchProject['status'];due_date:string|null;created_at:string;updated_at:string}
interface TaskRow {id:number;workspace_id:string;project_id:number;title:string;notes:string;status:ResearchTask['status'];priority:ResearchTask['priority'];due_date:string|null;paper_id:number|null;conversation_id:string|null;completed_at:string|null;created_at:string;updated_at:string}
interface CountRow {todo:number;doing:number;done:number}

export class ResearchProjects {
  constructor(private readonly db:Database.Database){}

  listProjects(workspaceId:string):ResearchProject[] {
    const rows=this.db.prepare('SELECT * FROM research_projects WHERE workspace_id=? ORDER BY updated_at DESC,id DESC').all(workspaceId) as ProjectRow[]
    const count=this.db.prepare("SELECT SUM(CASE WHEN status='todo' THEN 1 ELSE 0 END) todo,SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) doing,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done FROM research_tasks WHERE project_id=?")
    return rows.map(row=>({id:row.id,name:row.name,description:row.description,color:row.color,status:row.status,dueDate:row.due_date,taskCounts:this.counts(count.get(row.id) as CountRow|undefined),createdAt:row.created_at,updatedAt:row.updated_at}))
  }

  saveProject(workspaceId:string,input:ProjectInput,id?:number):ResearchProject {
    const data=projectInputSchema.parse(input)
    const now=new Date().toISOString()
    if(id!==undefined) {
      if(!Number.isSafeInteger(id)||id<1)throw new Error('项目编号无效')
      const result=this.db.prepare('UPDATE research_projects SET name=?,description=?,color=?,status=?,due_date=?,updated_at=? WHERE id=? AND workspace_id=?').run(data.name,data.description,data.color,data.status,data.dueDate,now,id,workspaceId)
      if(!result.changes)throw new Error('项目不存在或不属于当前工作区')
    } else {
      const result=this.db.prepare('INSERT INTO research_projects(workspace_id,name,description,color,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(workspaceId,data.name,data.description,data.color,data.status,data.dueDate,now,now)
      id=Number(result.lastInsertRowid)
    }
    return this.listProjects(workspaceId).find(project=>project.id===id)!
  }

  removeProject(workspaceId:string,id:number):boolean {
    if(!Number.isSafeInteger(id)||id<1)throw new Error('项目编号无效')
    return this.db.prepare('DELETE FROM research_projects WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0
  }

  listTasks(workspaceId:string,projectId?:number):ResearchTask[] {
    if(projectId!==undefined&&(!Number.isSafeInteger(projectId)||projectId<1))throw new Error('项目编号无效')
    const rows=projectId===undefined
      ? this.db.prepare('SELECT * FROM research_tasks WHERE workspace_id=? ORDER BY CASE status WHEN \'todo\' THEN 0 WHEN \'doing\' THEN 1 ELSE 2 END,due_date,id').all(workspaceId)
      : this.db.prepare('SELECT * FROM research_tasks WHERE workspace_id=? AND project_id=? ORDER BY CASE status WHEN \'todo\' THEN 0 WHEN \'doing\' THEN 1 ELSE 2 END,due_date,id').all(workspaceId,projectId)
    return (rows as TaskRow[]).map(row=>({...this.task(row),projectName:(this.db.prepare('SELECT name FROM research_projects WHERE id=?').get(row.project_id) as {name:string}|undefined)?.name??'已删除项目'}))
  }

  saveTask(workspaceId:string,input:TaskInput,id?:number):ResearchTask {
    const data=taskInputSchema.parse(input)
    if(!this.db.prepare('SELECT 1 FROM research_projects WHERE id=? AND workspace_id=?').get(data.projectId,workspaceId))throw new Error('任务所属项目不存在或不属于当前工作区')
    if(data.paperId&&!this.db.prepare('SELECT 1 FROM papers WHERE id=?').get(data.paperId))throw new Error('关联文献不存在')
    if(data.conversationId&&!this.db.prepare('SELECT 1 FROM conversations WHERE id=? AND workspace_id=?').get(data.conversationId,workspaceId))throw new Error('关联会话不属于当前工作区')
    const now=new Date().toISOString(),completedAt=data.status==='done'?now:null
    if(id!==undefined) {
      if(!Number.isSafeInteger(id)||id<1)throw new Error('任务编号无效')
      const result=this.db.prepare('UPDATE research_tasks SET project_id=?,title=?,notes=?,status=?,priority=?,due_date=?,paper_id=?,conversation_id=?,completed_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(data.projectId,data.title,data.notes,data.status,data.priority,data.dueDate,data.paperId,data.conversationId,completedAt,now,id,workspaceId)
      if(!result.changes)throw new Error('任务不存在或不属于当前工作区')
    } else {
      const result=this.db.prepare('INSERT INTO research_tasks(workspace_id,project_id,title,notes,status,priority,due_date,paper_id,conversation_id,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(workspaceId,data.projectId,data.title,data.notes,data.status,data.priority,data.dueDate,data.paperId,data.conversationId,completedAt,now,now)
      id=Number(result.lastInsertRowid)
    }
    const row=this.db.prepare('SELECT * FROM research_tasks WHERE id=? AND workspace_id=?').get(id,workspaceId) as TaskRow
    return {...this.task(row),projectName:(this.db.prepare('SELECT name FROM research_projects WHERE id=?').get(row.project_id) as {name:string}|undefined)?.name??'已删除项目'}
  }

  removeTask(workspaceId:string,id:number):boolean {
    if(!Number.isSafeInteger(id)||id<1)throw new Error('任务编号无效')
    return this.db.prepare('DELETE FROM research_tasks WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0
  }

  private counts(row:CountRow|undefined):{todo:number;doing:number;done:number} {
    return {todo:Number(row?.todo??0),doing:Number(row?.doing??0),done:Number(row?.done??0)}
  }
  private task(row:TaskRow):ResearchTask {
    return {id:row.id,projectId:row.project_id,projectName:'',title:row.title,notes:row.notes,status:row.status,priority:row.priority,dueDate:row.due_date,paperId:row.paper_id,conversationId:row.conversation_id,completedAt:row.completed_at,createdAt:row.created_at,updatedAt:row.updated_at}
  }
}
