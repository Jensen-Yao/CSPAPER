import crypto from 'node:crypto'
import type { Settings } from './db'
import type { ModelBindingSnapshot } from '../shared/models'
import { modelBindingId, parseModelBindingId, type ProviderProfile } from '../shared/settings-models'
import { resolveCapabilities } from './models/capabilities'

/** Persisted profile identity survives reordering and same-name models. */
export function normalizeModelSettings(settings:Settings):Settings {
  const ids=new Set<string>()
  const profiles=(settings.profiles?.length?settings.profiles:[{id:'profile-default',provider:settings.provider,apiBase:settings.apiBase,apiKey:settings.apiKey,models:[...new Set([...(settings.models??[]),settings.model,settings.agentModel].filter((model):model is string=>!!model))]}]).map(profile=>{
    let id=profile.id
    if(!id||ids.has(id))id='profile-'+crypto.randomUUID()
    ids.add(id)
    return {...profile,id,models:[...new Set(profile.models)]}
  })
  const choose=(bindingId:string|undefined,model:string|undefined)=>{
    const parsed=bindingId?parseModelBindingId(bindingId):null
    const exact=parsed?profiles.find(profile=>profile.id===parsed.profileId&&profile.models.includes(parsed.model)):undefined
    if(exact&&parsed)return {profile:exact,model:parsed.model}
    const candidates=profiles.filter(profile=>model&&profile.models.includes(model))
    const profile=candidates.find(profile=>profile.apiBase===settings.apiBase&&profile.provider===settings.provider)??candidates[0]??profiles.find(profile=>profile.models.length)
    return profile?{profile,model:model&&profile.models.includes(model)?model:profile.models[0]}:null
  }
  const active=choose(settings.modelBindingId,settings.model),agent=choose(settings.agentModelBindingId,settings.agentModel||active?.model)
  return {...settings,profiles,...(active?{modelBindingId:modelBindingId(active.profile.id,active.model),model:active.model,provider:active.profile.provider,apiBase:active.profile.apiBase,apiKey:active.profile.apiKey}:{}),...(agent?{agentModelBindingId:modelBindingId(agent.profile.id,agent.model)}:{})}
}

/** Compatibility for older readers; ambiguous names stay with the selected provider. */
export function modelSettings(settings:Settings,model:string,profileId?:string):Settings {
  const profiles=settings.profiles??[]
  const profile=profileId?profiles.find(profile=>profile.id===profileId&&profile.models.includes(model)):profiles.filter(profile=>profile.models.includes(model)).find(profile=>profile.apiBase===settings.apiBase)??profiles.find(profile=>profile.models.includes(model))
  if(profileId&&!profile)throw new Error('所选模型配置已删除或不包含该模型')
  return profile?{...settings,provider:profile.provider,apiBase:profile.apiBase,apiKey:profile.apiKey,model}:{...settings,model}
}

export function snapshotModelBinding(settings:Settings,id:string,reasoning:ModelBindingSnapshot['reasoning']='default',mode:'ask'|'act'='ask'):ModelBindingSnapshot {
  const parsed=parseModelBindingId(id)
  const profile=parsed?(settings.profiles??[]).find(profile=>profile.id===parsed.profileId&&profile.models.includes(parsed.model)):undefined
  if(!parsed||!profile)throw new Error('所选模型绑定无效，请重新选择配置与模型')
  const url=new URL(profile.apiBase)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search)throw new Error('模型 API 地址必须是无凭据的 HTTP(S) 地址')
  const caps=resolveCapabilities(profile,parsed.model)
  if(mode==='act'&&!caps.capabilities.some(capability=>capability==='json'||capability==='tool_calling'))throw new Error('该模型尚未声明结构化输出或工具能力，可在设置中确认能力后执行任务；资料问答仍可使用')
  return {bindingId:id,profileId:parsed.profileId,provider:profile.provider,model:parsed.model,apiBase:profile.apiBase.replace(/\/+$/,''),...caps,reasoning,executionProtocol:mode==='act'?'json_plan':'text'}
}

export function credentialsForBinding(settings:Settings,binding:ModelBindingSnapshot):ProviderProfile {
  const profile=(settings.profiles??[]).find(profile=>profile.id===binding.profileId)
  if(!profile||!profile.models.includes(binding.model))throw new Error('运行绑定的模型配置已删除，不能改用其他服务商')
  if(binding.apiBase&&profile.apiBase.replace(/\/+$/,'')!==binding.apiBase)throw new Error('运行创建后模型端点已变更，请使用新配置重试')
  return profile
}
