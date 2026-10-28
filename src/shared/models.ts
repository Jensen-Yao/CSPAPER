import { z } from 'zod'

export const modelCapabilitySchema = z.enum([
  'text','streaming','tool_calling','json','vision','embedding','reasoning','long_context'
])
export type ModelCapability = z.infer<typeof modelCapabilitySchema>

export const modelBindingSnapshotSchema = z.object({
  bindingId: z.string().min(1),
  profileId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  capabilities: z.array(modelCapabilitySchema),
  contextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoning: z.string().min(1).default('default'),
  temperature: z.number().min(0).max(2).optional()
  ,apiBase:z.string().url().optional()
  ,reasoningLevels:z.array(z.string()).optional()
  ,executionProtocol:z.enum(['text','json_plan','native_tools']).optional()
})
export type ModelBindingSnapshot = z.infer<typeof modelBindingSnapshotSchema>

export const modelErrorSchema = z.object({
  code: z.enum(['missing_key','invalid_key','quota','rate_limit','network','timeout','provider_error','capability_mismatch','aborted','unknown']),
  message: z.string(),
  retryable: z.boolean(),
  providerCode: z.string().optional()
})
export type ModelError = z.infer<typeof modelErrorSchema>
