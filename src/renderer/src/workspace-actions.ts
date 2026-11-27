import type { ArtifactRef } from '../../shared/tools'

export interface WorkspaceChatNote { noteId:string;paperId?:number }
export interface WorkspaceChatWeb { url:string;title:string;snippet:string;documentVersion:string }
export interface WorkspaceChatSelection { paperId:number;page:number;text:string;documentVersion:string;origin:'pdf'|'sidepanel'|'detail'|'compare' }
export type WorkspaceAction = {kind:'artifact';artifact:ArtifactRef} | {kind:'chat';paperIds:number[];notes?:WorkspaceChatNote[];selections?:WorkspaceChatSelection[];web?:WorkspaceChatWeb[];prompt?:string;fresh?:boolean} | {kind:'web';url:string} | {kind:'paper';paperId:number;page?:number} | {kind:'citation';slug:string;page:number;snippet?:string;probe?:string;documentVersion?:string}
export const WORKSPACE_ACTION='cspaper:workspace-action'
export function dispatchWorkspaceAction(action:WorkspaceAction):void { window.dispatchEvent(new CustomEvent(WORKSPACE_ACTION,{detail:action})) }
export function openWorkspaceArtifact(artifact:ArtifactRef):void { dispatchWorkspaceAction({kind:'artifact',artifact}) }

/** 跨视图打开请求：研究台 / 命令面板 → 笔记中心、文献问答、Work 任务视图。 */
export const OPEN_NOTE_EVENT='cspaper:open-note'
export const OPEN_CONVERSATION_EVENT='cspaper:open-conversation'
export const OPEN_WORK_CONVERSATION_EVENT='cspaper:open-work-conversation'
/** 打开 Work 的项目页（可带 projectId 定位到某个项目）。 */
export const OPEN_PROJECTS_EVENT='cspaper:work-open-projects'
/** 项目/任务增删改后广播，研究台与今日页据此刷新。 */
export const TASKS_CHANGED_EVENT='cspaper:tasks-changed'
export function notifyTasksChanged():void { window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)) }
