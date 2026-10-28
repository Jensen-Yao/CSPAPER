import type { ChatMessage } from '../llm'
import type { ModelBindingSnapshot } from '../../shared/models'
import { streamModel } from '../models/provider'
import { getSettings } from '../db'
import { credentialsForBinding } from '../model-config'

export interface ProviderStreamOptions {
  model: ModelBindingSnapshot
  signal?: AbortSignal
  temperature?: number
}

export interface ChatProvider {
  stream(messages: ChatMessage[], options: ProviderStreamOptions): AsyncGenerator<string>
}

/** Production provider delegates to the existing OpenAI-compatible transport; credentials stay in settings. */
export class SystemChatProvider implements ChatProvider {
  async *stream(messages:ChatMessage[],options:ProviderStreamOptions):AsyncGenerator<string> {
    const profile=credentialsForBinding(getSettings(),options.model)
    yield* streamModel(messages,options.model,{signal:options.signal,temperature:options.temperature,apiKey:profile.apiKey})
  }
}
