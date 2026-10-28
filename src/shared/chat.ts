import { z } from 'zod'

export const RUN_STATUSES = ['queued','preparing','generating','executing_tools','awaiting_approval','cancelled','failed','partial','completed','interrupted'] as const
export type RunStatus = typeof RUN_STATUSES[number]
export const runStatusSchema = z.enum(RUN_STATUSES)

export const TERMINAL_RUN_STATUSES = ['cancelled','failed','partial','completed','interrupted'] as const
export type TerminalRunStatus = typeof TERMINAL_RUN_STATUSES[number]
export function isTerminalRunStatus(value: RunStatus): value is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(value)
}

export const messageRoleSchema = z.enum(['user','assistant','system','tool'])
export type MessageRole = z.infer<typeof messageRoleSchema>

export const messageStatusSchema = z.enum(['streaming','complete','partial','cancelled','failed'])
export type MessageStatus = z.infer<typeof messageStatusSchema>

const textPartSchema = z.object({ type: z.literal('text'), text: z.string() })
const reasoningPartSchema = z.object({ type: z.literal('reasoning'), text: z.string(), redacted: z.boolean().default(false) })
const toolCallPartSchema = z.object({
  type: z.literal('tool_call'),
  toolCallId: z.string().min(1),
  tool: z.string().min(1),
  args: z.unknown()
})
const toolResultPartSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string().min(1),
  status: z.enum(['success','partial','failed','cancelled']),
  summary: z.string()
})
const sourcePartSchema = z.object({
  type: z.literal('sources'),
  sourceIds: z.array(z.string().min(1)).min(1)
})
const artifactPartSchema = z.object({
  type: z.literal('artifacts'),
  artifactIds: z.array(z.string().min(1)).min(1)
})
const errorPartSchema = z.object({
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string()
})

export const messagePartSchema = z.discriminatedUnion('type', [
  textPartSchema, reasoningPartSchema, toolCallPartSchema, toolResultPartSchema,
  sourcePartSchema, artifactPartSchema, errorPartSchema
])
export type MessagePart = z.infer<typeof messagePartSchema>

export const conversationModeSchema = z.enum(['ask','act'])
export type ConversationMode = z.infer<typeof conversationModeSchema>

export interface Conversation {
  id: string
  workspaceId: string
  title: string
  mode: ConversationMode
  entry: 'global' | 'reader' | 'work' | 'compare' | 'notes'
  activeLeafMessageId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface Message {
  id: string
  conversationId: string
  parentId: string | null
  clientMessageId: string | null
  role: MessageRole
  parts: MessagePart[]
  status: MessageStatus
  runId: string | null
  createdAt: string
  updatedAt: string
}

export const RUN_EVENT_TYPES = [
  'run.status_changed','run.completed','message.delta','message.completed',
  'plan.created','plan.updated','approval.required','approval.resolved',
  'tool.started','tool.completed','tool.failed','context.resolved',
  'source.added','artifact.created','error'
  ,'message.reset','run.resumed'
] as const
export type RunEventType = typeof RUN_EVENT_TYPES[number]
export const runEventTypeSchema = z.enum(RUN_EVENT_TYPES)

export interface RunEvent {
  runId: string
  conversationId: string
  messageId: string
  seq: number
  /** Monotonic across every run in this conversation; used for snapshot/replay. */
  cursor?: number
  type: RunEventType
  payload: unknown
  createdAt: string
}

export interface Run {
  id: string
  conversationId: string
  mode: ConversationMode
  userMessageId: string
  assistantMessageId: string
  status: RunStatus
  error: { code: string; message: string; retryable: boolean } | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
