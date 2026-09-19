// 主进程侧抽取池：把抽取任务排队发给工作线程（W0a）。
// 串行执行（同一时刻只解析一篇，控制内存）；worker 启动失败/崩溃时调用方回退主线程直接抽取。
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { app } from 'electron'

interface PendingJob {
  resolve: (pages: string[]) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let broken = false
let seq = 0
const pending = new Map<number, PendingJob>()
let chain: Promise<unknown> = Promise.resolve()

function assetRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : app.getAppPath()
}

function ensureWorker(): Worker | null {
  if (broken) return null
  if (worker) return worker
  try {
    worker = new Worker(path.join(__dirname, 'ingest-worker.js'), { workerData: { assetRoot: assetRoot() } })
    worker.on('message', (m: { id: number; ok: boolean; pages?: string[]; error?: string }) => {
      const job = pending.get(m.id)
      if (!job) return
      pending.delete(m.id)
      if (m.ok) job.resolve(m.pages ?? [])
      else job.reject(new Error(m.error ?? 'PDF 抽取失败'))
    })
    worker.on('error', (e) => {
      // worker 崩溃（罕见）：本次任务报错，之后回退主线程抽取
      broken = true
      worker = null
      for (const [, job] of pending) job.reject(e instanceof Error ? e : new Error(String(e)))
      pending.clear()
    })
    worker.on('exit', (code) => {
      if (code !== 0) broken = true
      worker = null
    })
    return worker
  } catch {
    broken = true
    return null
  }
}

export function extractInWorker(pdfPath: string, maxPages: number): Promise<string[]> {
  const w = ensureWorker()
  if (!w) return Promise.reject(new Error('worker unavailable'))
  const id = ++seq
  const run = chain.catch(() => undefined).then(
    () =>
      new Promise<string[]>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({ id, pdfPath, maxPages })
      })
  )
  chain = run.catch(() => undefined)
  return run
}
