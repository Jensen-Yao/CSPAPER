import { z } from 'zod'
import type { Source } from './sources'

export const toolRiskSchema = z.enum(['read','reversible_write','batch_write','external_effect','destructive'])
export type ToolRisk = z.infer<typeof toolRiskSchema>

export const toolPermissionSchema = z.enum(['auto','approval_required','disabled'])
export type ToolPermission = z.infer<typeof toolPermissionSchema>

export const jsonSchemaLikeSchema = z.record(z.string(), z.unknown())

export interface ToolDefinition {
  name: string
  version: number
  title: string
  description: string
  risk: ToolRisk
  defaultPermission: ToolPermission
  inputSchema: Record<string, unknown>
  canCancel: boolean
  timeoutMs?: number
}

export const domainChangeSchema = z.object({
  entity: z.enum(['paper','note','tag','collection','comparison','synthesis','citation','workspace','external']),
  entityId: z.string(),
  action: z.enum(['create','update','delete','move','link','unlink','import']),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reversible: z.boolean()
})
export type DomainChange = z.infer<typeof domainChangeSchema>

export const artifactRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['paper','note','comparison','synthesis','citation','file','report']),
  entityId: z.string().optional(),
  title: z.string(),
  uri: z.string().optional()
})
export type ArtifactRef = z.infer<typeof artifactRefSchema>

export const toolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional()
})
export type ToolError = z.infer<typeof toolErrorSchema>

export interface ToolResult<TData = unknown> {
  status: 'success' | 'partial' | 'failed' | 'cancelled'
  data?: TData
  summary: string
  sources: Source[]
  artifacts: ArtifactRef[]
  changes: DomainChange[]
  error?: ToolError
  durationMs: number
}
