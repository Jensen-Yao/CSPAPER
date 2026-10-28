import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keep a render failure recoverable instead of turning the whole desktop window blank. */
export default class ErrorBoundary extends Component<{children:ReactNode},{error:Error|null}> {
  state:{error:Error|null}={error:null}
  static getDerivedStateFromError(error:Error):{error:Error} {return {error}}
  componentDidCatch(error:Error,info:ErrorInfo):void {console.error('[界面错误]',error,info.componentStack)}
  render():ReactNode {
    if(!this.state.error) return this.props.children
    return <main className="app-recovery" role="alert">
      <span className="seal">文</span><h1>这个界面暂时无法显示</h1>
      <p>重新载入界面后可以继续。正在编辑的笔记草稿会保留在本机。</p>
      <details><summary>查看错误详情</summary><pre>{this.state.error.message}</pre></details>
      <button className="btn" onClick={()=>window.location.reload()}>重新载入</button>
    </main>
  }
}
