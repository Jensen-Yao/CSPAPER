# 生成截图用的示例论文 PDF（文本型：真实文字层，全文翻译/划词/检索可用）
# 产物: F:/tmp/cspaper-sample/papers/<分类>/<slug>/paper.pdf + <slug>.md
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

OUT = r'F:/tmp/cspaper-sample/papers'
W, H = A4  # 595 x 842

pdfmetrics.registerFont(TTFont('MSYH', r'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('SONG', r'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))

PAPERS = [
    dict(cat='卫星任务规划', slug='2025-hexagon-mesh-scheduling',
         title='基于六边形网格剖分的敏捷卫星区域目标观测调度方法',
         authors='伍临华, 郑重, 李豪, 夏海泉', venue='计算机学报', year=2025,
         abstract='针对敏捷地球观测卫星对大规模区域目标的观测任务规划问题，提出一种基于六边形网格剖分与双层优化框架的调度方法。将连续地表区域离散为六边形网格集合，构建任务收益最大化模型，并设计带滚动时间窗的启发式求解算法。仿真实验表明，该方法在多条卫星拼幅模式下显著提升区域覆盖率，求解时间较对比算法降低约 47%。'),
    dict(cat='卫星任务规划', slug='2024-unified-eos-scheduling',
         title='A unified scheduling approach for earth observation satellites with large-scale and heterogeneous tasks',
         authors='Ligang Xing, Xiaoxuan Hu, Nan Hu, Wei Xia, Haiquan Sun', venue='Expert Systems with Applications', year=2024,
         abstract='This paper studies the scheduling problem of earth observation satellites (EOSs) with large-scale and heterogeneous observation tasks. A unified integer programming model is formulated to maximize the overall observation profit under constraints of available time windows and scarce on-board resources. A two-layer heuristic framework combining task aggregation and local search is proposed. Experimental results on benchmark instances show that the proposed approach reduces average CPU time to 0.4s with an average GAP of 7.8%.'),
    dict(cat='电力电子', slug='2025-digital-twin-diagnosis',
         title='面向电力电子变换器的数字孪生故障诊断方法',
         authors='陈启明, 王雪松, 刘一鸣', venue='电工技术学报', year=2025,
         abstract='针对电力电子变换器功率器件开路故障难以在线定位的问题，提出一种基于数字孪生模型的故障诊断方法。构建变换器多物理场数字孪生体，通过实测波形与孪生波形的残差分析实现故障特征提取，结合轻量化神经网络完成故障分类。实验结果表明，所提方法对逆变器开路故障的诊断准确率达到 98.6%，平均诊断耗时 12ms。'),
    dict(cat='电力电子', slug='2023-rl-dc-dc-control',
         title='Deep reinforcement learning for DC-DC converter control in photovoltaic systems',
         authors='Wei Chen, Yong Wang, et al.', venue='IEEE Transactions on Power Electronics', year=2023,
         abstract='This paper proposes a deep reinforcement learning (DRL) based control strategy for DC-DC converters in photovoltaic (PV) systems. A soft actor-critic agent is trained in a digital twin environment to track the maximum power point under rapidly changing irradiance and temperature. Compared with conventional perturb-and-observe control, the proposed method improves tracking efficiency by 2.3% under step irradiance changes and eliminates steady-state oscillation.'),
    dict(cat='智能体与LLM', slug='2025-llm-agent-survey',
         title='基于大语言模型的智能体协同规划综述',
         authors='吴琼琼, 郑宇宁, 高志强', venue='软件学报', year=2025,
         abstract='大语言模型的发展推动智能体从单体制定向多智能体协同演进。本文系统综述基于 LLM 的多智能体协同规划研究：从任务分解、角色分配、通信协议与反思机制四个维度归纳现有方法；对比 ReAct、Reflexion、MetaGPT 等代表性框架在基准任务上的表现；总结当前在长程规划一致性、幻觉抑制与成本控制方面的开放挑战，并展望与形式化验证结合的未来方向。'),
    dict(cat='智能体与LLM', slug='2024-erroneous-planning-llm',
         title='Testing and Understanding Erroneous Planning in LLM Agents through Synthesized Scenarios',
         authors='Zhenlan Ji, Bing Ma, Xuan Li, Pingan Wang, Zixuan Zhu, Lei Li', venue='arXiv 预印本', year=2024,
         abstract='LLM-based agents have been increasingly deployed to make plans for complex tasks. However, erroneous planning could lead to severe consequences. This paper proposes PDOCTOR, a novel testing framework to detect erroneous plans through constraint satisfaction-based scenario synthesis and two-and-half-order logical entailment. Evaluation on three popular LLMs shows that erroneous plans are prevalent, and greedy planning exhibits higher error rates than non-greedy counterparts.'),
]


