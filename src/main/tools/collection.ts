import { z } from 'zod'
import { createCollection, collectionPapers, setPaperInCollection } from '../collection-service'
import type { ToolResult } from '../../shared/tools'
import type { ToolRegistry } from './registry'

function ok(data:unknown,summary:string,changes:ToolResult['changes']=[]):ToolResult {
  return {status:'success',data,summary,sources:[],artifacts:[],changes,durationMs:0}
}
export function registerCollectionTools(registry:ToolRegistry):void {
  registry.register({
    definition:{name:'collection.create',version:1,title:'创建集合',description:'创建一个跨分类的文献集合。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({name:z.string().trim().min(1).max(100),parentId:z.number().int().positive().optional()}),
    execute:async(_ctx,args)=>{
      const row=await Promise.resolve(createCollection(args.name,args.parentId))
      return ok(row,`集合「${row.name}」已创建`,[{entity:'collection',entityId:String(row.id),action:'create',after:{name:row.name},reversible:true}])
    }
  })
  registry.register({
    definition:{name:'collection.add_papers',version:1,title:'添加文献到集合',description:'把多篇文献加入一个集合。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true,timeoutMs:30000},
    schema:z.object({collectionId:z.number().int().positive(),paperIds:z.array(z.number().int().positive()).min(1).max(100)}),
    execute:async(_ctx,args)=>{
      for(const paperId of args.paperIds)setPaperInCollection(args.collectionId,paperId,true)
      const paperIds=collectionPapers(args.collectionId)
      return ok({collectionId:args.collectionId,paperIds},`已把 ${args.paperIds.length} 篇文献加入集合`,[{entity:'collection',entityId:String(args.collectionId),action:'update',after:{addedPaperIds:args.paperIds},reversible:true}])
    }
  })
  registry.register({
    definition:{name:'collection.remove_paper',version:1,title:'从集合移除文献',description:'从集合中移除一篇文献。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({collectionId:z.number().int().positive(),paperId:z.number().int().positive()}),
    execute:async(_ctx,args)=>{
      setPaperInCollection(args.collectionId,args.paperId,false)
      return ok({collectionId:args.collectionId,paperIds:collectionPapers(args.collectionId)},'已从集合移除文献', [{entity:'collection',entityId:String(args.collectionId),action:'update',after:{removedPaperId:args.paperId},reversible:true}])
    }
  })
}
