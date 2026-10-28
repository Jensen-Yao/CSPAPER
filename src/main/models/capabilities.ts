import type { ProviderProfile } from '../../shared/settings-models'
import type { ModelCapability } from '../../shared/models'
import { presetCaps } from '../../shared/model-caps-presets'

export function resolveCapabilities(profile:ProviderProfile,model:string) {
  const caps={...presetCaps(model),...profile.modelCaps?.[model]}
  const capabilities:ModelCapability[]=['text','streaming']
  if(caps.caps?.includes('json'))capabilities.push('json')
  if(caps.inputs?.includes('image'))capabilities.push('vision')
  if(caps.reasoningLevels?.length)capabilities.push('reasoning')
  if(caps.toolCalling===true)capabilities.push('tool_calling')
  return {capabilities,reasoningLevels:caps.reasoningLevels??[],contextWindowTokens:caps.context,maxOutputTokens:caps.maxOutput}
}
