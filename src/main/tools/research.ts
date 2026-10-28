import { z } from 'zod'
import { synthesizePapers } from '../insight'
import { createComparison, updateComparison } from '../comparison-service'
import { formatCite } from '../csl'
import { extractDoi, matchScript, runWeb, importTranslated, searchAll } from '../translators'
import type { ToolResult } from '../../shared/tools'
import type { ToolContext, ToolRegistry } from './registry'
import { randomUUID } from 'node:crypto'

function ok(data:unknown,summary:string,extra:Partial<ToolResult>={}):ToolResult {return {status:'success',data,summary,sources:[],artifacts:[],changes:[],...extra,durationMs:0}}
function artifact(ctx:ToolContext,kind:'comparison'|'synthesis'|'paper',entityId:string,title:string) {
  const id='art_'+randomUUID()
  return ctx.repository.addArtifact({id,runId:ctx.runId,kind,entityId,title})
}

export function registerResearchTools(registry:ToolRegistry):void {
  registry.register({
    definition:{name:'research.search_web',version:1,title:'联网检索题录',description:'通过内置学术源检索题录，不自动写入文献库。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:true,timeoutMs:60000},
    schema:z.object({query:z.string().trim().min(1).max(500),limit:z.number().int().min(1).max(30).default(10)}),
    execute:async(_ctx,args)=>ok((await searchAll(args.query)).slice(0,args.limit),`联网检索到最多 ${args.limit} 条题录`)
  })
  registry.register({
    definition:{name:'paper.import',version:1,title:'导入文献',description:'从 DOI、arXiv 或网页抓取题录与 PDF 并入库。',risk:'batch_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true,timeoutMs:120000},
    schema:z.object({url:z.string().trim().min(3).max(2000)}),
    execute:async(ctx,args)=>{
      let target=args.url
      if(!/^https?:\/\//i.test(target)) {
        const doi=extractDoi(target);if(!doi)throw new Error('不是有效链接或 DOI')
        target=`https://doi.org/${doi}`
      }
      const script=matchScript(target);if(!script)throw new Error('没有匹配的抓取脚本')
      const captured=await runWeb(script,target)
      if(!captured.ok||!captured.csl)throw new Error(captured.error??'抓取失败')
      const imported=await importTranslated({csl:captured.csl,pdfPath:captured.pdfPath,origin:target},()=>{})
      if(!imported.ok||!imported.slug)throw new Error(imported.error??'入库失败')
      const title=String((captured.csl as {title?:string}).title??imported.slug)
      return ok({slug:imported.slug,title},`已入库：${imported.slug}`,{artifacts:[artifact(ctx,'paper',imported.slug,title)],changes:[{entity:'paper',entityId:imported.slug,action:'import',after:{slug:imported.slug,title},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'comparison.create',version:1,title:'生成对比表',description:'为选定文献生成并保存对比表。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true,timeoutMs:300000},
    schema:z.object({paperIds:z.array(z.number().int().positive()).min(2).max(50),dimensions:z.array(z.string().trim().min(1)).min(1).max(12).default(['研究方法','数据与实验','核心结论'])}),
    execute:async(ctx,args)=>{
      const table=await createComparison(args.paperIds,args.dimensions)
      return ok({comparisonId:table.id,paperIds:args.paperIds,dimensions:args.dimensions},`对比表 #${table.id} 已保存`,{artifacts:[artifact(ctx,'comparison',String(table.id),`对比表 #${table.id}`)],changes:[{entity:'comparison',entityId:String(table.id),action:'create',after:{paperIds:args.paperIds},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'comparison.update',version:1,title:'更新对比表',description:'重新生成并覆盖指定文献集合的对比表。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true,timeoutMs:300000},
    schema:z.object({comparisonId:z.number().int().positive(),paperIds:z.array(z.number().int().positive()).min(2).max(50),dimensions:z.array(z.string().trim().min(1)).min(1).max(12).default(['研究方法','数据与实验','核心结论'])}),
    execute:async(ctx,args)=>{
      const table=await updateComparison(args.comparisonId,args.paperIds,args.dimensions)
      return ok({comparisonId:table.id,paperIds:args.paperIds,dimensions:args.dimensions},`对比表 #${table.id} 已更新`,{artifacts:[artifact(ctx,'comparison',String(table.id),`对比表 #${table.id}`)],changes:[{entity:'comparison',entityId:String(table.id),action:'update',after:{paperIds:args.paperIds},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'synthesis.create',version:1,title:'生成综述',description:'生成中文综合综述并保存到 AI 知识库。',risk:'reversible_write',defaultPermission:'approval_required',inputSchema:{type:'object'},canCancel:true,timeoutMs:300000},
    schema:z.object({paperIds:z.array(z.number().int().positive()).min(2).max(50)}),
    execute:async(ctx,args)=>{
      const result=await synthesizePapers(args.paperIds,()=>{})
      return ok({slug:result.slug,title:result.title},`综述《${result.title}》已保存`,{artifacts:[artifact(ctx,'synthesis',result.slug,result.title)],changes:[{entity:'synthesis',entityId:result.slug,action:'create',after:{title:result.title},reversible:true}]})
    }
  })
  registry.register({
    definition:{name:'citation.format',version:1,title:'生成参考文献',description:'按 CSL 样式生成参考文献列表。',risk:'read',defaultPermission:'auto',inputSchema:{type:'object'},canCancel:false},
    schema:z.object({paperIds:z.array(z.number().int().positive()).min(1).max(200),style:z.string().trim().min(1).max(100).default('gbt7714-num')}),
    execute:async(_ctx,args)=>{
      const result=await formatCite(args.paperIds,args.style)
      if(!result.ok)throw new Error(result.error??'格式化失败')
      return ok(result.items??[],`已生成 ${args.paperIds.length} 条参考文献`)
    }
  })
}
