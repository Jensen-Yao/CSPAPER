import type { Conversation, Message, Run, RunEvent } from './chat'
import type { SubmitTurnInput } from './chat-ipc'
import type { ContextSnapshot } from './context'
import type { Source } from './sources'
import type { ArtifactRef } from './tools'

export interface RunDetails {
  run: Run | null
  events: RunEvent[]
  sources: Source[]
  artifacts: ArtifactRef[]
  context?: ContextSnapshot
}
export interface MessagePage { items: Message[]; hasMore: boolean; eventCursor: number }
export interface ConversationSnapshot extends MessagePage {
  conversation: Conversation
  runs: RunDetails[]
}
export interface TurnResult { run: Run; userMessage: Message; assistantMessage: Message; reused: boolean; queued: boolean }
export interface ChatApi {
  workspace(): Promise<{ workspaceId: string }>
  createConversation(input?: { title?: string; mode?: 'ask' | 'act'; entry?: Conversation['entry'] }): Promise<Conversation>
  listConversations(input?: { includeArchived?: boolean; cursor?: string | null; limit?: number; workspaceId?: string }): Promise<{ items: Conversation[]; nextCursor: string | null }>
  getConversation(id: string): Promise<Conversation | null>
  renameConversation(id: string, title: string): Promise<Conversation | null>
  archiveConversation(id: string, archived: boolean): Promise<Conversation | null>
  loadMessages(input: { conversationId: string; beforeMessageId?: string | null; limit?: number }): Promise<MessagePage>
  snapshot(input: { conversationId: string; limit?: number }): Promise<ConversationSnapshot>
  submitTurn(input: SubmitTurnInput): Promise<TurnResult>
  cancelRun(runId: string, reason?: string): Promise<boolean>
  resumeRun(runId:string):Promise<boolean>
  approveTool(toolCallId: string, approved: boolean): Promise<boolean>
  retryTurn(runId: string, reuseContext?: boolean): Promise<TurnResult>
  editAndResubmit(input: { conversationId: string; messageId: string; text: string; context: SubmitTurnInput['context'] }): Promise<TurnResult>
  getRun(runId: string): Promise<RunDetails>
  onEvent(cb: (event: RunEvent) => void): () => void
  subscribe(input: { conversationId: string; afterSeq?: number }, cb: (event: RunEvent) => void): Promise<() => void>
}
