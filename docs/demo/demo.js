/* CSPAPER 在线演示：纯静态、无后端。文献、作者与模型回复均为示例数据，用于展示产品的工作流。 */
(function () {
  'use strict'

  const RELEASES = 'https://github.com/Jensen-Yao/CSPAPER/releases/latest'
  const BRAND = '../assets/brand-128.png'
  const VIEWS = ['hub', 'reader', 'chat', 'work', 'projects', 'compare', 'notes']
  const $ = (selector, root) => (root || document).querySelector(selector)
  const $$ = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector))
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  const sum = list => list.reduce((total, item) => total + item, 0)

  /* ---------- 图标（与桌面端同一套 16px 细线图标） ---------- */
  const ICONS = {
    home: '<path d="M2.5 7.2 8 2.5l5.5 4.7v5.8h-11z"/><path d="M6.3 12.9V9.2h3.4v3.7"/>',
    library: '<path d="M2.5 2.5h4v11h-4zM9.5 2.5h4v11h-4z"/><path d="M2.5 5.5h4M9.5 5.5h4"/>',
    chat: '<path d="M2.5 3.5h11v7h-6L4 13.5V10.5H2.5z"/><path d="M5.5 7h5"/>',
    table: '<path d="M2.5 3.5h11v9h-11z"/><path d="M2.5 6.5h11M2.5 9.5h11M6 3.5v9"/>',
    notes: '<path d="M4 2.5h8v11H4z"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5"/>',
    compare: '<rect x="2" y="2.5" width="12" height="11" rx="1.4"/><path d="M2 6h12M2 9.5h12M6.5 2.5v11"/>',
    globe: '<circle cx="8" cy="8" r="5.6"/><path d="M2.4 8h11.2M8 2.4c2.6 2.8 2.6 8.4 0 11.2-2.6-2.8-2.6-8.4 0-11.2z"/>',
    zap: '<path d="M9 1.8 3.6 8.6h3.1L6.4 14.2 12 7.2H8.7z"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    search: '<circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/>',
    gear: '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4"/>',
    calendar: '<rect x="2.3" y="3.4" width="11.4" height="10.4" rx="1.5"/><path d="M5.2 2v2.8M10.8 2v2.8M2.5 6.5h11"/>',
    clock: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2.2 1.4"/>',
    target: '<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.4"/>',
    grid: '<rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1"/>',
    folder: '<path d="M2 4a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
    book: '<path d="M2.5 3.2c1.8-.8 3.7-.8 5.5 0v9.6c-1.8-.8-3.7-.8-5.5 0z"/><path d="M13.5 3.2c-1.8-.8-3.7-.8-5.5 0v9.6c1.8-.8 3.7-.8 5.5 0z"/>',
    check: '<path d="M3 8.6 6.4 12 13 4.4"/>',
    upload: '<path d="M8 13.5v-8M4.8 8.5 8 5.3l3.2 3.2M2.8 2.8h10.4"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    pdf: '<path d="M4 2.5h5.5L13 6v7.5H4z"/><path d="M9.5 2.5V6H13"/>',
    external: '<path d="M6 3h7v7M13 3 6.5 9.5M11 13.5H3v-8"/>'
  }
  const icon = (name, size) => '<svg width="' + (size || 15) + '" height="' + (size || 15) + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>'

  /* ---------- 示例数据 ---------- */
  const today = new Date()
  const dateLabel = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') }
  const dueLabel = offset => offset === 0 ? '今天' : offset === 1 ? '明天' : offset === -1 ? '昨天' : dateLabel(offset)

  const STATUS = {
    reading: { label: '在读', color: '#6b7fa3', bg: 'rgba(107,127,163,.13)' },
    todo: { label: '稍后读', color: '#9e3b2f', bg: 'rgba(158,59,47,.1)' },
    unread: { label: '待读', color: '#7b8794', bg: 'rgba(123,135,148,.14)' },
    read: { label: '已读', color: '#5f8264', bg: 'rgba(95,130,100,.13)' }
  }
  const PAPERS = [
    { id: 'p1', title: 'Tool-Augmented Language Agents: A Reproducible Evaluation Protocol', year: 2025, cat: '01-智能体', status: 'reading', page: 1, pages: 2, pdf: true, opened: '2 小时前' },
    { id: 'p2', title: 'Citation Faithfulness in Knowledge-Grounded Generation: Measuring What Models Actually Support', year: 2025, cat: '02-检索增强', status: 'reading', page: 2, pages: 2, pdf: true, opened: '昨天' },
    { id: 'p3', title: 'Self-Verification Reduces Hallucinated Citations in Scientific Summaries', year: 2026, cat: '02-检索增强', status: 'todo', pdf: true, opened: null },
    { id: 'p4', title: 'Planning Under Uncertainty for Multi-Step LLM Agents', year: 2024, cat: '01-智能体', status: 'todo', pdf: true, opened: null },
    { id: 'p5', title: 'A Benchmark for Tool-Use Robustness Across Domain Shifts', year: 2025, cat: '03-评测方法', status: 'unread', pdf: true, opened: null },
    { id: 'p6', title: 'Memory of Prior Tool Calls: Auditing Agent Trajectories', year: 2025, cat: '03-评测方法', status: 'read', page: 2, pages: 2, pdf: true, opened: '3 天前' },
    { id: 'p7', title: 'Human-in-the-Loop Approval for Agent-Generated Scientific Claims', year: 2024, cat: '01-智能体', status: 'read', page: 2, pages: 2, pdf: true, opened: '上周' },
    { id: 'p8', title: 'Cost-Aware Retrieval for Long-Context Literature Review', year: 2026, cat: '02-检索增强', status: 'unread', pdf: true, opened: null },
    { id: 'p9', title: 'From Reading Lists to Research Assistants: A Workflow Survey', year: 2023, cat: '03-评测方法', status: 'unread', pdf: false, opened: null }
  ]
  const shortTitle = title => title.length > 46 && title.includes(':') ? title.split(':')[0] : title

  const PROJECTS = [
    { id: 'pr1', name: '综述：工具调用智能体的可靠性评估', desc: '为综述收集证据：轨迹审计、引用忠实度、人机审批三条线。', color: '#9e3b2f', status: '进行中', dueIn: 12 },
    { id: 'pr2', name: '组会汇报：检索增强生成的引用问题', desc: '10 分钟汇报，重点讲清楚句级忠实度怎么测。', color: '#1558c0', status: '进行中', dueIn: 5 },
    { id: 'pr3', name: '开题材料准备', desc: '研究问题、创新点与时间表。', color: '#5a7256', status: '已暂停', dueIn: null }
  ]
  const TASKS = [
    { id: 1, projectId: 'pr1', title: '读完轨迹审计相关的三篇核心文献', notes: '重点看第 3 节的恢复实验。', status: 'todo', priority: 'high', dueIn: 0, paper: 'p1' },
    { id: 2, projectId: 'pr1', title: '整理对比表：审计前后的恢复率', notes: '从三篇论文的表 1 抽数据。', status: 'todo', priority: 'medium', dueIn: 2 },
    { id: 3, projectId: 'pr1', title: '写综述第 2 节：引用忠实度的测量方法', notes: '先区分检索失败与归因失败。', status: 'doing', priority: 'high', dueIn: -1 },
    { id: 4, projectId: 'pr1', title: '核对句级标注的一致性数据', notes: 'Castellanos 等报告标注一致性 0.81。', status: 'doing', priority: 'low', dueIn: 4 },
    { id: 5, projectId: 'pr1', title: '确定综述的检索式与纳入标准', notes: '已导入 Zotero 分类的 105 条题录。', status: 'done', priority: 'medium', dueIn: -6 },
    { id: 6, projectId: 'pr1', title: '回复导师关于实验设计的邮件', notes: '', status: 'done', priority: 'high', dueIn: -9 },
    { id: 7, projectId: 'pr2', title: '画一张引用错误类型的示意图', notes: '检索失败 vs 归因失败。', status: 'todo', priority: 'medium', dueIn: 6 },
    { id: 8, projectId: 'pr2', title: '准备 10 分钟汇报提纲', notes: '带上句级忠实度的对比表。', status: 'doing', priority: 'high', dueIn: 1 }
  ]
  const PRIORITY = { high: '高', medium: '中', low: '低' }
  const isOverdue = task => task.dueIn < 0 && task.status !== 'done'

  const EVENTS = [
    { time: '09:30', kind: 'task', title: '晨间阅读：轨迹审计' },
    { time: '14:00', kind: 'meeting', title: '组会：综述进度同步' },
    { time: '全天', kind: 'deadline', title: '投稿摘要截止' }
  ]
  const KIND = { task: '任务', meeting: '会议', deadline: '截止' }

  const NOTES = [
    { id: 'n1', title: '开题思路：把轨迹审计作为切入点', kind: 'note', when: '32 分钟前', body: '## 核心主张\n\n与其追求更强的规划能力，不如先把智能体的每一步工具调用记录成可重放的轨迹。\n\n## 三条证据线\n\n1. 轨迹审计让失败可复现（Tool-Augmented Language Agents）\n2. 句级引用忠实度把“引用存在”变成“引用支持结论”\n3. 人工审批把证据片段放到断言旁边，错误检出率从 54% 升到 81%\n\n## 下一步\n\n- 读 Human-in-the-Loop Approval 的界面实验\n- 整理恢复率对比表' },
    { id: 'n2', title: '组会问题清单', kind: 'note', when: '昨天', body: '- 审计日志的存储开销有多大？\n- 如果工具本身返回错误结果，轨迹审计还能发现问题吗？\n- 句级忠实度的标注成本能否用模型辅助降低？' },
    { id: 'n3', title: '待读：self-verification 的成本分析', kind: 'note', when: '昨天', body: '自校验把无支持引用从 18.4% 降到 6.9%，推理成本 +14%。需要确认这个成本是否随摘要长度线性增长。' },
    { id: 'n4', title: '实验设计草稿', kind: 'note', when: '3 天前', body: '| 条件 | 审计 | 自校验 | 样本 |\n| --- | --- | --- | --- |\n| A | 否 | 否 | 200 |\n| B | 是 | 否 | 200 |\n| C | 是 | 是 | 200 |' },
    { id: 'n5', title: 'Tool-Augmented Language Agents · 我的笔记', kind: 'paper', when: '2 小时前', body: '## 核心结论\n\n固定工具 schema + 制品级成功判定后，开源智能体之间的差距从 52 收窄到 14 个点。\n\n## 对我的启发\n\n- 轨迹日志是复现的前提，综述里要把“可审计”单列一节。\n- 注入 10% 工具错误来测恢复能力，这个设计可以借用到自己的实验里。' },
    { id: 'n6', title: 'Memory of Prior Tool Calls · 我的笔记', kind: 'paper', when: '3 天前', body: '## 一句话\n\n把每一次工具调用的参数、观察和模型状态写成只追加的日志，失败就能被精确重放。\n\n## 可引用数字\n\n- 重放 600 条轨迹，精确复现 94% 的已报告失败。\n- 31% 的错误来自跨步骤复用的过期观察。' }
  ]

  /* ---------- 论文正文（示例，句子可被引用与高亮） ---------- */
  const PAPER_TITLE = 'Tool-Augmented Language Agents: A Reproducible Evaluation Protocol'
  const SENT = {
    s01: ['Language agents that call external tools are increasingly used for literature search, data analysis and report drafting, yet published evaluations rarely share a common protocol.', '调用外部工具的语言智能体越来越多地用于文献检索、数据分析和报告起草，但已发表的评测很少遵循统一的协议。'],
    s02: ['We propose a reproducible evaluation protocol for tool-augmented agents that fixes the tool schema, the task split, the success criteria and the logging format.', '我们提出一套面向工具增强智能体的可复现评测协议，固定工具 schema、任务划分、成功判定标准与日志格式。'],
    s03: ['Under this protocol we re-evaluate nine open agents and find that reported gains shrink by 38 percent once environment noise is controlled, and that trajectory audits explain most of the remaining variance.', '在该协议下我们重新评测了九个开源智能体，发现控制环境噪声后，报告中的提升缩水 38%，而轨迹审计解释了大部分剩余方差。'],
    s04: ['Language agents that call external tools now handle literature search, table extraction and report drafting.', '调用外部工具的语言智能体如今已能处理文献检索、表格抽取与报告起草。'],
    s05: ['Yet the numbers reported by different groups are hard to compare: tool interfaces differ, success criteria are implicit, and intermediate results are discarded after a run.', '然而不同团队报告的数字难以横向比较：工具接口不同，成功标准是隐式的，中间结果在运行结束后就被丢弃。'],
    s06: ['This paper argues that a shared protocol is a prerequisite for cumulative progress.', '本文主张，统一的协议是持续推进的前提。'],
    s07: ['We make three contributions.', '我们有三点贡献。'],
    s08: ['First, we fix the tool schema and the task split so that every agent sees the same inputs.', '第一，固定工具 schema 与任务划分，让每个智能体看到相同的输入。'],
    s09: ['Second, we define success at the level of the final artefact rather than the final message.', '第二，把成功定义在最终制品层面，而不是最后一条消息。'],
    s10: ['Third, we require a complete trajectory log so that any reported result can be replayed.', '第三，要求完整的轨迹日志，使任何已报告的结果都可以被重放。'],
    s11: ['Early agent benchmarks measured whether a model could select the correct tool from a menu.', '早期的智能体基准只衡量模型能否从菜单中选出正确的工具。'],
    s12: ['Later work added multi-step tasks but kept domain-specific scoring rules.', '后续工作加入了多步任务，但仍沿用领域特定的评分规则。'],
    s13: ['Protocol-level comparisons are rare; the closest effort focuses on web navigation and does not cover scholarly tools.', '协议层面的比较很少见，最接近的工作聚焦网页导航，并未覆盖学术工具。'],
    s14: ['The protocol has four components.', '该协议包含四个组成部分。'],
    s15: ['The task suite contains 420 tasks grouped by the number of required tool calls.', '任务集包含 420 个任务，按所需工具调用次数分组。'],
    s16: ['The environment returns deterministic observations for a seeded random seed.', '在固定随机种子下，环境返回确定性的观察结果。'],
    s17: ['Success is scored by three independent checks on the produced artefact: schema validity, claim support and completeness.', '成功由对所生成制品的三项独立检查打分：schema 有效性、断言支持度与完整性。'],
    s18: ['Trajectories are stored as append-only logs.', '轨迹以只追加日志的形式保存。'],
    s19: ['Agents interact with eight tools: a library search, a page reader, a note writer, a table builder and four utilities.', '智能体与八个工具交互：文献检索、页面阅读、笔记写入、表格构建，以及四个实用工具。'],
    s20: ['Tool errors are injected with probability 0.1 to test recovery.', '以 0.1 的概率注入工具错误，用于测试恢复能力。'],
    s21: ['Each agent is given the same instruction budget and the same maximum number of steps.', '每个智能体获得相同的指令预算与相同的最大步数。'],
    s22: ['Table 1 summarises the outcome.', '表 1 汇总了实验结果。'],
    s23: ['Once environment noise is controlled, the gap between the strongest and the weakest open agents shrinks from 52 to 14 points.', '控制环境噪声后，最强与最弱开源智能体之间的差距从 52 个百分点收窄到 14 个百分点。'],
    s24: ['Trajectory audits explain most of the remaining variance: agents that re-read stale observations fail twice as often on multi-step tasks.', '轨迹审计解释了大部分剩余方差：重复读取过期观察的智能体在多步任务上的失败率翻倍。'],
    s25: ['Recovery behaviour separates the agents more clearly than raw tool selection.', '恢复行为比单纯的工具选择更能区分智能体的强弱。'],
    s26: ['Agents that verify an observation before reusing it recover from 78 percent of injected errors, whereas agents that proceed on the stale state recover from 29 percent.', '复用观察前先做验证的智能体能从 78% 的注入错误中恢复，而沿用过期状态的智能体只有 29%。'],
    s27: ['Our results suggest that reported progress in tool-using agents is partly an artefact of loose evaluation.', '结果表明，工具智能体已报告的进展有一部分是宽松评测造成的假象。'],
    s28: ['A shared protocol does not remove the need for domain benchmarks, but it makes their results comparable and reproducible.', '统一协议并不能取代领域基准，但它让基准的结果可比、可复现。'],
    s29: ['We presented a reproducible evaluation protocol and showed how it changes the ranking of open agents.', '我们提出了一套可复现的评测协议，并展示了它如何改变开源智能体的排名。'],
    s30: ['The protocol, task suite and logs are released to support future comparisons.', '协议、任务集与日志均已发布，以支持后续比较。'],
    a01: ['Every task begins with a fixed instruction that lists the available tools and the expected output format.', '每个任务都从一条固定指令开始，其中列出了可用工具与期望的输出格式。'],
    a02: ['The instruction is identical across agents; only the tool descriptions differ.', '指令在所有智能体之间完全一致，只有工具描述不同。'],
    a03: ['Logging uses an append-only JSON-lines format in which each record carries the step index, the tool name, the serialized arguments, the observation hash and the wall-clock duration.', '日志采用只追加的 JSON-lines 格式，每条记录包含步骤序号、工具名、序列化参数、观察哈希与耗时。'],
    a04: ['Reviewers can replay a trajectory by feeding the recorded observations back in order.', '审稿人可以按顺序把记录下来的观察结果喂回给智能体，从而重放一条轨迹。'],
    a05: ['A replay is considered exact when the sequence of tool names and argument hashes matches the original log.', '当工具名与参数哈希的序列和原始日志一致时，重放被视为精确。'],
    a06: ['Three factors limit exact reproduction.', '有三个因素限制了精确复现。'],
    a07: ['Model providers change sampling behaviour without notice, so the sampling seed is recorded together with the model snapshot identifier.', '模型服务商会不经通知地改变采样行为，因此采样种子与模型快照标识会被一并记录。'],
    a08: ['Annotators of the final artefacts may apply the rubric differently; the protocol therefore reports pairwise agreement alongside every score.', '最终制品的标注者对评分标准的理解可能不同，因此协议在给出每个分数的同时报告标注者两两一致性。']
  }
  const TABLE1 = { head: ['Agent', 'Reported', 'Protocol', 'Audit', 'Steps'], rows: [['Atlas', '86.1', '71.4', '68.9', '6.2'], ['Boreal', '84.7', '69.8', '66.3', '7.5'], ['Cinder', '81.2', '64.0', '61.7', '8.9'], ['Dune', '77.5', '60.3', '58.1', '9.4'], ['Ember', '72.0', '57.4', '55.6', '11.0']], caption: 'Table 1: Task success under the shared protocol (420 tasks).' }
  const TABLE2 = { head: ['Agent', 'Injected errors', 'Recovered', 'Retried', 'Aborted'], rows: [['Atlas', '41', '78.0%', '12.2%', '9.8%'], ['Boreal', '41', '70.7%', '19.5%', '9.8%'], ['Cinder', '40', '62.5%', '22.5%', '15.0%'], ['Dune', '40', '52.5%', '27.5%', '20.0%'], ['Ember', '39', '41.0%', '28.2%', '30.8%']], caption: 'Table 2: Recovery rate after an injected tool error, by agent.' }
  const PAGES = [
    { blocks: [
      { h: '1  Introduction', ps: [['s04', 's05', 's06'], ['s07', 's08', 's09', 's10']] },
      { h: '2  Related Work', ps: [['s11', 's12', 's13']] },
      { h: '3  Evaluation Protocol', ps: [['s14', 's15', 's16', 's17', 's18'], ['s19', 's20', 's21']], table: TABLE1, fig: true },
      { h: '4  Results', ps: [['s22', 's23', 's24'], ['s25', 's26']] },
      { h: '5  Discussion', ps: [['s27', 's28']] },
      { h: '6  Conclusion', ps: [['s29', 's30']] }
    ] },
    { blocks: [
      { h: 'Appendix A  Prompt and Logging Format', ps: [['a01', 'a02'], ['a03'], ['a04', 'a05']] },
      { h: 'Appendix B  Additional Results', ps: [[]], table: TABLE2 },
      { h: 'Appendix C  Threats to Reproduction', ps: [['a06', 'a07', 'a08']] }
    ] }
  ]
  const SECTION_OF = {}
  PAGES[0].blocks.forEach((block, index) => block.ps.forEach(ids => ids.forEach(id => { SECTION_OF[id] = index })))
  PAGES[1].blocks.forEach((block, index) => block.ps.forEach(ids => ids.forEach(id => { SECTION_OF[id] = 6 + index })))

  const EXPLAINS = [
    '这一段交代研究动机：工具智能体的评测结果难以横向比较，原因在于接口、成功标准和中间记录都不统一。',
    '这里把本文与早期智能体基准区分开：早期工作只测工具选择或多步任务，没有在协议层面做比较。',
    '协议由任务集、确定性环境、制品级成功判定和只追加日志四部分组成，目的是让任何结果都能被重放。',
    '结果部分的核心数字：控制噪声后差距收窄，而恢复行为成为区分强弱的主要因素。',
    '讨论部分提醒读者，已报告的进展有一部分来自宽松评测，统一协议只是让结果可比。',
    '结论强调协议、任务集与日志都已发布，方便后续工作在相同条件下比较。',
    '附录说明日志格式：每条记录保留步骤、工具、参数、观察哈希与耗时，是重放的基础。',
    '附录 B 给出恢复率的分智能体明细，用来支撑正文里“先验证再复用”的结论。',
    '附录 C 列出影响精确复现的三个因素：采样行为、工具延迟与标注者差异。'
  ]

  /* ---------- 引用与来源 ---------- */
  const CITES = {
    c1: { n: 1, s: 's23', page: 1 },
    c2: { n: 2, s: 's26', page: 1 },
    c3: { n: 3, s: 's24', page: 1 },
    c4: { n: 4, s: 's17', page: 1 },
    c5: { n: 5, s: 's20', page: 1 },
    c6: { n: 6, s: 'a03', page: 2 },
    c7: { n: 7, s: 'a06', page: 2 },
    c8: { n: 8, s: 's15', page: 1 }
  }
  const SOURCES = {
    d1: { n: 1, title: 'Tool-Augmented Language Agents: A Reproducible Evaluation Protocol', page: 1 },
    d2: { n: 2, title: 'Citation Faithfulness in Knowledge-Grounded Generation', page: 1 },
    d3: { n: 3, title: 'Self-Verification Reduces Hallucinated Citations in Scientific Summaries', page: 1 },
    d4: { n: 4, title: 'Memory of Prior Tool Calls: Auditing Agent Trajectories', page: 1 }
  }
  const ARTIFACTS = { compare: { view: 'compare', label: '打开对比表', title: '对比表：轨迹审计三篇核心文献' }, notes: { view: 'notes', label: '打开笔记', title: 'Tool-Augmented Language Agents · 我的笔记' } }

  const RAG_ANSWER = '## 结论\n\n轨迹审计（trajectory audit）能减少不可核实的断言，关键在于它把**每一次工具调用的参数、观察结果与模型状态**都保留下来，使失败可复现、结论可追溯。[[d1]]\n\n| 维度 | 无审计 | 有轨迹审计 |\n| --- | --- | --- |\n| 任务成功率 | 57.4% | 68.9% |\n| 注入错误后的恢复率 | 29% | 78% |\n| 最弱与最强智能体差距 | 52 点 | 14 点 |\n\n**要点**\n\n1. 统一协议固定了工具 schema 与制品级成功判定；环境噪声被控制后，报告中的提升缩水约 38%。[[d1]]\n2. 复用过期观察（stale observation）的智能体在多步任务上失败率翻倍；先验证再复用可从 78% 的注入错误中恢复。[[d1]]\n3. 句级忠实度测量显示，不受支持的断言主要来自多跳组合，而不是检索失败。[[d2]]\n\n**局限**\n\n轨迹日志只保证“可复现”，并不自动保证结论正确；仍需要人工核对或自校验环节来确认证据。[[d3]]'
  const READER_ANSWER = '这篇论文用统一协议重新评测了 9 个开源工具智能体，核心发现有三点：\n\n1. **控制环境噪声后，提升明显缩水**：最强与最弱开源智能体之间的差距从 52 个百分点收窄到 14 个百分点。[[c1]]\n2. **恢复行为比工具选择更能区分智能体**：先验证观察再复用的智能体可从 78% 的注入错误中恢复，直接沿用过期状态的只有 29%。[[c2]]\n3. **轨迹日志解释了大部分剩余方差**：复用过期观察的智能体在多步任务上失败率翻倍。[[c3]]\n\n**实验设置**：420 个任务、8 个工具，并以 10% 的概率注入工具错误；成功由制品的 schema 有效性、断言支持度与完整性三项独立检查判定。[[c4]]'
  const REPORT = '## 已完成\n\n已检索文献库并锁定与“轨迹审计”直接相关的三篇论文，生成对比表 1 份，并为两篇文献追加了阅读笔记。\n\n## 真实产物\n\n- 对比表：轨迹审计三篇核心文献（3 篇 × 3 个维度） {{compare}}\n- 笔记：已写入 Tool-Augmented Language Agents 与 Citation Faithfulness 的「我的笔记」 {{notes}}\n\n## 关键结论\n\n1. 统一协议后，最强与最弱开源智能体的差距从 52 个百分点收窄到 14 个百分点。\n2. 先验证观察再复用的智能体可从 78% 的注入错误中恢复，直接沿用过期状态的只有 29%。\n3. 不受支持的断言主要来自多跳组合；句级忠实度在 61%–88% 之间。\n\n## 后续建议\n\n- 打开对比表核对“恢复率”一行，补上 Human-in-the-Loop Approval 的数据。\n- 第 2 节可以先写引用忠实度的测量方法，再回到轨迹审计。'

  const CONVS = [
    { id: 'c1', title: '轨迹审计与引用忠实度', when: '12 分钟前', msgs: [
      { role: 'user', text: '轨迹审计如何降低不可核实的断言？和引用忠实度有什么关系？' },
      { role: 'ai', text: RAG_ANSWER, src: ['d1', 'd2', 'd3'] }
    ] },
    { id: 'c2', title: '生成综述提纲', when: '昨天', msgs: [
      { role: 'user', text: '基于这三篇文献，为综述生成一份提纲。' },
      { role: 'ai', text: '## 综述提纲：工具调用智能体的可靠性评估\n\n1. **研究背景**：语言智能体从“会选工具”走向“可审计地完成多步任务”。[[d4]]\n2. **评测协议**：统一工具 schema 与制品级成功判定，控制环境噪声。[[d1]]\n3. **证据质量**：句级引用忠实度，把“引用存在”变成“引用支持结论”。[[d2]]\n4. **生成后校验**：自校验降低无支持引用的代价与收益。[[d3]]\n5. **研究空白**：跨领域迁移、人工审批界面与长轨迹的重放开销。' }
    ] },
    { id: 'c3', title: '对比三种恢复策略', when: '3 天前', msgs: [
      { role: 'user', text: '对比固定计划、逐步重规划和 belief-state lookahead。' },
      { role: 'ai', text: '| 策略 | 任务成功率 | 平均模型调用 |\n| --- | --- | --- |\n| 固定计划 | 69% | 1.4 |\n| 逐步重规划 | 72% | 2.5 |\n| Belief-state lookahead | 83% | 1.9 |\n\nLook-ahead 在长任务上的优势更明显，但需要比基线更强的模型。' }
    ] },
    { id: 'c4', title: '喝水提醒怎么设置', when: '上周', msgs: [
      { role: 'user', text: '读文献时的喝水提醒在哪里设置？' },
      { role: 'ai', text: '在 PDF 阅读器右上角的「阅读专注」面板里：可以分别设置专注、短休、长休的时长，以及喝水与活动提醒的间隔；离开阅读时会自动暂停。' }
    ] }
  ]
  const WORK = {
    goal: '帮我梳理轨迹审计如何降低不可核实的断言，生成三篇核心文献的对比表并保存笔记',
    steps: [
      { tool: 'library.search', args: 'query: "trajectory audit tool use" · limit: 3', note: '命中 3 篇', ok: true },
      { tool: 'comparison.create', args: 'paperIds: [3, 9, 4] · 3 个维度', note: '对比表已入库', ok: true },
      { tool: 'note.append', args: 'paperId: 3', note: '追加 2 条要点', ok: true },
      { tool: 'note.append', args: 'paperId: 4', note: '追加 1 条要点', ok: true }
    ]
  }
  const COMPARE = {
    papers: [
      { short: 'Tool-Augmented Language Agents', meta: 'Moreno 等 · 2025', cells: [
        [{ t: '开源工具智能体的报告成绩在统一协议下还剩多少', p: 1 }],
        [{ t: '固定工具 schema、制品级成功判定、完整轨迹日志', p: 1 }, { t: '420 个任务，注入 10% 工具错误测试恢复能力', p: 1 }],
        [{ t: '最强与最弱智能体差距从 52 收窄到 14 个百分点', p: 1 }, { t: '先验证再复用的智能体可从 78% 的注入错误中恢复', p: 1 }],
        [{ t: '任务由模板生成，真实用户目标更模糊', p: 2 }]
      ] },
      { short: 'Citation Faithfulness', meta: 'Castellanos 等 · 2025', cells: [
        [{ t: '被引用的片段是否真的支持这句话', p: 1 }],
        [{ t: '标注最小支持片段，区分检索失败与归因失败', p: 1 }, { t: '4,200 条断言，六个系统，两种评测模式', p: 1 }],
        [{ t: '句级忠实度 61%–88%；给 oracle 候选集后为 74%–91%', p: 1 }, { t: '两跳断言的忠实度降到 58%', p: 1 }],
        [{ t: '仅覆盖英文文献的三个领域', p: 1 }]
      ] },
      { short: 'Memory of Prior Tool Calls', meta: 'Sorensen 等 · 2025', cells: [
        [{ t: '工具结果被丢弃后，智能体失败为何难以复现', p: 1 }],
        [{ t: '只追加的轨迹日志：调用、参数、观察与模型状态', p: 1 }],
        [{ t: '重放 600 条轨迹可精确复现 94% 的已报告失败', p: 1 }, { t: '31% 的错误来自跨步骤复用的过期观察', p: 1 }],
        [{ t: '轨迹较长时重放开销明显上升', p: 2 }]
      ] }
    ],
    rows: ['研究问题', '方法', '核心结论', '局限']
  }
  const QUICK = [
    { label: '总结这篇', text: '请总结这篇文献的研究问题、核心方法与主要结论，并标注出处。' },
    { label: '找证据', text: '围绕核心主张，列出支持与反对的证据，逐条标注来源。' },
    { label: '对比方法', text: '用表格对比这几篇文献的研究方法、数据集与局限。' },
    { label: '生成提纲', text: '基于当前范围的文献，为一份综述生成详细提纲。' },
    { label: '追问局限', text: '这些研究还有哪些局限与未解决的问题？' }
  ]

  /* ---------- 运行状态 ---------- */
  const state = {
    paperId: 'p1', page: 1, readerTab: 'chat', docScroll: 0, pendingHit: null, pendingTr: null,
    readerMsgs: [{ role: 'user', text: '这篇论文的核心发现是什么？恢复实验是怎么设计的？' }, { role: 'ai', text: READER_ANSWER, src: ['c1', 'c2', 'c3', 'c4'] }],
    readerTyping: false,
    chatId: 'c1', chatTyping: false,
    drafts: {}, range: null, translated: new Set(),
    highlights: [{ id: 'h1', s: 's24', page: 1, color: 'yellow' }],
    projectId: 'pr1', adding: null, dragId: null, nextTask: 9,
    noteId: 'n1', captureOpen: false, nextNote: 7,
    dims: { 研究问题: true, 方法: true, 核心结论: true, 局限: true },
    focusOpen: false, focusSeconds: 25 * 60, focusRunning: false, waterDone: false, moveDone: false,
    toastTimer: null
  }

  /* ---------- 渲染工具 ---------- */
  function md(text) {
    const inline = value => esc(value)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[(\w+)\]\]/g, (match, id) => {
        const cite = CITES[id] || SOURCES[id]
        return cite ? '<button type="button" class="cite" data-action="cite" data-c="' + id + '" title="回到原文出处">' + cite.n + '</button>' : ''
      })
      .replace(/\{\{(\w+)\}\}/g, (match, id) => ARTIFACTS[id] ? '<button type="button" class="cite" data-action="go" data-view="' + ARTIFACTS[id].view + '" title="' + esc(ARTIFACTS[id].title) + '">' + esc(ARTIFACTS[id].label) + '</button>' : '')
    const lines = String(text).trim().split('\n')
    let html = ''
    let list = null
    let table = null
    const close = () => { if (list) { html += '</' + list + '>'; list = null } if (table) { html += '</tbody></table>'; table = null } }
    lines.forEach(raw => {
      const line = raw.trim()
      if (!line) { close(); return }
      if (line.startsWith('## ')) { close(); html += '<h4>' + inline(line.slice(3)) + '</h4>'; return }
      if (/^\d+\.\s/.test(line)) {
        if (table) close()
        if (list !== 'ol') { if (list) html += '</ul>'; html += '<ol>'; list = 'ol' }
        html += '<li>' + inline(line.replace(/^\d+\.\s/, '')) + '</li>'; return
      }
      if (/^-\s/.test(line)) {
        if (table) close()
        if (list !== 'ul') { if (list) html += '</ol>'; html += '<ul>'; list = 'ul' }
        html += '<li>' + inline(line.slice(2)) + '</li>'; return
      }
      if (/^\|/.test(line)) {
        const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
        if (cells.every(cell => /^-+$/.test(cell))) return
        if (!table) { close(); html += '<table><thead>'; table = 'head' }
        if (table === 'head') { html += '<tr>' + cells.map(cell => '<th>' + inline(cell) + '</th>').join('') + '</tr></thead><tbody>'; table = 'body' }
        else html += '<tr>' + cells.map(cell => '<td>' + inline(cell) + '</td>').join('') + '</tr>'
        return
      }
      close(); html += '<p>' + inline(line) + '</p>'
    })
    close()
    return html
  }

  function message(item) {
    if (item.role === 'user') return '<div class="msg user">' + esc(item.text) + '</div>'
    const sources = (item.src || []).map(id => {
      const cite = CITES[id] || SOURCES[id]
      const label = CITES[id] ? 'Tool-Augmented Language Agents · 第 ' + cite.page + ' 页' : cite.title + ' · 第 ' + cite.page + ' 页'
      return '<button type="button" data-action="cite" data-c="' + id + '"><b>[' + cite.n + ']</b><span>' + esc(label) + '</span></button>'
    }).join('')
    return '<div class="msg ai">' + md(item.text) + (sources ? '<div class="src">' + sources + '</div>' : '') + '</div>'
  }
  const typing = () => '<div class="msg ai"><span class="typing"><i></i><i></i><i></i></span></div>'

  function composer(kind) {
    const labels = { reader: ['当前论文', '就当前论文提问，回答会标注页码'], chat: ['全库 · 9 篇', '与全库文献对话；会话自动保存'], work: ['技能 · 权限 · 模型 · 深度', '给 Work 一个目标，先出计划再执行'] }
    const meta = labels[kind]
    return '<div class="composer">' + (kind === 'chat' ? '<div class="quick"><span>快捷</span>' + QUICK.map(item => '<button type="button" data-action="quick" data-text="' + esc(item.text) + '">' + item.label + '</button>').join('') + '</div>' : '') +
      '<textarea rows="2" data-composer="' + kind + '" placeholder="' + meta[1] + '">' + esc(state.drafts[kind] || '') + '</textarea>' +
      '<div class="composer-foot"><span class="pill">' + icon('book', 12) + ' ' + meta[0] + '</span><span class="pill">demo-model</span><span class="pill">思考 · 高</span>' + (kind === 'work' ? '<span class="pill">执行前确认</span>' : '') + '<button type="button" class="send" data-action="send" data-kind="' + kind + '"' + (state.drafts[kind] && state.drafts[kind].trim() ? '' : ' disabled') + '>发送</button></div></div>'
  }

  /* ---------- 外壳 ---------- */
  const NAV = [['hub', '研究台', '研究台', 'home'], ['reader', '阅读', '继续阅读', 'book']]
  const NAV_MORE = [['chat', '文献问答', '与文献库对话', 'chat'], ['overview', '纵览', '纵览（文献表格 / 知识体系 / 统计）', 'table'], ['notes', '笔记', '笔记中心', 'notes'], ['compare', '对比', 'AI 对比表格', 'compare']]
  function nav(view) {
    const item = (id, label, title, iconName) => '<button class="' + (view === id ? 'on' : '') + '" title="' + title + '" aria-current="' + (view === id ? 'page' : 'false') + '" data-action="' + (id === 'overview' ? 'toast' : 'go') + '"' + (id === 'overview' ? ' data-text="桌面版提供文献总表、知识网络与统计仪表盘"' : ' data-view="' + id + '"') + '>' + icon(iconName) + '<span>' + label + '</span></button>'
    return '<nav class="wnav" aria-label="文献工作区">' + NAV.map(entry => item(entry[0], entry[1], entry[2], entry[3])).join('') + '<i class="sep"></i>' + NAV_MORE.map(entry => item(entry[0], entry[1], entry[2], entry[3])).join('') + '</nav>'
  }
  function shell(view, isWork) {
    return '<div class="tb"><div class="top-switch">' +
      '<button class="' + (isWork ? 'on' : '') + '" data-action="mode" data-mode="work" title="科研工作台：给目标，agent 执行">' + icon('zap', 13) + ' Work</button>' +
      '<button class="' + (isWork ? '' : 'on') + '" data-action="mode" data-mode="paper" title="文献库：阅读 / 对话 / 纵览 / 笔记">' + icon('library', 13) + ' Paper</button></div>' +
      '<div class="tb-brand"><img src="' + BRAND + '" alt="">CSPAPER</div>' +
      '<div class="tb-right"><button class="icon-btn" title="设置" data-action="toast" data-text="桌面版可在这里配置模型、服务商与阅读提醒">' + icon('gear') + '</button></div></div>' +
      (isWork ? '' : nav(view)) +
      '<div class="main">' + views[view]() + '</div>' +
      '<div class="status"><span class="chip">' + icon('library', 12) + ' 9 篇 · 3 类</span><span class="chip">' + icon('zap', 12) + ' ' + (isWork ? 'demo-model · 计划 4 步 · 已完成' : '已索引 9/9 · 45 个检索块') + '</span><span class="grow"></span><span class="chip"><i class="dot ok"></i> 服务就绪</span><span class="chip">' + icon('gear', 12) + ' demo-model</span></div>'
  }

  /* ---------- 研究台 ---------- */
  const link = (label, view, extra) => '<button type="button" data-action="go" data-view="' + view + '"' + (extra || '') + '>' + label + '</button>'
  const card = (title, sub, action, body) => '<section class="rh-card" aria-label="' + title + '"><header><div><h2>' + title + '</h2><small>' + sub + '</small></div>' + (action || '') + '</header>' + body + '</section>'
  function viewHub() {
    const date = today.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    const hour = today.getHours()
    const greeting = hour < 6 ? '晚上好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
    const reading = PAPERS.filter(paper => paper.pdf && paper.opened && paper.status !== 'read').slice(0, 4)
    const queue = PAPERS.filter(paper => paper.pdf && ['todo', 'unread', 'reading'].includes(paper.status))
    const due = TASKS.filter(task => task.dueIn <= 0 && task.status !== 'done').sort((a, b) => a.dueIn - b.dueIn)
    const overdue = due.filter(isOverdue).length
    const projects = PROJECTS.filter(project => project.status === '进行中').length
    const paperRow = paper => '<article class="rh-paper"><button class="rh-paper-title" data-action="open" data-id="' + paper.id + '">' + esc(paper.title) + '</button><button class="rh-btn rh-paper-action" data-action="open" data-id="' + paper.id + '">继续</button><div class="rh-paper-meta"><span>' + (paper.page > 1 ? '读到第 ' + paper.page + ' 页' : '未开始') + '</span><span>' + STATUS[paper.status].label + '</span><span>' + paper.cat.slice(3) + '</span><span>' + paper.opened + '</span></div><div class="rh-bar"><i style="width:' + Math.round(paper.page / paper.pages * 100) + '%"></i></div></article>'
    const queueRow = paper => {
      const meta = STATUS[paper.status]
      return '<div class="rh-queue-row"><span class="rh-queue-dot" style="background:' + meta.color + '"></span><button class="rh-queue-title" title="' + esc(paper.title) + '" data-action="open" data-id="' + paper.id + '">' + esc(paper.title) + '</button><span class="rh-status" style="color:' + meta.color + ';background:' + meta.bg + '">' + meta.label + '</span>' +
        (paper.status !== 'reading' ? '<button class="rh-mini" data-action="start" data-id="' + paper.id + '">开始阅读</button>' : '') +
        '<button class="rh-mini" data-action="read" data-id="' + paper.id + '">已读</button>' +
        (paper.status !== 'todo' ? '<button class="rh-mini" data-action="later" data-id="' + paper.id + '">稍后读</button>' : '') + '</div>'
    }
    return '<div class="research-hub"><div class="rh-scroll"><div class="rh-inner">' +
      '<header class="rh-hero"><div><small class="rh-eyebrow">' + date + ' · 研究台</small><h1>' + greeting + '，今天推进哪项研究？</h1><p>从上次停下的位置继续读，或先记下一条想法。阅读、日程、任务与会话都来自当前工作区。</p></div>' +
      '<div class="rh-actions"><button class="rh-primary" data-action="capture" title="Ctrl / Cmd + Shift + N">' + icon('notes', 14) + ' 快速记录</button><button class="rh-btn" data-action="toast" data-text="桌面版支持拖入 PDF、Zotero 迁移与在线添加">' + icon('upload', 14) + ' 导入文献</button><button class="rh-btn" data-action="go" data-view="chat">' + icon('chat', 14) + ' 问文献库</button></div></header>' +
      '<section class="rh-metrics" aria-label="今日概览">' +
      '<div><small>继续阅读</small><strong>' + reading.length + '<em>篇</em></strong><span>最近打开的 PDF</span></div>' +
      '<div><small>今日专注</small><strong>43<em>分钟</em></strong><span>2 个阅读轮次</span></div>' +
      '<div><small>阅读队列</small><strong>' + queue.length + '<em>篇</em></strong><span>待读 / 稍后读 / 在读</span></div>' +
      '<div class="' + (overdue ? 'warn' : '') + '"><small>今日到期</small><strong>' + due.length + '<em>项</em></strong><span>' + (overdue ? overdue + ' 项已逾期' : projects + ' 个研究项目') + '</span></div></section>' +
      '<div class="rh-layout"><div class="rh-main">' +
      card('继续阅读', '从上次停下的位置接着读', link('全部文献', 'reader'), reading.length ? reading.map(paperRow).join('') : '<div class="rh-empty"><b>没有进行中的阅读</b><span>打开一篇 PDF 后，它会出现在这里。</span></div>') +
      card('阅读队列', '待读、稍后读与在读的文献', link('文献库', 'reader'), queue.length ? queue.map(queueRow).join('') : '<div class="rh-empty"><b>阅读队列是空的</b><span>把文献标记为「稍后读」或「待读」。</span></div>') +
      '</div><aside class="rh-side">' +
      card('今日安排', '日程与截止', link('Work 日历', 'work'), EVENTS.map(event => '<div class="rh-row"><small>' + event.time + ' · ' + KIND[event.kind] + '</small><strong>' + event.title + '</strong></div>').join('')) +
      card('今日任务', '今天到期与逾期', link('项目', 'projects'), due.length ? due.map(task => '<button class="rh-row' + (isOverdue(task) ? ' overdue' : '') + '" data-action="task" data-id="' + task.id + '"><small>' + projectName(task.projectId) + ' · ' + PRIORITY[task.priority] + '优先级' + (isOverdue(task) ? ' · 已逾期' : '') + '</small><strong>' + esc(task.title) + '</strong></button>').join('') : '<div class="rh-empty"><b>今天没有到期任务</b><span>在 Work 的项目页创建任务并设置截止日期。</span></div>') +
      card('最近笔记', '独立笔记', link('全部笔记', 'notes'), NOTES.filter(note => note.kind === 'note').slice(0, 3).map(note => '<button class="rh-row" data-action="note" data-id="' + note.id + '"><small>' + note.when + '</small><strong>' + esc(note.title) + '</strong></button>').join('')) +
      card('最近会话', '继续之前的追问', link('新对话', 'chat'), CONVS.slice(0, 3).map(conv => '<button class="rh-row" data-action="conv" data-id="' + conv.id + '"><small>文献问答 · ' + conv.when + '</small><strong>' + esc(conv.title) + '</strong></button>').join('')) +
      '</aside></div></div></div>' +
      '<footer class="rh-foot"><span>' + icon('library', 12) + ' 9 篇文献 · 8 PDF</span><span>已索引 9/9</span><span>45 个检索块</span><span class="grow"></span><button class="rh-mini" data-action="go" data-view="compare">' + icon('compare', 12) + ' 新建对比表</button><button class="rh-mini" data-action="go" data-view="notes">' + icon('notes', 12) + ' 笔记中心</button></footer></div>'
  }
  const projectName = id => { const project = PROJECTS.find(item => item.id === id); return project ? project.name.split('：')[0] : '' }

  /* ---------- 阅读器 ---------- */
  function renderPage(index) {
    const sentence = id => '<span class="s' + (state.highlights.some(item => item.s === id) ? ' hl-y' : '') + '" data-s="' + id + '">' + esc(SENT[id][0]) + '</span>'
    const table = spec => '<table><caption>' + spec.caption + '</caption><thead><tr>' + spec.head.map(cell => '<th>' + cell + '</th>').join('') + '</tr></thead><tbody>' + spec.rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
    const figure = '<div class="fig"><i>Goal</i><i>Plan</i><i>Tool call</i><i>Log</i><i>Verify</i><i>Artefact</i></div>'
    let html = ''
    if (index === 0) {
      html += '<h1>' + esc(PAPER_TITLE) + '</h1><div class="authors">A. Moreno, J. Whitfield, L. Okafor</div><div class="affil">Institute for Computational Reasoning · Sample Institution</div>' +
        '<p class="abstract"><strong>Abstract</strong>—' + ['s01', 's02', 's03'].map(sentence).join(' ') + '</p><div class="keywords"><strong>Keywords:</strong> tool use; benchmark</div><div class="cols">'
    } else html += '<div class="cols">'
    PAGES[index].blocks.forEach(block => {
      html += '<h2>' + block.h + '</h2>'
      block.ps.forEach((ids, position) => {
        html += '<p' + (position ? ' class="cont"' : '') + '>' + ids.map(sentence).join(' ') + '</p>'
        ids.filter(id => state.translated.has(id)).forEach(id => { html += '<div class="tr" data-for="' + id + '">' + esc(SENT[id][1]) + '</div>' })
      })
      if (block.fig) html += figure
      if (block.table) html += table(block.table)
    })
    return html + '</div>' + (index === 1 ? '<h2>References</h2>' + ['L. Ferreira, D. Osei, and Y. Chen. A benchmark for tool-use robustness across domain shifts. Preprint, 2025.', 'V. Sorensen, O. Mensah, and J. Park. Memory of prior tool calls: auditing agent trajectories. Preprint, 2025.', 'R. Castellanos, M. Ishida, and P. Lindqvist. Citation faithfulness in knowledge-grounded generation. Preprint, 2025.'].map(ref => '<p class="cont" style="font-size:9.5px">' + esc(ref) + '</p>').join('') : '')
  }
  function focusPanel() {
    const minutes = Math.floor(state.focusSeconds / 60)
    const seconds = String(state.focusSeconds % 60).padStart(2, '0')
    return '<div class="focus" role="dialog" aria-label="读文献专注与提醒"><small>' + (state.focusRunning ? '阅读专注进行中' : '读文献专注') + '</small><div class="timer' + (state.focusRunning ? ' run' : '') + '" id="focusTimer">' + minutes + ':' + seconds + '</div><small>短休 5 分钟 · 长休 15 分钟</small>' +
      '<div class="focus-row"><button class="rh-btn" data-action="focus-start">' + (state.focusRunning ? '暂停' : '开始专注') + '</button><button class="rh-btn" data-action="focus-reset">重置</button></div>' +
      '<div class="focus-rem"><button class="' + (state.waterDone ? 'done' : '') + '" data-action="water">' + (state.waterDone ? '已喝水' : '喝水提醒 · 30 分') + '</button><button class="' + (state.moveDone ? 'done' : '') + '" data-action="move">' + (state.moveDone ? '已活动' : '活动提醒 · 45 分') + '</button></div></div>'
  }
  function viewReader() {
    const paper = PAPERS.find(item => item.id === state.paperId) || PAPERS[0]
    const side = state.readerTab === 'chat'
      ? '<div class="msgs">' + state.readerMsgs.map(message).join('') + (state.readerTyping ? typing() : '') + '</div>' + composer('reader')
      : '<div class="hl-list">' + (state.highlights.length ? state.highlights.map(item => '<div class="hl-item"><span>' + esc(SENT[item.s][0]) + '</span><small>第 ' + item.page + ' 页 · 高亮 · ' + item.color + '</small></div>').join('') : '<div class="rh-empty"><b>还没有标注</b><span>在正文中选中一段文字，再用划词工具栏高亮。</span></div>') + '</div>'
    return '<div class="reader"><aside class="lib"><button class="lib-add" data-action="toast" data-text="桌面版支持拖入 PDF、Zotero 迁移与在线添加">' + icon('plus', 14) + ' 添加 PDF</button><label class="lib-search">' + icon('search', 14) + '<input placeholder="按标题 / 正文 / 笔记…" aria-label="搜索文献"><kbd>⌘K</kbd></label><div class="lib-group">最近打开 / 全部文献 · 9</div><div class="lib-list">' +
      PAPERS.map(item => '<button class="paper-item' + (item.id === paper.id ? ' on' : '') + '" data-action="open" data-id="' + item.id + '"><span><span class="badge">' + (item.pdf ? 'PDF' : '题录') + '</span>' + esc(shortTitle(item.title)) + '</span><small>' + item.year + ' · ' + STATUS[item.status].label + ' · ' + item.cat.slice(3) + '</small></button>').join('') + '</div></aside>' +
      '<section class="doc"><div class="doc-bar"><span class="doc-tab">' + icon('pdf', 13) + ' ' + esc(shortTitle(paper.title)) + '</span><div class="doc-tools"><button class="focus-toggle' + (state.focusOpen ? ' on' : '') + '" data-action="focus" title="读文献专注与提醒">' + icon('clock', 13) + ' 阅读专注</button><span class="zoom"><button data-action="toast" data-text="缩小">−</button><span>120%</span><button data-action="toast" data-text="放大">+</button></span><span class="pages"><button data-action="page" data-page="' + (state.page - 1) + '"' + (state.page <= 1 ? ' disabled' : '') + '>‹</button><span>' + state.page + ' / ' + paper.pages + '</span><button data-action="page" data-page="' + (state.page + 1) + '"' + (state.page >= paper.pages ? ' disabled' : '') + '>›</button></span></div></div>' +
      (state.focusOpen ? focusPanel() : '') +
      '<div class="doc-scroll" id="docScroll"><article class="page" data-running="Preprint · Under review — November 2025">' + renderPage(state.page - 1) + '</article></div></section>' +
      '<aside class="side"><div class="side-tabs"><button class="' + (state.readerTab === 'chat' ? 'on' : '') + '" data-action="side-tab" data-tab="chat">问答</button><button class="' + (state.readerTab === 'hl' ? 'on' : '') + '" data-action="side-tab" data-tab="hl">划词标注</button><span style="flex:1"></span><button data-action="toast" data-text="桌面版还提供全文翻译、参考文献与文献详情">翻译</button></div>' + side + '</aside></div>'
  }

  /* ---------- 问答 ---------- */
  function viewChat() {
    const conv = CONVS.find(item => item.id === state.chatId) || CONVS[0]
    return '<div class="chat"><aside class="conv"><button class="conv-new" data-action="new-chat">' + icon('plus', 14) + ' 新对话</button><div class="conv-list">' + CONVS.map(item => '<button class="conv-item' + (item.id === conv.id ? ' on' : '') + '" data-action="conv" data-id="' + item.id + '"><span>' + esc(item.title) + '</span><small>' + item.when + '</small></button>').join('') + '</div></aside>' +
      '<section class="chat-main"><div class="chat-scroll"><div class="chat-inner"><div class="chat-title">' + esc(conv.title) + '<small>来源可回跳原文 · 会话持久保存</small></div>' + conv.msgs.map(message).join('') + (state.chatTyping ? typing() : '') + '</div></div><div class="chat-composer-wrap">' + composer('chat') + '</div></section></div>'
  }

  /* ---------- Work ---------- */
  function viewWork() {
    const navItem = (iconName, label, action, extra) => '<button data-action="' + action + '"' + (extra || '') + '>' + icon(iconName) + ' ' + label + '</button>'
    return '<div class="wb"><aside class="wb-side"><div class="wb-brand"><img src="' + BRAND + '" alt="">CSPAPER</div><nav class="wb-nav">' +
      navItem('plus', '新建任务 <span class="hint">Ctrl+N</span>', 'toast', ' data-text="桌面版：新建任务后在下方输入目标，先出计划再执行"') +
      navItem('search', '搜索', 'toast', ' data-text="桌面版支持搜索全部任务"') +
      navItem('calendar', '今日', 'go', ' data-view="projects"') +
      navItem('folder', '项目', 'go', ' data-view="projects"') +
      navItem('clock', '自动化', 'toast', ' data-text="定时任务与每日文献日报"') +
      navItem('target', '技能', 'toast', ' data-text="精读笔记、主题调研、多文对比等内置技能"') +
      navItem('calendar', '科研日历', 'toast', ' data-text="月 / 周 / 日 / 议程与重复日程"') +
      navItem('grid', '插件市场', 'toast', ' data-text="MCP 服务器"') + '</nav>' +
      '<div class="wb-group">最近任务</div><div class="wb-hist"><button class="on">' + esc(shortTitle(WORK.goal)) + '</button><button>生成综述提纲</button><button>对比三种恢复策略</button><button>每日文献日报</button></div>' +
      '<div class="wb-user"><i>研</i>本地研究者</div></aside>' +
      '<section class="wb-center"><header class="wb-head"><div class="wb-title">' + esc(WORK.goal) + '</div><div class="wb-actions"><button data-action="toast" data-text="已复制最终报告">复制结果</button><button data-action="toast" data-text="桌面版可导出为 Markdown">导出 Markdown</button></div></header>' +
      '<div class="wb-scroll"><div class="wb-inner"><div class="msg user">' + esc(WORK.goal) + '</div><details class="run" open><summary>已工作 1 分 12 秒 · 计划 4 步 · 全部完成</summary>' +
      WORK.steps.map((step, index) => '<div class="step"><span class="n">' + String(index + 1).padStart(2, '0') + '</span><span class="tool">' + step.tool + '</span><span>' + esc(step.args) + '</span><span class="ok">' + (step.ok ? '✓ ' : '') + step.note + '</span></div>').join('') + '</details>' +
      '<div class="msg ai">' + md(REPORT) + '</div></div></div>' + composer('work') + '</section></div>'
  }

  /* ---------- 项目与任务 ---------- */
  function viewProjects() {
    const project = PROJECTS.find(item => item.id === state.projectId) || PROJECTS[0]
    const tasks = TASKS.filter(task => task.projectId === project.id)
    const columns = { todo: '待办', doing: '进行中', done: '已完成' }
    const taskCard = task => {
      const overdue = isOverdue(task)
      return '<article class="task-card' + (task.status === 'done' ? ' done' : '') + '" draggable="true" data-task="' + task.id + '"><button type="button" class="task-check" data-action="toggle" data-id="' + task.id + '" aria-label="完成任务：' + esc(task.title) + '">' + (task.status === 'done' ? icon('check', 12) : '') + '</button>' +
        '<div class="task-main"><strong>' + esc(task.title) + '</strong>' + (task.notes ? '<p>' + esc(task.notes) + '</p>' : '') + '<div class="task-meta"><span class="task-priority ' + task.priority + '">' + PRIORITY[task.priority] + '</span>' + (task.dueIn !== null ? '<span class="' + (overdue ? 'overdue' : '') + '">' + (overdue ? '已逾期 · ' : '') + '截止 ' + dueLabel(task.dueIn) + '</span>' : '') + (task.paper ? '<button type="button" data-action="open" data-id="' + task.paper + '">' + icon('pdf', 12) + ' 打开文献</button>' : '') + '</div></div>' +
        '<div class="task-actions"><button type="button" title="交给 Work 起草任务" data-action="handoff" data-id="' + task.id + '">' + icon('zap', 13) + '</button><button type="button" title="删除任务" data-action="remove-task" data-id="' + task.id + '">' + icon('x', 13) + '</button></div></article>'
    }
    const done = tasks.filter(task => task.status === 'done').length
    const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0
    return '<div class="projects-pane"><header class="projects-head"><div><small>Work · Projects</small><h1>项目与任务</h1><p>把阅读、对话和成果组织成可推进的研究项目。</p></div><div class="projects-actions"><button class="rh-btn" data-action="toast" data-text="桌面版可新建项目并设置颜色、状态与截止日期">' + icon('plus', 14) + ' 新建项目</button><button class="rh-primary" data-action="add" data-status="todo">' + icon('plus', 14) + ' 新建任务</button></div></header>' +
      '<div class="projects-layout"><aside class="projects-list" aria-label="项目列表">' + PROJECTS.map(item => {
        const open = TASKS.filter(task => task.projectId === item.id && task.status !== 'done').length
        return '<button class="project-row' + (item.id === project.id ? ' on' : '') + '" data-action="project" data-id="' + item.id + '"><i class="project-color" style="background:' + item.color + '"></i><span class="project-row-main"><strong>' + esc(item.name) + '</strong><small>' + item.status + ' · ' + open + ' 个未完成</small></span>' + (item.dueIn !== null ? '<span class="project-due' + (item.dueIn < 0 ? ' overdue' : '') + '">' + dateLabel(item.dueIn) + '</span>' : '') + '</button>'
      }).join('') + '</aside>' +
      '<section class="project-board" aria-label="任务看板"><header class="project-board-head"><div class="project-board-title"><small><span class="project-state">' + project.status + '</span>' + (project.dueIn !== null ? '<span>截止 ' + dateLabel(project.dueIn) + '</span>' : '') + '</small><h2>' + esc(project.name) + '</h2><p>' + esc(project.desc) + '</p></div><div class="project-progress"><strong>' + done + '<em>/' + tasks.length + '</em></strong><div class="rh-bar"><i style="width:' + percent + '%"></i></div><small>' + (tasks.length ? percent + '% 已完成' : '还没有任务') + '</small></div></header>' +
      '<div class="task-columns">' + Object.keys(columns).map(status => '<section class="task-column" data-status="' + status + '" aria-label="' + columns[status] + '任务"><header><h3>' + columns[status] + '</h3><span>' + tasks.filter(task => task.status === status).length + '</span><button type="button" title="在此列新建任务" data-action="add" data-status="' + status + '">' + icon('plus', 13) + '</button></header>' +
        (state.adding === status ? '<div class="task-add"><input data-add="' + status + '" placeholder="任务标题，回车添加" autofocus><button class="rh-mini" data-action="cancel-add">取消</button></div>' : '') +
        tasks.filter(task => task.status === status).map(taskCard).join('') +
        (tasks.some(task => task.status === status) ? '' : '<div class="task-empty">拖动任务到这里，或点「新建任务」</div>') + '</section>').join('') + '</div></section></div></div>'
  }

  /* ---------- 对比表 ---------- */
  function viewCompare() {
    return '<div class="cmp"><div class="cmp-bar"><h1>轨迹审计三篇核心文献 · 对比表</h1>' + COMPARE.rows.map(dim => '<label><input type="checkbox" data-dim="' + dim + '"' + (state.dims[dim] ? ' checked' : '') + '> ' + dim + '</label>').join('') + '<button class="rh-mini" data-action="toast" data-text="桌面版可导出 Markdown / CSV">导出</button></div>' +
      '<div class="cmp-scroll"><table class="cmp-table"><thead><tr><th>维度</th>' + COMPARE.papers.map(paper => '<th>' + esc(paper.short) + '<small>' + esc(paper.meta) + '</small></th>').join('') + '</tr></thead><tbody>' +
      COMPARE.rows.map((dim, row) => '<tr class="' + (state.dims[dim] ? '' : 'off') + '" data-row="' + dim + '"><td>' + dim + '</td>' + COMPARE.papers.map(paper => '<td>' + paper.cells[row].map(item => '<li>' + esc(item.t) + '<button type="button" class="pg" data-action="cite-src" data-title="' + esc(paper.short) + '" data-page="' + item.p + '">第 ' + item.p + ' 页</button></li>').join('') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>'
  }

  /* ---------- 笔记 ---------- */
  function viewNotes() {
    const note = NOTES.find(item => item.id === state.noteId) || NOTES[0]
    return '<div class="notes"><aside class="notes-side"><header><b>笔记中心</b><button class="rh-mini" data-action="capture">' + icon('plus', 12) + ' 独立笔记</button></header><div class="notes-list">' + NOTES.map(item => '<button class="note-item' + (item.id === note.id ? ' on' : '') + '" data-action="note" data-id="' + item.id + '"><b>' + esc(item.title) + '</b><small>' + (item.kind === 'paper' ? '文献笔记' : '独立笔记') + ' · ' + item.when + '</small></button>').join('') + '</div></aside>' +
      '<section class="note-view"><article><h1>' + esc(note.title) + '</h1><div class="meta">' + (note.kind === 'paper' ? '文献笔记 · 自动保存' : '独立笔记') + ' · ' + note.when + '</div>' + md(note.body) + '</article></section></div>'
  }

  /* ---------- 快速记录 ---------- */
  function captureModal() {
    return '<div class="mask" data-action="mask"><div class="modal" role="dialog" aria-modal="true" aria-label="快速记录"><div class="modal-head"><h2>快速记录</h2><button type="button" class="modal-x" data-action="close-capture" aria-label="关闭">' + icon('x', 14) + '</button></div>' +
      '<form class="quick-capture-fields" data-form="capture"><input class="quick-capture-title" name="title" placeholder="标题（可选，默认取第一行）" maxlength="160"><textarea class="quick-capture-text" name="body" rows="8" placeholder="写下想法、问题、实验观察或下一步…" maxlength="20000"></textarea><div class="quick-capture-hint"><span>保存为独立笔记，可在笔记中心继续编辑。</span><span class="grow"></span></div>' +
      '<div class="modal-actions"><span class="grow"></span><button type="button" class="btn ghost" data-action="close-capture">取消</button><button type="submit" class="btn">保存记录</button></div></form></div></div>'
  }

  const views = { hub: viewHub, reader: viewReader, chat: viewChat, work: viewWork, projects: viewProjects, compare: viewCompare, notes: viewNotes }

  /* ---------- 渲染与路由 ---------- */
  function currentView() {
    const hash = location.hash.replace('#', '').split('?')[0]
    return VIEWS.includes(hash) ? hash : 'hub'
  }
  function render() {
    closeFloatbar()
    const view = currentView()
    const scroll = state.docScroll
    $$('.demo-tabs button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.view === view)))
    $('#app').innerHTML = shell(view, view === 'work' || view === 'projects') + (state.captureOpen ? captureModal() : '')
    if (state.captureOpen) { const field = $('form[data-form="capture"] textarea'); if (field) field.focus(); return }
    $$('.msgs,.chat-scroll').forEach(el => { el.scrollTop = el.scrollHeight })
    const scroller = $('#docScroll')
    if (scroller) scroller.scrollTop = scroll || 0
    if (state.pendingHit || state.pendingTr) {
      const hit = state.pendingHit
      const tr = state.pendingTr
      state.pendingHit = null
      state.pendingTr = null
      setTimeout(() => {
        const target = hit ? $('.s[data-s="' + hit + '"]') : $('.tr[data-for="' + tr + '"]')
        if (!target) return
        $$('.s.hit').forEach(el => el.classList.remove('hit'))
        target.classList.add('hit')
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 80)
    }
  }
  function go(view) { if (currentView() === view) render(); else location.hash = view }
  function toast(text) {
    const old = $('#toast'); if (old) old.remove()
    const el = document.createElement('div')
    el.className = 'toast'; el.id = 'toast'; el.textContent = text
    $('#app').appendChild(el)
    clearTimeout(state.toastTimer)
    state.toastTimer = setTimeout(() => { if (el.parentNode) el.remove() }, 2400)
  }
  function rememberScroll() { const scroller = $('#docScroll'); state.docScroll = scroller ? scroller.scrollTop : 0 }

  /* ---------- 划词工具栏 ---------- */
  function closeFloatbar() { const bar = $('#floatbar'); if (bar) bar.remove() }
  function sentencesInRange(range) {
    if (!range) return []
    return $$('.page .s').filter(el => range.intersectsNode(el)).map(el => el.dataset.s)
  }
  function showFloatbar() {
    closeFloatbar()
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    const page = $('.page')
    if (!page || !page.contains(range.commonAncestorContainer)) return
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    state.range = range.cloneRange()
    const bar = document.createElement('div')
    bar.className = 'floatbar'; bar.id = 'floatbar'
    bar.innerHTML = '<button class="dotb" style="background:#ffe34d" data-action="hl" data-color="yellow" title="高亮 · 重要"></button><button class="dotb" style="background:#8fd08f" data-action="hl" data-color="green" title="高亮 · 结论"></button><button class="dotb" style="background:#9dbef0" data-action="hl" data-color="blue" title="高亮 · 方法"></button><button type="button" data-action="translate">' + icon('globe', 13) + ' 翻译</button><button type="button" data-action="explain">解释</button>'
    bar.style.left = rect.left + rect.width / 2 + 'px'
    bar.style.top = rect.top + 'px'
    document.body.appendChild(bar)
  }

  /* ---------- 预设回复（演示模型） ---------- */
  let citeCount = 8
  function registerCite(sentence, page) {
    const key = 'x' + sentence
    if (!CITES[key]) CITES[key] = { n: ++citeCount, s: sentence, page }
    return key
  }
  function answerFor(text, kind) {
    if (kind === 'reader') {
      if (/局限|不足|缺点|复现/.test(text)) return { role: 'ai', text: '论文在 **Threats to Reproduction** 里承认了三点局限：\n\n1. 模型服务商会不经通知地改变采样行为，所以采样种子与模型快照会被一并记录。[[c6]]\n2. 工具延迟会影响带超时的智能体，重放时使用日志里的时间戳。\n3. 最终制品的标注者对评分标准的理解可能不同，因此每个分数都附带标注者两两一致性。[[c7]]', src: ['c6', 'c7'] }
      if (/多少|几个|任务|规模|数据/.test(text)) return { role: 'ai', text: '任务集共有 **420 个任务**，按所需工具调用次数分组；每个任务在固定随机种子下得到确定性的观察结果。[[c8]]', src: ['c8'] }
      if (/为什么|如何|怎么|机制/.test(text)) return { role: 'ai', text: '关键在于**恢复行为**：先验证观察是否仍然有效、再决定是否复用的智能体，能从 78% 的注入错误中恢复；直接沿用过期状态的智能体只有 29%。所以恢复行为比工具选择更能区分强弱。[[c2]]', src: ['c2'] }
      return { role: 'ai', text: '根据论文正文，统一协议控制环境噪声后，智能体之间的差距明显收窄；而复用过期观察会让多步任务的失败率翻倍。[[c3]] 你可以点开引用角标回到对应的句子。', src: ['c3'] }
    }
    if (/对比|比较|异同|表格/.test(text)) return { role: 'ai', text: '| 维度 | 轨迹审计 | 句级忠实度 | 自校验 |\n| --- | --- | --- | --- |\n| 解决的问题 | 失败不可复现 | 引用不支持结论 | 生成后仍有错误引用 |\n| 主要手段 | 只追加的调用日志 | 标注最小支持片段 | 定稿前重读被引段落 |\n| 关键数字 | 94% 的失败可精确重放 | 忠实度 61%–88% | 无支持引用 18.4% → 6.9% |\n\n三者可以叠加使用：审计保证可追溯，忠实度度量证据质量，自校验在生成后兜底。[[d1]] [[d2]] [[d3]]', src: ['d1', 'd2', 'd3'] }
    if (/提纲|大纲|综述|结构/.test(text)) return { role: 'ai', text: '## 综述提纲：工具调用智能体的可靠性评估\n\n1. **研究背景**：语言智能体从“会选工具”走向“可审计地完成多步任务”。[[d4]]\n2. **评测协议**：统一工具 schema 与制品级成功判定，控制环境噪声。[[d1]]\n3. **证据质量**：句级引用忠实度，把“引用存在”变成“引用支持结论”。[[d2]]\n4. **生成后校验**：自校验降低无支持引用的代价与收益。[[d3]]\n5. **研究空白**：跨领域迁移、人工审批界面与长轨迹的重放开销。', src: ['d1', 'd2', 'd3', 'd4'] }
    if (/局限|不足|问题|未解决/.test(text)) return { role: 'ai', text: '这些工作还留下三个未解决的问题：\n\n1. 轨迹日志只保证可复现，并不保证结论正确，仍需要核对证据。[[d1]]\n2. 句级忠实度的标注成本较高，多跳断言的忠实度只有 58%。[[d2]]\n3. 自校验把推理成本提高了 14%，成本是否随摘要长度线性增长仍需验证。[[d3]]', src: ['d1', 'd2', 'd3'] }
    if (/证据|支持|反对|数据/.test(text)) return { role: 'ai', text: '**支持的证据**\n\n- 统一协议后，最强与最弱智能体的差距从 52 收窄到 14 个百分点。[[d1]]\n- 重放 600 条轨迹可精确复现 94% 的已报告失败。[[d4]]\n\n**需要谨慎的地方**\n\n- 两跳断言的忠实度降到 58%，说明证据越复杂越容易出错。[[d2]]\n- 自校验的效果依赖模型重读段落的能力，推理成本增加 14%。[[d3]]', src: ['d1', 'd2', 'd3', 'd4'] }
    return { role: 'ai', text: RAG_ANSWER, src: ['d1', 'd2', 'd3'] }
  }
  function send(kind) {
    const text = (state.drafts[kind] || '').trim()
    if (!text) return
    state.drafts[kind] = ''
    if (kind === 'work') { toast('演示版使用预设任务；桌面版会为你的目标生成计划并执行'); render(); return }
    if (kind === 'reader') {
      state.readerMsgs.push({ role: 'user', text }); state.readerTyping = true; state.readerTab = 'chat'; render()
      setTimeout(() => { state.readerTyping = false; state.readerMsgs.push(answerFor(text, 'reader')); render() }, 900)
      return
    }
    const conv = CONVS.find(item => item.id === state.chatId)
    conv.msgs.push({ role: 'user', text }); state.chatTyping = true; render()
    setTimeout(() => { state.chatTyping = false; conv.msgs.push(answerFor(text, 'chat')); render() }, 900)
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]')
    if (!target) return
    const action = target.dataset.action
    const id = target.dataset.id
    switch (action) {
      case 'go': go(target.dataset.view); break
      case 'mode': go(target.dataset.mode === 'work' ? 'work' : 'hub'); break
      case 'toast': toast(target.dataset.text); break
      case 'mask': if (event.target === target) { state.captureOpen = false; render() } break
      case 'capture': state.captureOpen = true; render(); break
      case 'close-capture': state.captureOpen = false; render(); break
      case 'open': {
        const paper = PAPERS.find(item => item.id === id)
        state.paperId = id; state.page = 1; state.docScroll = 0
        if (paper.pdf) { if (!paper.opened) paper.opened = '刚刚'; go('reader') }
        else toast('题录条目没有 PDF 原文；桌面版可在这里探测开放获取原文')
        break
      }
      case 'start': { const paper = PAPERS.find(item => item.id === id); paper.status = 'reading'; paper.opened = '刚刚'; state.paperId = id; state.page = 1; go('reader'); break }
      case 'read': { const paper = PAPERS.find(item => item.id === id); paper.status = 'read'; render(); toast('已标记为已读'); break }
      case 'later': { const paper = PAPERS.find(item => item.id === id); paper.status = 'todo'; render(); toast('已移到稍后读'); break }
      case 'task': { const task = TASKS.find(item => String(item.id) === id); state.projectId = task.projectId; go('projects'); break }
      case 'note': state.noteId = id; go('notes'); break
      case 'conv': state.chatId = id; go('chat'); break
      case 'new-chat': state.chatId = 'c1'; state.drafts.chat = ''; go('chat'); toast('桌面版会新建一个空会话；这里展示最近的一条'); break
      case 'page': rememberScroll(); state.page = Number(target.dataset.page); state.docScroll = 0; render(); break
      case 'side-tab': state.readerTab = target.dataset.tab; render(); break
      case 'cite': {
        const cite = CITES[target.dataset.c]
        if (!cite) { const source = SOURCES[target.dataset.c]; toast(source ? '桌面版会打开《' + shortTitle(source.title) + '》第 ' + source.page + ' 页并高亮原文' : ''); break }
        state.paperId = 'p1'
        if (cite.page !== state.page) { state.page = cite.page; state.docScroll = 0 }
        state.pendingHit = cite.s
        render()
        break
      }
      case 'cite-src': toast('桌面版会打开《' + target.dataset.title + '》第 ' + target.dataset.page + ' 页并高亮原文'); break
      case 'quick': state.drafts.chat = target.dataset.text; render(); send('chat'); break
      case 'send': send(target.dataset.kind); break
      case 'hl': {
        const ids = sentencesInRange(state.range)
        ids.forEach(sentence => { if (!state.highlights.some(item => item.s === sentence)) state.highlights.push({ id: 'h' + sentence, s: sentence, page: state.page, color: target.dataset.color }) })
        rememberScroll()
        render()
        toast(ids.length ? '已高亮 ' + ids.length + ' 句并保存到划词标注' : '请选中正文中的句子')
        break
      }
      case 'translate': {
        const ids = sentencesInRange(state.range)
        if (!ids.length) { toast('请选中正文中的句子'); break }
        state.translated.add(ids[0])
        rememberScroll()
        state.pendingTr = ids[0]
        render()
        break
      }
      case 'explain': {
        const ids = sentencesInRange(state.range)
        if (!ids.length) { toast('请选中正文中的句子'); break }
        const sentence = ids[0]
        const key = registerCite(sentence, state.page)
        state.readerTab = 'chat'
        state.readerMsgs.push({ role: 'user', text: '解释一下这段话：\n「' + SENT[sentence][0].slice(0, 90) + '」' })
        state.readerMsgs.push({ role: 'ai', text: EXPLAINS[SECTION_OF[sentence]] + ' 原文见引用。[[' + key + ']]', src: [key] })
        rememberScroll()
        render()
        break
      }
      case 'focus': state.focusOpen = !state.focusOpen; render(); break
      case 'focus-start': state.focusRunning = !state.focusRunning; render(); break
      case 'focus-reset': state.focusRunning = false; state.focusSeconds = 25 * 60; render(); break
      case 'water': state.waterDone = !state.waterDone; render(); break
      case 'move': state.moveDone = !state.moveDone; render(); break
      case 'project': state.projectId = id; state.adding = null; render(); break
      case 'add': state.adding = target.dataset.status; render(); const input = $('[data-add]'); if (input) input.focus(); break
      case 'cancel-add': state.adding = null; render(); break
      case 'toggle': { const task = TASKS.find(item => String(item.id) === id); task.status = task.status === 'done' ? 'todo' : 'done'; render(); break }
      case 'remove-task': { const index = TASKS.findIndex(item => String(item.id) === id); if (index >= 0) TASKS.splice(index, 1); render(); toast('已删除任务'); break }
      case 'handoff': { const task = TASKS.find(item => String(item.id) === id); state.drafts.work = '请协助处理项目任务「' + task.title + '」。' + (task.notes ? ' 说明：' + task.notes : ''); go('work'); break }
      default: break
    }
  })

  document.addEventListener('input', event => {
    const area = event.target.closest('[data-composer]')
    if (area) {
      state.drafts[area.dataset.composer] = area.value
      const sendButton = area.parentElement.querySelector('.send')
      if (sendButton) sendButton.disabled = !area.value.trim()
    }
    const counter = event.target.closest('form[data-form="capture"] textarea')
    if (counter) { const hint = counter.parentElement.querySelector('.quick-capture-hint span.grow'); if (hint) hint.textContent = counter.value.length + ' / 20000' }
  })

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.captureOpen) { state.captureOpen = false; render() }
      else if (state.adding) { state.adding = null; render() }
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    const area = event.target.closest('[data-composer]')
    if (area) { event.preventDefault(); send(area.dataset.composer); return }
    const add = event.target.closest('[data-add]')
    if (add) {
      event.preventDefault()
      const title = add.value.trim()
      if (title) {
        const project = PROJECTS.find(item => item.id === state.projectId) || PROJECTS[0]
        TASKS.push({ id: state.nextTask++, projectId: project.id, title, notes: '', status: add.dataset.add, priority: 'medium', dueIn: null })
        toast('已添加任务')
      }
      state.adding = null
      render()
      return
    }
  })

  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form="capture"]')
    if (!form) return
    event.preventDefault()
    const body = form.body.value.trim()
    if (!body) return
    const title = form.title.value.trim() || body.split('\n')[0].slice(0, 80) || '快速记录'
    NOTES.unshift({ id: 'n' + state.nextNote++, title, kind: 'note', when: '刚刚', body })
    state.captureOpen = false
    state.noteId = NOTES[0].id
    render()
    toast('已保存到笔记中心')
  })

  document.addEventListener('change', event => {
    const box = event.target.closest('[data-dim]')
    if (!box) return
    state.dims[box.dataset.dim] = box.checked
    const row = $('.cmp-table tr[data-row="' + box.dataset.dim + '"]')
    if (row) row.classList.toggle('off', !box.checked)
  })

  document.addEventListener('mousedown', event => { if (!event.target.closest('#floatbar')) closeFloatbar() })
  document.addEventListener('mouseup', event => { if (event.target.closest('.page')) setTimeout(showFloatbar, 0) })

  document.addEventListener('dragstart', event => {
    const card = event.target.closest('.task-card')
    if (!card) return
    state.dragId = Number(card.dataset.task)
    card.classList.add('dragging')
    if (event.dataTransfer) { event.dataTransfer.setData('text/plain', String(state.dragId)); event.dataTransfer.effectAllowed = 'move' }
  })
  document.addEventListener('dragover', event => {
    const column = event.target.closest('.task-column')
    if (!column || state.dragId === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    $$('.task-column.droppable').forEach(el => el.classList.remove('droppable'))
    column.classList.add('droppable')
  })
  document.addEventListener('drop', event => {
    const column = event.target.closest('.task-column')
    if (!column) return
    event.preventDefault()
    const task = TASKS.find(item => item.id === state.dragId)
    if (task) task.status = column.dataset.status
    state.dragId = null
    render()
  })
  document.addEventListener('dragend', () => { state.dragId = null; $$('.droppable,.dragging').forEach(el => el.classList.remove('droppable', 'dragging')) })

  document.addEventListener('scroll', event => { if (event.target && event.target.id === 'docScroll') state.docScroll = event.target.scrollTop }, true)

  setInterval(() => {
    if (!state.focusRunning) return
    state.focusSeconds = Math.max(0, state.focusSeconds - 1)
    const timer = $('#focusTimer')
    if (timer) timer.textContent = Math.floor(state.focusSeconds / 60) + ':' + String(state.focusSeconds % 60).padStart(2, '0')
    if (state.focusSeconds === 0) { state.focusRunning = false; toast('这一轮专注结束，起来活动一下'); render() }
  }, 1000)

  $$('.demo-tabs button').forEach(button => button.addEventListener('click', () => go(button.dataset.view)))
  window.addEventListener('hashchange', render)
  render()
})()
