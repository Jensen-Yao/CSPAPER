import type { ToolDefinition } from '../../shared/tools'

export type PermissionMode='auto'|'confirm'|'readonly'
export interface ToolApprovalRequest { toolCallId:string;tool:string;risk:ToolDefinition['risk'];reason:string;impact:string;args:unknown }

export function authorize(tool:ToolDefinition,mode:PermissionMode):{status:'auto'}|{status:'approval_required';request:Omit<ToolApprovalRequest,'toolCallId'>} {
  if(mode==='readonly'&&tool.risk!=='read') return {status:'approval_required',request:{tool:tool.name,risk:tool.risk,reason:'当前会话为只读模式',impact:tool.description,args:undefined}}
  if(tool.risk==='destructive') return {status:'approval_required',request:{tool:tool.name,risk:tool.risk,reason:'破坏性操作必须确认',impact:tool.description,args:undefined}}
  if(mode==='confirm'&&tool.risk!=='read') return {status:'approval_required',request:{tool:tool.name,risk:tool.risk,reason:'用户要求写操作前确认',impact:tool.description,args:undefined}}
  return {status:'auto'}
}
