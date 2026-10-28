import type { ArtifactRef } from '../../../../shared/tools'
const labels:Record<string,string>={note:'笔记',comparison:'对比表',synthesis:'综述',paper:'文献',export:'导出文件'}

export default function ResultCards({artifacts,onOpen}:{artifacts:ArtifactRef[];onOpen:(artifact:ArtifactRef)=>void}) {
  if(!artifacts.length)return null
  return <div className="chat-result-cards">{artifacts.map(artifact=>(
    <button key={artifact.id} onClick={()=>onOpen(artifact)}><b>{artifact.title}</b><small>{labels[artifact.kind]??'产物'}</small></button>
  ))}</div>
}
