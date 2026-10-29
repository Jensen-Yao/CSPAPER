import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDb, listPapers, paperTags, addPaperTag, removePaperTag, setStatus } from '../db'
import { extractPagesCached } from '../ingest'
import { updatePaperMetadata } from '../paper-service'
import { getMyNotesText, saveMyNotesText } from '../insight'
import { retrieveSources } from '../chat/retrieval'
import { documentVersion, newSourceId } from '../chat/context'
import type { ToolResult } from '../../shared/tools'
import type { ToolRegistry } from './registry'
import { readPaperNote, writePaperNote } from '../note-service'

const metadataPatch=z.object({
  title:z.string().trim().min(1).max(1000).optional(),
  authors:z.string().max(10000).optional(),
  year:z.number().int().min(1).max(9999).nullish(),
  venue:z.string().max(500).optional(),
  volume:z.string().max(100).optional(),issue:z.string().max(100).optional(),pages:z.string().max(200).optional(),
  publisher:z.string().max(300).optional(),language:z.string().max(50).optional(),doi:z.string().max(300).optional()
}).strict()

function ok(data:unknown,summary:string,extra:Partial<ToolResult>={}):ToolResult {
  return {status:'success',data,summary,sources:[],artifacts:[],changes:[],...extra,durationMs:0}
}
function paperRow(paperId:number) {
  return getDb().prepare('SELECT id,slug,title,path,category FROM active_papers WHERE id=?').get(paperId) as {id:number;slug:string;title:string;path:string;category:string}|undefined
}

