import type { ArtifactRef } from '../../shared/tools'

export interface WorkspaceChatNote { noteId:string;paperId?:number }
export interface WorkspaceChatWeb { url:string;title:string;snippet:string;documentVersion:string }
export interface WorkspaceChatSelection { paperId:number;page:number;text:string;documentVersion:string;origin:'pdf'|'sidepanel'|'detail'|'compare' }
export type WorkspaceAction = {kind:'artifact';artifact:ArtifactRef} | {kind:'chat';paperIds:number[];notes?:WorkspaceChatNote[];selections?:WorkspaceChatSelection[];web?:WorkspaceChatWeb[];prompt?:string;fresh?:boolean} | {kind:'paper';paperId:number;page?:number} | {kind:'citation';slug:string;page:number;snippet?:string;probe?:string;documentVersion?:string}
export const WORKSPACE_ACTION='cspaper:workspace-action'
export function dispatchWorkspaceAction(action:WorkspaceAction):void { window.dispatchEvent(new CustomEvent(WORKSPACE_ACTION,{detail:action})) }
export function openWorkspaceArtifact(artifact:ArtifactRef):void { dispatchWorkspaceAction({kind:'artifact',artifact}) }
