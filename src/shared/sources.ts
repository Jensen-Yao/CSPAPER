import { z } from 'zod'
import { documentVersionSchema } from './context'

export const sourceKindSchema = z.enum(['paper_page','paper_selection','chunk','note','artifact','web'])
export type SourceKind = z.infer<typeof sourceKindSchema>

export const sourceStatusSchema = z.enum(['available','moved','version_changed','missing','unverified'])
export type SourceStatus = z.infer<typeof sourceStatusSchema>

export const sourceLocatorSchema = z.object({
  page: z.number().int().positive().optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
  anchor: z.string().optional(),
  uri: z.string().optional()
})
export type SourceLocator = z.infer<typeof sourceLocatorSchema>

export const sourceSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: sourceKindSchema,
  workspaceId: z.string().min(1),
  paperId: z.number().int().positive().optional(),
  title: z.string().default(''),
  documentVersion: documentVersionSchema.optional(),
  locator: sourceLocatorSchema,
  snippet: z.string().default(''),
  status: sourceStatusSchema,
  createdAt: z.string()
})
export type Source = z.infer<typeof sourceSchema>

export interface SourceBinding {
  displayNumber: number
  sourceId: string
  claimSpan?: { start: number; end: number }
}
