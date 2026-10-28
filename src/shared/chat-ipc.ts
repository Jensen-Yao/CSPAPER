import { z } from 'zod'
import { contextRefSchema } from './context'
import { modelBindingSnapshotSchema } from './models'
import { artifactRefSchema } from './tools'
import { conversationModeSchema, messagePartSchema, runEventTypeSchema, runStatusSchema } from './chat'

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)

export const createConversationRequestSchema = z.object({
  workspaceId: idSchema,
  title: z.string().trim().min(1).max(180).optional(),
  mode: conversationModeSchema.default('ask'),
  entry: z.enum(['global','reader','work','compare','notes']).default('global')
})

export const listConversationsRequestSchema = z.object({
  workspaceId: idSchema,
  includeArchived: z.boolean().default(false),
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(100).default(50)
})

export const loadMessagesRequestSchema = z.object({
  conversationId: idSchema,
  beforeMessageId: idSchema.nullish(),
  limit: z.number().int().min(1).max(200).default(80)
})

export const submitTurnRequestSchema = z.object({
  conversationId: idSchema,
  clientMessageId: idSchema,
  parentMessageId: idSchema.nullish(),
  text: z.string().trim().min(1).max(100000),
  context: z.array(contextRefSchema).max(100).default([]),
  modelBindingId:z.string().min(1).max(2048),
  reasoning:z.string().min(1).max(40).default('default'),
  mode: conversationModeSchema.default('ask'),
  promptKind: z.enum(['ask','translation']).default('ask'),
  permission:z.enum(['auto','confirm','readonly']).default('auto')
}).strict()

export const cancelRunRequestSchema = z.object({ runId: idSchema, reason: z.string().max(500).optional() })
export const approveToolRequestSchema = z.object({
  toolCallId: idSchema,
  approved: z.boolean(),
  revision: z.unknown().optional()
})
export const retryTurnRequestSchema = z.object({ runId: idSchema, reuseContext: z.boolean().default(true) })
export const editAndResubmitRequestSchema = z.object({
  conversationId: idSchema,
  messageId: idSchema,
  text: z.string().trim().min(1).max(100000),
  context: z.array(contextRefSchema).max(100).default([])
})
export const subscribeRequestSchema = z.object({
  conversationId: idSchema.nullish(),
  runId: idSchema.nullish(),
  afterSeq: z.number().int().nonnegative().default(0)
})

export const runEventEnvelopeSchema = z.object({
  runId: idSchema,
  conversationId: idSchema,
  messageId: idSchema,
  seq: z.number().int().nonnegative(),
  type: runEventTypeSchema,
  payload: z.unknown(),
  createdAt: z.string()
})

export const persistedMessageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  parentId: idSchema.nullish(),
  clientMessageId: idSchema.nullish(),
  role: z.enum(['user','assistant','system','tool']),
  parts: z.array(messagePartSchema),
  status: z.enum(['streaming','complete','partial','cancelled','failed']),
  runId: idSchema.nullish(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const runSnapshotSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  userMessageId: idSchema,
  assistantMessageId: idSchema,
  status: runStatusSchema,
  error: z.unknown().nullish(),
  createdAt: z.string(),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish()
})

export const chatResponseSchema = z.object({ ok: z.literal(true), data: z.unknown() }).or(
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }) })
)

export const artifactRefResponseSchema = artifactRefSchema
export type SubmitTurnInput = z.infer<typeof submitTurnRequestSchema>
export type RunEventEnvelope = z.infer<typeof runEventEnvelopeSchema>
export type PersistedMessage = z.infer<typeof persistedMessageSchema>
