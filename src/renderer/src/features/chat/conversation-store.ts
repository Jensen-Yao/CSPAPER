import type { ChatApi, RunDetails, TurnResult } from '../../../../shared/chat-api'
import type { Conversation, Message, Run, RunEvent } from '../../../../shared/chat'
import { isTerminalRunStatus } from '../../../../shared/chat'
import type { SubmitTurnInput } from '../../../../shared/chat-ipc'

export interface ConversationView {
  conversation: Conversation | null
  messages: Message[]
  runs: Record<string, RunDetails>
  run: Run | null
  cursor: number
  hasMore: boolean
  loading: boolean
  error: string
}
export interface ConversationStoreState {
  workspaceId: string | null
  activeId: string | null
  conversations: Conversation[]
  views: Record<string, ConversationView>
  includeArchived: boolean
  nextCursor: string | null
  error: string
  loading: boolean
}
export const EMPTY_VIEW: ConversationView = { conversation: null, messages: [], runs: {}, run: null, cursor: 0, hasMore: false, loading: false, error: '' }

/** Prefer the running or approval-blocked turn over newer queued turns. */
export function selectConversationRun(messages: Message[], runs: Record<string, RunDetails>): Run | null {
  const ordered = messages.flatMap(message => message.runId && runs[message.runId]?.run ? [runs[message.runId].run!] : [])
  return ordered.find(run => !isTerminalRunStatus(run.status) && run.status !== 'queued')
    ?? ordered.find(run => run.status === 'queued')
    ?? ordered.at(-1) ?? null
}

