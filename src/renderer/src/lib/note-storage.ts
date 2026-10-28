const key = (id: number): string => `cspaper.note-draft.${id}`
export function rememberNoteDraft(id: number, text: string): void {
  try { localStorage.setItem(key(id),text) } catch { /* The live editor still retains the draft. */ }
}
export function readNoteDraft(id: number): string | null {
  try { return localStorage.getItem(key(id)) } catch { return null }
}
const queues = new Map<number, Promise<void>>()
/** Serialize writes for a document so an old response cannot replace newer text. */
export function persistNote(id: number,text: string): Promise<void> {
  rememberNoteDraft(id,text)
  const next=(queues.get(id) ?? Promise.resolve()).catch(()=>{}).then(async()=>{
    if(await window.api.myNotesSave(id,text)===false) throw new Error('笔记未保存，文献可能已移出库')
    try {if(readNoteDraft(id)===text) localStorage.removeItem(key(id))} catch { /* optional recovery cache */ }
    window.dispatchEvent(new CustomEvent('cspaper:notes-changed',{detail:{id}}))
  })
  queues.set(id,next)
  void next.finally(()=>{if(queues.get(id)===next) queues.delete(id)}).catch(()=>{})
  return next
}
