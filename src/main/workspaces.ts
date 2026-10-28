import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { normalizePath } from './paper-files'

export interface Workspace { id:string; rootPath:string; normalizedRoot:string; displayName:string; createdAt:string; updatedAt:string }

interface WorkspaceRow { id:string;root_path:string;normalized_root:string;display_name:string;created_at:string;updated_at:string }

function rowToWorkspace(row:WorkspaceRow):Workspace {
  return { id:row.id,rootPath:row.root_path,normalizedRoot:row.normalized_root,displayName:row.display_name,createdAt:row.created_at,updatedAt:row.updated_at }
}

/** Register a root once; path casing/renames update the same stable workspace ID. */
export function ensureWorkspace(db:Database.Database,rootPath:string,displayName=''):Workspace {
  const root=rootPath.trim()
  if(!root) throw new Error('工作区路径不能为空')
  const normalized=normalizePath(root)
  const now=new Date().toISOString()
  const existing=db.prepare('SELECT * FROM workspaces WHERE normalized_root=?').get(normalized) as WorkspaceRow|undefined
  if(existing) {
    if(existing.root_path!==root||existing.display_name!==displayName) {
      db.prepare('UPDATE workspaces SET root_path=?,display_name=?,updated_at=? WHERE id=?').run(root,displayName,now,existing.id)
      return rowToWorkspace({...existing,root_path:root,display_name:displayName,updated_at:now})
    }
    return rowToWorkspace(existing)
  }
  const id='ws_'+crypto.randomUUID()
  db.prepare('INSERT INTO workspaces(id,root_path,normalized_root,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,root,normalized,displayName,now,now)
  return { id,rootPath:root,normalizedRoot:normalized,displayName,createdAt:now,updatedAt:now }
}

export function getWorkspace(db:Database.Database,id:string):Workspace|null {
  const row=db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as WorkspaceRow|undefined
  return row?rowToWorkspace(row):null
}

export function listWorkspaces(db:Database.Database):Workspace[] {
  return (db.prepare('SELECT * FROM workspaces ORDER BY created_at').all() as WorkspaceRow[]).map(rowToWorkspace)
}
