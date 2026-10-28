export interface ModelCaps {
  reasoningLevels:string[]
  context?:number
  maxOutput?:number
  inputs?:Array<'text'|'image'|'video'|'pdf'>
  caps?:Array<'json'|'websearch'|'system'>
  toolCalling?:boolean
}
export interface ProviderProfile {
  id?:string
  provider:string
  apiBase:string
  apiKey:string
  models:string[]
  modelCaps?:Record<string,ModelCaps>
}

export interface ModelBindingOption {id:string;profileId:string;model:string;provider:string;label:string}
export function modelBindingId(profileId:string,model:string):string { return `${profileId}:${model}` }
export function parseModelBindingId(id:string):{profileId:string;model:string}|null {
  const separator=id.indexOf(':')
  return separator>0&&separator<id.length-1?{profileId:id.slice(0,separator),model:id.slice(separator+1)}:null
}
export function modelBindingOptions(profiles:ProviderProfile[]):ModelBindingOption[] {
  return profiles.flatMap(profile=>profile.id?[...new Set(profile.models)].map(model=>{
    let address=profile.apiBase
    try{const url=new URL(address);address=url.host+url.pathname.replace(/\/+$/,'')}catch{}
    return {id:modelBindingId(profile.id!,model),profileId:profile.id!,model,provider:profile.provider,label:`${profile.provider} · ${address}`}
  }):[])
}