/** Shared snapshots and event ownership; components keep only their presentation state. */
export class ConversationStore {
  private state: ConversationStoreState = { workspaceId: null, activeId: null, conversations: [], views: {}, includeArchived: false, nextCursor: null, error: '', loading: true }
  private readonly listeners = new Set<() => void>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, RunEvent[]>()
  private initializing: Promise<void> | null = null
  private unsubscribeEvents: (() => void) | null = null
  constructor(private readonly api: ChatApi) {}
  getSnapshot = (): ConversationStoreState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(patch: Partial<ConversationStoreState>): void {
    this.state = { ...this.state, ...patch }
    for(const listener of this.listeners)listener()
  }
  private updateView(id: string, patch: Partial<ConversationView>): void {
    this.publish({ views: { ...this.state.views, [id]: { ...(this.state.views[id] ?? EMPTY_VIEW), ...patch } } })
  }
  private fail(id: string | null, error: unknown): void {
    if(id)this.updateView(id,{ error: String(error), loading: false })
    else this.publish({ error: String(error), loading: false })
  }
  initialize = (): Promise<void> => {
    if(this.initializing)return this.initializing
    this.unsubscribeEvents ??= this.api.onEvent(this.receive)
    this.initializing = (async() => {
      const { workspaceId } = await this.api.workspace()
      if(this.state.workspaceId && workspaceId !== this.state.workspaceId) {
        this.pending.clear()
        this.publish({ views: {}, activeId: null, conversations: [] })
      }
      this.publish({ workspaceId })
      await this.refreshConversations()
      const current = this.state.conversations.find(item => item.id === this.state.activeId) ?? this.state.conversations[0]
      if(current)await this.selectConversation(current.id)
      else await this.newConversation()
      this.publish({ loading: false, error: '' })
    })().catch(error => { this.fail(null,error); throw error }).finally(() => { this.initializing = null })
    return this.initializing
  }
  refreshConversations = async(append = false): Promise<void> => {
    const page = await this.api.listConversations({ includeArchived: this.state.includeArchived, cursor: append ? this.state.nextCursor : null, limit: 50 })
    const items = append ? [...this.state.conversations,...page.items] : page.items
    this.publish({ conversations: [...new Map(items.map(item => [item.id,item])).values()], nextCursor: page.nextCursor })
  }
  showArchived = async(value: boolean): Promise<void> => { this.publish({ includeArchived: value }); await this.refreshConversations() }
  selectConversation = async(id: string): Promise<void> => { this.publish({ activeId: id }); await this.reload(id) }
  newConversation = async(): Promise<Conversation> => {
    const conversation = await this.api.createConversation({ mode: 'ask', entry: 'global' })
    await this.refreshConversations()
    await this.selectConversation(conversation.id)
    return conversation
  }
  renameConversation = async(id: string, title: string): Promise<void> => {
    const conversation = await this.api.renameConversation(id,title)
    if(conversation)this.updateView(id,{ conversation })
    await this.refreshConversations()
  }
  archiveConversation = async(id: string, archived: boolean): Promise<void> => {
    const conversation = await this.api.archiveConversation(id,archived)
    if(conversation)this.updateView(id,{ conversation })
    await this.refreshConversations()
    if(archived && !this.state.includeArchived && this.state.activeId === id) {
      if(this.state.conversations[0])await this.selectConversation(this.state.conversations[0].id)
      else await this.newConversation()
    }
  }
  deleteConversation = async(id: string): Promise<void> => {
    await this.api.deleteConversation(id)
    const views={...this.state.views};delete views[id]
    const conversations=this.state.conversations.filter(item=>item.id!==id)
    const activeId=this.state.activeId===id?(conversations[0]?.id??null):this.state.activeId
    this.publish({views,conversations,activeId,nextCursor:null,error:''})
    if(activeId)await this.selectConversation(activeId)
    else if(this.state.conversations.length===0)await this.newConversation()
  }
  reload = (id: string): Promise<void> => {
    const current = this.loading.get(id)
    if(current)return current
    this.updateView(id,{ loading: true })
    const promise = this.api.snapshot({ conversationId: id, limit: 120 }).then(snapshot => {
      const previous = this.state.views[id]
      const first = snapshot.items[0]
      const boundary = first ? previous?.messages.findIndex(item => item.id === first.id) ?? -1 : -1
      const history = boundary > 0 ? previous.messages.slice(0,boundary) : []
      const runs = { ...previous?.runs, ...Object.fromEntries(snapshot.runs.filter(item => item.run).map(item => [item.run!.id,item])) }
      const run = selectConversationRun(snapshot.items, runs)
      this.updateView(id,{ conversation: snapshot.conversation, messages: [...history,...snapshot.items], runs, run, cursor: snapshot.eventCursor, hasMore: history.length ? previous.hasMore : snapshot.hasMore, loading: false, error: '' })
    }).catch(error => this.fail(id,error)).finally(() => {
      this.loading.delete(id)
      const buffered = this.pending.get(id) ?? []
      this.pending.delete(id)
      buffered.sort((a,b)=>(a.cursor ?? 0)-(b.cursor ?? 0)).forEach(this.receive)
    })
    this.loading.set(id,promise)
    return promise
  }
  loadOlder = async(): Promise<void> => {
    const id = this.state.activeId, view = id ? this.state.views[id] : null
    if(!id || !view || !view.hasMore || view.loading)return
    this.updateView(id,{ loading: true })
    try {
      const page = await this.api.loadMessages({ conversationId: id, beforeMessageId: view.messages[0]?.id, limit: 80 })
      const details = await Promise.all([...new Set(page.items.flatMap(item => item.runId ? [item.runId] : []))].map(runId => this.api.getRun(runId)))
      const current = this.state.views[id]
      const messages = [...new Map([...page.items,...current.messages].map(item => [item.id,item])).values()]
      this.updateView(id,{ messages, runs: { ...current.runs, ...Object.fromEntries(details.filter(item=>item.run).map(item=>[item.run!.id,item])) }, hasMore: page.hasMore, loading: false })
    } catch(error) { this.fail(id,error) }
  }
  send = async(input: SubmitTurnInput): Promise<TurnResult> => {
    try {
      const result = await this.api.submitTurn(input)
      const current = this.state.views[input.conversationId] ?? EMPTY_VIEW
      const messages = [...new Map([...current.messages,result.userMessage,result.assistantMessage].map(item=>[item.id,item])).values()]
      const active = current.run && !isTerminalRunStatus(current.run.status) && current.run.status !== 'queued' ? current.run : result.run
      this.updateView(input.conversationId,{ messages, run: active, error: '' })
      await this.reload(input.conversationId)
      await this.refreshConversations()
      return result
    } catch(error) { this.fail(input.conversationId,error); throw error }
  }
  stop = async(): Promise<void> => {
    const id = this.state.activeId, run = id ? this.state.views[id]?.run : null
    if(run && !isTerminalRunStatus(run.status))await this.api.cancelRun(run.id)
  }
  private receive = (event: RunEvent): void => {
    const id = event.conversationId, view = this.state.views[id]
    if(!view)return
    if(this.loading.has(id)) { this.pending.set(id,[...(this.pending.get(id)??[]),event]); return }
    if(event.cursor && event.cursor <= view.cursor)return
    if(event.cursor && event.cursor > view.cursor+1) {
      this.pending.set(id,[...(this.pending.get(id)??[]),event]); void this.reload(id); return
    }
    const payload = event.payload as { delta?: string; status?: Run['status'] }
    const patch: Partial<ConversationView> = { cursor: event.cursor ?? view.cursor }
    if(event.type==='message.delta' && typeof payload.delta==='string') {
      if(!view.messages.some(item=>item.id===event.messageId)) { void this.reload(id); return }
      patch.messages = view.messages.map(message=>{
        if(message.id!==event.messageId)return message
        const parts = [...message.parts], last = parts.at(-1)
        if(last?.type==='text')parts[parts.length-1]={ type:'text', text:last.text+payload.delta! }
        else parts.push({ type:'text', text:payload.delta! })
        return { ...message, parts, status:'streaming' }
      })
    }
    const details = view.runs[event.runId]
    if(details) {
      const run = event.type==='run.status_changed' && payload.status && details.run ? {...details.run,status:payload.status} : details.run
      patch.runs={...view.runs,[event.runId]:{...details,run,events:[...(details.events??[]),event]}}
      patch.run=selectConversationRun(patch.messages??view.messages,patch.runs)
    }
    this.updateView(id,patch)
    if(['run.completed','message.completed','message.reset','run.resumed','approval.required','source.added','artifact.created'].includes(event.type))void this.reload(id)
  }
  dispose(): void { this.unsubscribeEvents?.(); this.unsubscribeEvents=null }
}

let instance: ConversationStore | undefined
export function conversationStore(): ConversationStore { return instance ??= new ConversationStore(window.api.chat) }
