import React from 'react'
import { createRoot } from 'react-dom/client'
// 基础样式表必须先于组件样式表加载，否则功能样式（wb/kv/st2/ws）会被全局表反向覆盖
import './styles.css'
import App from './App'
import { DialogProvider } from './Dialog'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </React.StrictMode>
)