def wrap_text(text, font, size, maxw):
    """按渲染宽度断行（支持中英混排）"""
    lines, cur = [], ''
    for ch in text:
        if pdfmetrics.stringWidth(cur + ch, font, size) > maxw:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def draw_chart(c, x, y, w, h, kind):
    c.setStrokeColor((0.72, 0.74, 0.78))
    c.setLineWidth(1)
    c.rect(x, y, w, h)
    if kind == 0:
        pts = [(x + 12 + i * (w - 24) / 10, y + 12 + abs(((i * 37) % 90)) * (h - 30) / 90) for i in range(11)]
        c.setStrokeColor((0.25, 0.42, 0.8)); c.setLineWidth(2)
        c.polyline(pts)
        pts2 = [(x + 12 + i * (w - 24) / 10, y + 12 + abs(((i * 23) % 70)) * (h - 30) / 70) for i in range(11)]
        c.setStrokeColor((0.8, 0.36, 0.36))
        c.polyline(pts2)
    elif kind == 1:
        for i in range(8):
            bh = 8 + ((i * 53) % 80) * (h - 24) / 80
            c.setFillColor((0.35, 0.55, 0.86) if i % 2 else (0.6, 0.75, 0.94))
            c.rect(x + 14 + i * (w - 28) / 8, y + 10, (w - 28) / 12, bh, stroke=0, fill=1)
    else:
        c.setStrokeColor((0.75, 0.77, 0.8))
        for i in range(6):
            c.line(x + 8, y + 8 + i * (h - 16) / 5, x + w - 8, y + 8 + i * (h - 16) / 5)
            c.line(x + 8 + i * (w - 16) / 5, y + 8, x + 8 + i * (w - 16) / 5, y + h - 8)
        c.setFillColor((0.86, 0.35, 0.35))
        c.circle(x + w / 2, y + h / 2, 10, stroke=0, fill=1)


def render_paper(p, idx, pdf_path):
    c = canvas.Canvas(pdf_path, pagesize=A4)
    margin = 52
    maxw = W - 2 * margin
    y = H - 64
    # 标题（自动换行）
    c.setFillColor((0.1, 0.1, 0.12))
    size = 19 if len(p['title']) < 40 else 16
    for ln in wrap_text(p['title'], 'MSYH', size, maxw):
        c.setFont('MSYH', size)
        c.drawString(margin, y, ln)
        y -= size + 7
    y -= 6
    c.setFont('MSYH', 10.5)
    c.setFillColor((0.28, 0.3, 0.34))
    c.drawString(margin, y, p['authors'])
    y -= 17
    c.setFillColor((0.44, 0.46, 0.5))
    c.drawString(margin, y, '智能科学与技术国家重点实验室 · Beihang University')
    y -= 24
    c.setStrokeColor((0.84, 0.85, 0.87)); c.setLineWidth(0.8)
    c.line(margin, y, W - margin, y)
    y -= 22
    # 摘要（真实文本）
    c.setFont('MSYH', 12); c.setFillColor((0.1, 0.1, 0.12))
    c.drawString(margin, y, '摘  要')
    y -= 19
    c.setFont('SONG', 10); c.setFillColor((0.22, 0.24, 0.27))
    for ln in wrap_text(p['abstract'], 'SONG', 10, maxw):
        c.drawString(margin, y, ln)
        y -= 15.5
    y -= 12
    c.setFont('MSYH', 9.5); c.setFillColor((0.5, 0.38, 0.1))
    c.drawString(margin, y, '关键词: ' + '、'.join(['任务规划', '智能优化', '卫星系统', '调度算法'][:3 + idx % 2]))
    y -= 26
    # 图表
    cw = (maxw - 24) / 2
    draw_chart(c, margin, y - 118, cw, 118, idx % 3)
    draw_chart(c, margin + cw + 24, y - 118, cw, 118, (idx + 1) % 3)
    c.setFont('SONG', 8.5); c.setFillColor((0.38, 0.4, 0.44))
    c.drawString(margin, y - 132, f'图 {idx % 3 + 1}  实验结果对比')
    c.drawString(margin + cw + 24, y - 132, f'表 {idx % 3 + 1}  方法性能统计')
    y -= 152
    # 两栏正文（真实文本，供翻译/检索演示）
    body1 = '引言  随着对地观测需求的快速增长，传统单星串行任务模式已难以满足大规模区域目标的覆盖要求。' \
            '多星协同任务规划成为航天任务规划领域的研究热点，其核心挑战在于时间窗碎片化与星上资源约束的耦合。' * 2
    body2 = '方法  本文首先将连续区域离散为规则网格集合，进而建立以观测收益最大化为目标的整数规划模型；' \
            '随后设计双层启发式框架：上层进行任务聚合与卫星分配，下层执行精细时间窗调整。' * 2
    c.setFont('SONG', 9); c.setFillColor((0.3, 0.32, 0.36))
    colw = (maxw - 20) / 2
    for j, body in enumerate([body1, body2]):
        yy = y
        for ln in wrap_text(body, 'SONG', 9, colw):
            if yy < 60:
                break
            c.drawString(margin + j * (colw + 20), yy, ln)
            yy -= 13.5
    # 页脚
    c.setFont('MSYH', 8.5); c.setFillColor((0.6, 0.61, 0.64))
    c.drawString(margin, 30, f"{p['venue']} · {p['year']}")
    c.drawRightString(W - margin, 30, 'CSPAPER 示例文献')
    c.save()


os.system('if exist F:\\tmp\\cspaper-sample rmdir /s /q F:\\tmp\\cspaper-sample')
for i, p in enumerate(PAPERS):
    d = os.path.join(OUT, p['cat'], p['slug'])
    os.makedirs(d, exist_ok=True)
    render_paper(p, i, os.path.join(d, 'paper.pdf'))
    md = (f"---\ntitle: \"{p['title']}\"\nauthors: \"{p['authors']}\"\nyear: {p['year']}\n"
          f"venue: \"{p['venue']}\"\nstatus: unread\n---\n\n# {p['title']}\n")
    with open(os.path.join(d, p['slug'] + '.md'), 'w', encoding='utf-8') as f:
        f.write(md)
    print('OK', p['slug'])
print('文本型示例库生成完毕:', OUT)
