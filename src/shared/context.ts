import { z } from 'zod'

export const documentVersionSchema = z.string().min(1)
export type DocumentVersion = z.infer<typeof documentVersionSchema>

export const paperContextSchema = z.object({
  kind: z.literal('paper'),
  workspaceId: z.string().min(1),
  paperId: z.number().int().positive()
})

export const selectionContextSchema = z.object({
  kind: z.literal('selection'),
  workspaceId: z.string().min(1),
  paperId: z.number().int().positive(),
  page: z.number().int().positive(),
  text: z.string().min(1),
  documentVersion: documentVersionSchema,
  origin: z.enum(['pdf','sidepanel','detail','compare']).default('pdf')
})

export const categoryContextSchema = z.object({
  kind: z.literal('category'),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(200)
})

export const collectionContextSchema = z.object({
  kind: z.literal('collection'),
  workspaceId: z.string().min(1),
  collectionId: z.number().int().positive()
})

export const noteContextSchema = z.object({
  kind: z.literal('note'),
  workspaceId: z.string().min(1),
  noteId: z.string().min(1),
  paperId: z.number().int().positive().optional()
})

export const artifactContextSchema = z.object({
  kind: z.literal('artifact'),
  workspaceId: z.string().min(1),
  artifactId: z.string().min(1)
})

export const savedSearchContextSchema = z.object({
  kind: z.literal('saved_search'),
  workspaceId: z.string().min(1),
  savedSearchId: z.number().int().positive()
})


export const webContextSchema = z.object({
  kind: z.literal('web'),
  workspaceId: z.string().min(1),
  url: z.string().url(),
  title: z.string().trim().min(1).max(500),
  snippet: z.string().trim().min(1).max(30000),
  documentVersion: documentVersionSchema
})

export const contextRefSchema = z.discriminatedUnion('kind', [
  paperContextSchema,
  selectionContextSchema,
  categoryContextSchema,
  collectionContextSchema,
  noteContextSchema,
  artifactContextSchema,
  savedSearchContextSchema,
  webContextSchema
])
export type ContextRef = z.infer<typeof contextRefSchema>

export const contextBudgetSchema = z.object({
  totalChars: z.number().int().nonnegative(),
  usedChars: z.number().int().nonnegative(),
  reservedForOutput: z.number().int().nonnegative()
})
export type ContextBudget = z.infer<typeof contextBudgetSchema>

export type PromptKind='ask'|'translation'|'plan'
export interface ContextSnapshot {
  permission?:'auto'|'confirm'|'readonly'
  promptKind?:PromptKind
  researchGoal?:string
  skills?:Array<{name:string;source:'builtin'|'user';body:string}>
  conversationId: string
  runId: string
  refs: ContextRef[]
  budget: ContextBudget
  diagnostics: Array<{ level: 'info' | 'warning' | 'error'; code: string; message: string }>
  createdAt: string
}
