import { z } from 'zod'
import type { ToolDefinition, ToolResult } from '../../shared/tools'
import type { Source } from '../../shared/sources'
import type { ChatRepository } from '../chat/repository'

export interface ToolContext { runId:string;workspaceId:string;signal:AbortSignal;repository:ChatRepository;operationId?:string }
export interface RegisteredTool<TSchema extends z.ZodTypeAny> { definition:ToolDefinition;schema:TSchema;execute:(ctx:ToolContext,args:z.infer<TSchema>)=>Promise<ToolResult> }

export class ToolRegistry {
  private readonly tools=new Map<string,RegisteredTool<z.ZodTypeAny>>()
  register<TSchema extends z.ZodTypeAny>(input:{definition:ToolDefinition;schema:TSchema;execute:(ctx:ToolContext,args:z.infer<TSchema>)=>Promise<ToolResult>}):this {
    if(this.tools.has(input.definition.name)) throw new Error(`工具重复注册：${input.definition.name}`)
    this.tools.set(input.definition.name,input as RegisteredTool<z.ZodTypeAny>)
    return this
  }
  get(name:string):RegisteredTool<z.ZodTypeAny>|undefined {return this.tools.get(name)}
  require(name:string):RegisteredTool<z.ZodTypeAny> {
    const tool=this.tools.get(name)
    if(!tool) throw new Error(`未知工具：${name}`)
    return tool
  }
  list():ToolDefinition[] {return [...this.tools.values()].map(tool=>tool.definition)}
  menu():string {return [...this.tools.values()].map(tool=>`${tool.definition.name} v${tool.definition.version} — ${tool.definition.description}\n参数：${JSON.stringify(z.toJSONSchema(tool.schema))}`).join('\n')}
}
export function sourceRefs(sources:Source[]):Source[] {return sources}