export function registerLibraryTools(registry:ToolRegistry):void {
  registry.register({
    definition:{name:'library.search',version:1,title:'检索文献库',description:'在当前工作区的文献全文与语义索引中检索，返回可定位来源。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:30000},
    schema:z.object({query:z.string().trim().min(1).max(500),paperIds:z.array(z.number().int().positive()).max(100).optional(),paperId:z.number().int().positive().optional(),limit:z.number().int().min(1).max(50).default(12)}),
    execute:async(ctx,args)=>{
      const sources=await retrieveSources({query:args.query,workspaceId:ctx.workspaceId,paperIds:args.paperIds,paperId:args.paperId,limit:args.limit,runId:ctx.runId,signal:ctx.signal})
      for(const source of sources) ctx.repository.addSource(source)
      return ok(sources.map((source,index)=>({n:index+1,title:source.title,page:source.locator.page,snippet:source.snippet.slice(0,300),sourceId:source.id})),sources.length?`检索到 ${sources.length} 个来源`:'未检索到来源：可更换关键词、缩小范围或重建索引',{sources})
    }
  })
  registry.register({
    definition:{name:'paper.read',version:1,title:'读取论文页',description:'按页读取指定文献的抽取文本，返回页级来源。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:30000},
    schema:z.object({paperId:z.number().int().positive(),pages:z.array(z.number().int().positive().max(5000)).min(1).max(50)}),
    execute:async(ctx,args)=>{
      const paper=paperRow(args.paperId)
      if(!paper) throw new Error('文献不存在或不可见')
      const all=await extractPagesCached(paper.path,{signal:ctx.signal,timeoutMs:30000}),version=documentVersion(paper.path)
      const pages=args.pages.filter(page=>page<=all.length).slice(0,50)
      const sources=pages.map(page=>({id:newSourceId(),runId:ctx.runId,kind:'paper_page' as const,workspaceId:ctx.workspaceId,paperId:paper.id,title:paper.title,documentVersion:version,locator:{page},snippet:all[page-1].slice(0,2000),status:'available' as const,createdAt:new Date().toISOString()}))
      for(const source of sources) ctx.repository.addSource(source)
      return ok(pages.map(page=>({page,text:all[page-1]})),`已读取 ${pages.length} 页`,{sources})
    }
  })
  registry.register({
    definition:{name:'paper.update_metadata',version:1,title:'更新题录',description:'更新 Markdown、CSL 与数据库中的规范题录字段。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperId:z.number().int().positive(),patch:metadataPatch}),
    execute:async(ctx,args)=>{
      const before=paperRow(args.paperId)
      if(!before) throw new Error('文献不存在或不可见')
      const after={...before,...args.patch}
      updatePaperMetadata(args.paperId,args.patch)
      return ok(after,'题录已更新',{changes:[{entity:'paper',entityId:String(args.paperId),action:'update',before,after,reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'paper.set_status',version:1,title:'设置阅读状态',description:'更新文献阅读状态并写回 Markdown。',risk:'reversible_write',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperId:z.number().int().positive(),status:z.enum(['todo','unread','reading','read','paused'])}),
    execute:async(ctx,args)=>{
      const before=paperRow(args.paperId);if(!before)throw new Error('文献不存在或不可见')
      setStatus(args.paperId,args.status)
      return ok({paperId:args.paperId,status:args.status},`阅读状态已更新为 ${args.status}`,{changes:[{entity:'paper',entityId:String(args.paperId),action:'update',before:{status:before.category},after:{status:args.status},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'paper.set_tags',version:1,title:'全量设置标签',description:'以给定标签列表替换该文献标签。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperId:z.number().int().positive(),tags:z.array(z.string().trim().min(1).max(40)).max(50)}),
    execute:async(ctx,args)=>{
      const paper=paperRow(args.paperId);if(!paper)throw new Error('文献不存在或不可见')
      const before=paperTags(args.paperId).map(tag=>tag.name),beforeIds=[...before]
      for(const name of args.tags) addPaperTag(args.paperId,name)
      const after=paperTags(args.paperId)
      for(const tag of after)if(!args.tags.includes(tag.name))removePaperTag(args.paperId,tag.id)
      return ok({tags:args.tags},'标签已更新',{changes:[{entity:'tag',entityId:String(args.paperId),action:'update',before:beforeIds,after:args.tags,reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'note.read',version:1,title:'读取笔记',description:'读取文献“我的笔记”内容。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperId:z.number().int().positive()}),
      execute:async(ctx,args)=>{
      const paper=paperRow(args.paperId);if(!paper)throw new Error('文献不存在或不可见')
        return ok(readPaperNote(ctx.workspaceId,args.paperId),`已读取《${paper.title}》的笔记`)
    }
  })
  registry.register({
    definition:{name:'note.save',version:1,title:'保存笔记',description:'替换保存文献“我的笔记”。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},
      schema:z.object({paperId:z.number().int().positive(),text:z.string().max(200000),expectedVersion:z.string().optional()}),
    execute:async(ctx,args)=>{
      const paper=paperRow(args.paperId);if(!paper)throw new Error('文献不存在或不可见')
        const saved=writePaperNote({...args,workspaceId:ctx.workspaceId,mode:'save',operationId:ctx.operationId??'note_'+randomUUID(),signal:ctx.signal})
      const artifactId='art_'+randomUUID()
      const artifact=ctx.repository.addArtifact({id:artifactId,runId:ctx.runId,kind:'note',entityId:String(args.paperId),title:`笔记《${paper.title}》`})
        return ok({paperId:args.paperId,version:saved.version},'笔记已保存',{artifacts:[artifact],changes:[{entity:'note',entityId:String(args.paperId),action:'update',before:saved.beforeText,after:saved.text,reversible:true}]})
    }
  })
    registry.register({
      definition:{name:'note.append',version:1,title:'追加笔记',description:'在已有笔记末尾追加内容，保留原有笔记。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true},
      schema:z.object({paperId:z.number().int().positive(),text:z.string().trim().min(1).max(200000),expectedVersion:z.string().optional()}),
      execute:async(ctx,args)=>{
        const saved=writePaperNote({...args,workspaceId:ctx.workspaceId,mode:'append',operationId:ctx.operationId??'note_'+randomUUID(),signal:ctx.signal})
        const artifact=ctx.repository.addArtifact({id:'art_'+randomUUID(),runId:ctx.runId,kind:'note',entityId:String(args.paperId),title:`笔记《${saved.title}》`})
        return ok({paperId:args.paperId,version:saved.version},'内容已追加，原有笔记已保留',{artifacts:[artifact],changes:[{entity:'note',entityId:String(args.paperId),action:'update',before:saved.beforeText,after:saved.text,reversible:true}]})
      }
    })
}
