const { spawn, execSync } = require('node:child_process')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const env = { ...process.env, CSPAPER_DATA_DIR: 'F:/tmp/cspaper-data' }
const electron = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.'], { cwd: ROOT, env, stdio: 'ignore' })
setTimeout(() => {
  try { execSync('powershell -ExecutionPolicy Bypass -File scripts/os-shot.ps1', { cwd: ROOT, stdio: 'inherit' }); console.log('shot ok') }
  catch (e) { console.error('shot fail', String(e).slice(0, 150)) }
  try { execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }) } catch {}
  process.exit(0)
}, 10000)
