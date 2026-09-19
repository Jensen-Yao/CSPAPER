import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 双入口：index 为主进程，ingest-worker 为索引工作线程（W0a，PDF 抽取不占主进程事件循环）
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), 'ingest-worker': resolve('src/main/ingest-worker.ts') },
        output: { entryFileNames: '[name].js', chunkFileNames: 'chunk-[name].js' }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
