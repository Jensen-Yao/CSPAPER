import type { Source } from '../../../../shared/sources'
const labels:Record<Source['status'],string>={available:'可核实',moved:'位置已变更',version_changed:'文档版本已变化',missing:'来源文件缺失',unverified:'尚未核实'}

export default function SourcePopover({source}:{source:Source}) {
  return <div className="chat-source-popover"><b>{source.title}</b><p>{source.snippet}</p><small>{labels[source.status]}{source.locator.page?` · 第 ${source.locator.page} 页`:''}</small></div>
}
