"""Generate realistic two-column demo paper PDFs and CSPAPER markdown sidecars.

The output is an isolated sample library used only by scripts/capture-screenshots.mjs
to produce marketing screenshots. Titles, authors, venues and results are fictional.

Usage: python scripts/fixtures/demo_papers.py <library_dir>
"""
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, FrameBreak, KeepTogether, NextPageTemplate,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus import Flowable

PW, PH = letter
M = 50
GUTTER = 18
COL_W = (PW - 2 * M - GUTTER) / 2
FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def register_fonts():
    """Embed Times New Roman when available; otherwise fall back to reportlab base fonts."""
    try:
        pdfmetrics.registerFont(TTFont("Demo", os.path.join(FONT_DIR, "times.ttf")))
        pdfmetrics.registerFont(TTFont("Demo-Bold", os.path.join(FONT_DIR, "timesbd.ttf")))
        pdfmetrics.registerFont(TTFont("Demo-Italic", os.path.join(FONT_DIR, "timesi.ttf")))
        pdfmetrics.registerFont(TTFont("Demo-BoldItalic", os.path.join(FONT_DIR, "timesbi.ttf")))
    except Exception:
        pdfmetrics.registerFont(TTFont("Demo", "Helvetica"))
        pdfmetrics.registerFont(TTFont("Demo-Bold", "Helvetica-Bold"))
        pdfmetrics.registerFont(TTFont("Demo-Italic", "Helvetica-Oblique"))
        pdfmetrics.registerFont(TTFont("Demo-BoldItalic", "Helvetica-BoldOblique"))
    pdfmetrics.registerFontFamily("Demo", normal="Demo", bold="Demo-Bold", italic="Demo-Italic", boldItalic="Demo-BoldItalic")


register_fonts()

TITLE = ParagraphStyle("title", fontName="Demo-Bold", fontSize=16.5, leading=20, alignment=TA_CENTER, spaceAfter=7)
AUTHORS = ParagraphStyle("authors", fontName="Demo", fontSize=10.5, leading=13.5, alignment=TA_CENTER, spaceAfter=2)
AFFIL = ParagraphStyle("affil", fontName="Demo-Italic", fontSize=8.8, leading=11.5, alignment=TA_CENTER, textColor=colors.HexColor("#333333"), spaceAfter=8)
ABSTRACT = ParagraphStyle("abstract", fontName="Demo", fontSize=9.1, leading=11.8, alignment=TA_JUSTIFY, leftIndent=22, rightIndent=22)
KEYWORDS = ParagraphStyle("keywords", fontName="Demo", fontSize=8.6, leading=11.4, alignment=TA_LEFT, leftIndent=22, rightIndent=22, spaceBefore=4)
H1 = ParagraphStyle("h1", fontName="Demo-Bold", fontSize=10.6, leading=13.5, spaceBefore=9, spaceAfter=3.5)
H2 = ParagraphStyle("h2", fontName="Demo-Italic", fontSize=9.8, leading=12.5, spaceBefore=6, spaceAfter=2)
BODY = ParagraphStyle("body", fontName="Demo", fontSize=9.5, leading=12.3, alignment=TA_JUSTIFY, firstLineIndent=11)
BODY0 = ParagraphStyle("body0", parent=BODY, firstLineIndent=0)
CAPTION = ParagraphStyle("caption", fontName="Demo", fontSize=8.3, leading=10.6, alignment=TA_JUSTIFY, spaceBefore=3, spaceAfter=7)
REF = ParagraphStyle("ref", fontName="Demo", fontSize=8.3, leading=10.4, alignment=TA_LEFT, leftIndent=12, firstLineIndent=-12, spaceAfter=2.4)
CELL = ParagraphStyle("cell", fontName="Demo", fontSize=8.2, leading=10.2)
CELLB = ParagraphStyle("cellb", fontName="Demo-Bold", fontSize=8.2, leading=10.2)

PAPERS = [
    dict(slug="2025-tool-augmented-agents", cat="01-智能体", title="Tool-Augmented Language Agents: A Reproducible Evaluation Protocol",
         authors="A. Moreno, J. Whitfield, L. Okafor", affil="Institute for Computational Reasoning · {affil}",
         year=2025, venue="Preprint", tags=["工具调用", "评测基准"], template=0, pages_hint=4,
         abstract="Language agents that call external tools are increasingly used for literature search, data analysis and report drafting, yet published evaluations rarely share a common protocol. We propose a reproducible evaluation protocol for tool-augmented agents that fixes the tool schema, the task split, the success criteria and the logging format. Under this protocol we re-evaluate nine open agents and find that reported gains shrink by 38 percent once environment noise is controlled, and that trajectory audits explain most of the remaining variance."),
    dict(slug="2025-citation-faithfulness", cat="02-检索增强", title="Citation Faithfulness in Knowledge-Grounded Generation: Measuring What Models Actually Support",
         authors="R. Castellanos, M. Ishida, P. Lindqvist", affil="Lab for Trustworthy Information Systems · {affil}",
         year=2025, venue="Preprint", tags=["引用忠实度", "检索增强"], template=1, pages_hint=4,
         abstract="Grounded generation systems attach citations to every claim, but citation precision is rarely measured at the sentence level. We introduce a sentence-level faithfulness metric that pairs each claim with the evidence span it relies on, and annotate 4,200 claims produced by six systems. Faithfulness ranges from 61 to 88 percent, and we show that most unsupported claims originate from multi-hop composition rather than from retrieval failure."),
    dict(slug="2024-planning-under-uncertainty", cat="01-智能体", title="Planning Under Uncertainty for Multi-Step LLM Agents",
         authors="T. Nakamura, S. Adeyemi, K. Brandt", affil="Department of Autonomous Systems · {affil}",
         year=2024, venue="Preprint", tags=["任务规划", "可靠性"], template=2, pages_hint=3,
         abstract="Multi-step agents must commit to a plan before observing the outcome of every action. We formalise planning under uncertainty as a partially observable decision process and compare three strategies: fixed plans, replanning after each step, and belief-state lookahead. Across 1,150 tasks, belief-state lookahead improves task success by 11 points over fixed plans while using 23 percent fewer model calls than step-wise replanning."),
    dict(slug="2026-self-verification", cat="02-检索增强", title="Self-Verification Reduces Hallucinated Citations in Scientific Summaries",
         authors="E. Vogel, H. Duarte, N. Kowalski", affil="Center for Scholarly Communication · {affil}",
         year=2026, venue="Preprint", tags=["自我验证", "引用忠实度"], template=1, pages_hint=4,
         abstract="Scientific summaries written by language models frequently cite sources that do not support the attributed claim. We test whether a lightweight self-verification pass, in which the model re-reads each cited passage before finalising a summary, reduces such errors. On two benchmark suites the pass lowers unsupported citations from 18.4 to 6.9 percent with a 14 percent increase in inference cost, and human raters prefer the verified summaries in 72 percent of comparisons."),
    dict(slug="2025-tool-robustness-benchmark", cat="03-评测方法", title="A Benchmark for Tool-Use Robustness Across Domain Shifts",
         authors="L. Ferreira, D. Osei, Y. Chen", affil="Applied Machine Intelligence Group · {affil}",
         year=2025, venue="Preprint", tags=["评测基准", "鲁棒性"], template=2, pages_hint=3,
         abstract="Tool-using agents are usually evaluated in the domain they were developed in. We construct a cross-domain benchmark in which the same tool interface is instantiated in six domains with different vocabularies and error modes. Agent success drops by up to 27 points under domain shift, and the drop is concentrated in recovery behaviour after a tool error rather than in the initial tool selection."),
    dict(slug="2024-human-in-the-loop-approval", cat="01-智能体", title="Human-in-the-Loop Approval for Agent-Generated Scientific Claims",
         authors="G. Petrova, B. Solomon, A. Rahman", affil="School of Information Studies · {affil}",
         year=2024, venue="Preprint", tags=["人机协同", "科研诚信"], template=0, pages_hint=3,
         abstract="Research assistants that draft claims, tables and conclusions need an approval step before their output enters a manuscript. We compare interface designs for claim-level approval with 48 researchers and measure review time, error detection and trust. Showing the supporting evidence span next to each claim increases error detection from 54 to 81 percent while reducing median review time by a third."),
    dict(slug="2026-cost-aware-retrieval", cat="02-检索增强", title="Cost-Aware Retrieval for Long-Context Literature Review",
         authors="I. Novak, F. Almeida, C. Whitmore", affil="Institute for Scalable Information Access · {affil}",
         year=2026, venue="Preprint", tags=["长上下文", "检索成本"], template=1, pages_hint=4,
         abstract="Long-context models make it possible to place dozens of papers in a single prompt, but the cost grows linearly with context length. We study when retrieval is preferable to exhaustive context and propose a cost-aware controller that predicts, per question, whether additional passages are likely to change the answer. The controller matches exhaustive context quality within 1.2 points while using 41 percent fewer input tokens."),
    dict(slug="2025-trajectory-audits", cat="03-评测方法", title="Memory of Prior Tool Calls: Auditing Agent Trajectories",
         authors="V. Sorensen, O. Mensah, J. Park", affil="Group for Accountable Software · {affil}",
         year=2025, venue="Preprint", tags=["可审计性", "轨迹分析"], template=2, pages_hint=3,
         abstract="Agent failures are difficult to reproduce because intermediate tool results are discarded after a run. We specify a trajectory audit log that records every tool call, its arguments, its observation and the model state that produced it. Replaying 600 logged trajectories reproduces 94 percent of reported failures exactly and reveals that 31 percent of errors stem from stale observations reused across steps."),
]

TEMPLATES = [
    dict(
        sections=[
            ("Introduction", [
                "Language agents that call external tools now handle literature search, table extraction and report drafting. Yet the numbers reported by different groups are hard to compare: tool interfaces differ, success criteria are implicit, and intermediate results are discarded after a run. This paper argues that a shared protocol is a prerequisite for cumulative progress.",
                "We make three contributions. First, we fix the tool schema and the task split so that every agent sees the same inputs. Second, we define success at the level of the final artefact rather than the final message. Third, we require a complete trajectory log so that any reported result can be replayed.",
            ]),
            ("Related Work", [
                "Early agent benchmarks measured whether a model could select the correct tool from a menu. Later work added multi-step tasks but kept domain-specific scoring rules. Protocol-level comparisons are rare; the closest effort focuses on web navigation and does not cover scholarly tools.",
            ]),
            ("Evaluation Protocol", [
                "The protocol has four components. The task suite contains 420 tasks grouped by the number of required tool calls. The environment returns deterministic observations for a seeded random seed. Success is scored by three independent checks on the produced artefact: schema validity, claim support and completeness. Trajectories are stored as append-only logs.",
                "Agents interact with eight tools: a library search, a page reader, a note writer, a table builder and four utilities. Tool errors are injected with probability 0.1 to test recovery. Each agent is given the same instruction budget and the same maximum number of steps.",
            ]),
            ("Results", [
                "Table 1 summarises the outcome. Once environment noise is controlled, the gap between the strongest and the weakest open agents shrinks from 52 to 14 points. Trajectory audits explain most of the remaining variance: agents that re-read stale observations fail twice as often on multi-step tasks.",
                "Recovery behaviour separates the agents more clearly than raw tool selection. Agents that verify an observation before reusing it recover from 78 percent of injected errors, whereas agents that proceed on the stale state recover from 29 percent.",
            ]),
            ("Discussion", [
                "Our results suggest that reported progress in tool-using agents is partly an artefact of loose evaluation. A shared protocol does not remove the need for domain benchmarks, but it makes their results comparable and reproducible.",
            ]),
            ("Conclusion", [
                "We presented a reproducible evaluation protocol and showed how it changes the ranking of open agents. The protocol, task suite and logs are released to support future comparisons.",
            ]),
        ],
        table=dict(caption="Table 1: Task success under the shared protocol (420 tasks). Deterministic denotes a seeded environment.",
                   header=["Agent", "Reported", "Protocol", "Audit", "Steps"],
                   rows=[["Atlas", "86.1", "71.4", "68.9", "6.2"], ["Boreal", "84.7", "69.8", "66.3", "7.5"],
                         ["Cinder", "81.2", "64.0", "61.7", "8.9"], ["Dune", "77.5", "60.3", "58.1", "9.4"],
                         ["Ember", "72.0", "57.4", "55.6", "11.0"]]),
    ),
    dict(
        sections=[
            ("Introduction", [
                "Grounded generation promises answers that can be checked. In practice the promise is only as good as the link between a claim and its evidence. A citation that points to a relevant document but not to a supporting span gives readers a false sense of verification.",
                "This paper measures that link directly. Each generated claim is paired with the evidence span a annotator judges necessary, and the system is scored on whether its own citation leads to such a span.",
            ]),
            ("Problem Formulation", [
                "Let a summary consist of claims c1..cn and let each claim carry a citation to a document and, optionally, a span. A claim is faithful if the cited span entails the claim without additional outside knowledge. Faithfulness is the fraction of faithful claims; composition depth is the number of source passages needed to verify a claim.",
                "We distinguish retrieval failure, where no supporting passage exists in the candidate set, from attribution failure, where a supporting passage exists but is not the one cited.",
            ]),
            ("Method", [
                "The annotation interface presents a claim together with the retrieved passages in random order. Two annotators mark the minimal supporting span; disagreements are resolved by a third. Inter-annotator agreement on the span boundary is 0.81.",
                "Systems are evaluated in two modes. In the retrieval mode the system receives only the question. In the assisted mode it receives an oracle candidate set, which isolates attribution failure from retrieval failure.",
            ]),
            ("Experiments", [
                "We evaluate six systems on 700 questions drawn from three scholarly domains. Each system produces a five-sentence summary with sentence-level citations, yielding 4,200 annotated claims.",
            ]),
            ("Results", [
                "Faithfulness ranges from 61 to 88 percent. With an oracle candidate set the range narrows to 74 to 91 percent, which indicates that a third of the original errors are retrieval failures. Unsupported claims concentrate on claims that combine two passages.",
                "Table 1 reports the breakdown. Single-passage claims are faithful in 87 percent of cases, whereas two-hop claims fall to 58 percent even with oracle retrieval.",
            ]),
            ("Limitations", [
                "Annotation covers English-language sources in three domains. The metric does not penalise over-citation, and the oracle candidate set is larger than what most production retrievers return.",
            ]),
            ("Conclusion", [
                "Sentence-level faithfulness exposes failure modes that document-level citation accuracy hides. We release the annotation tool and the 4,200 rated claims.",
            ]),
        ],
        table=dict(caption="Table 1: Sentence-level faithfulness by number of supporting passages (4,200 claims).",
                   header=["Passages needed", "Claims", "Faithful", "Retrieval mode", "Oracle retrieval"],
                   rows=[["1", "2,410", "87.2%", "84.1%", "90.6%"], ["2", "1,215", "58.4%", "51.0%", "74.3%"],
                         ["3 or more", "575", "39.1%", "31.3%", "52.2%"]]),
    ),
    dict(
        sections=[
            ("Introduction", [
                "An agent that must complete several tool calls rarely knows the outcome of later steps when it writes its plan. Treating the problem as deterministic leads to brittle behaviour: one unexpected observation invalidates the plan and the agent either restarts or ignores the evidence.",
                "We compare three planning strategies under a common task distribution and show that the cost of look-ahead is repaid by fewer model calls.",
            ]),
            ("Background", [
                "The environment is modelled as a partially observable decision process in which observations are tool outputs. A policy maps the belief state, the set of observations consistent with the history, to the next action. Fixed plans condition only on the initial goal; replanning conditions on the latest observation.",
            ]),
            ("Audit Design", [
                "Tasks are generated from templates with one to six required calls. Each template defines a goal, a hidden state and a success predicate. Ten percent of tool outputs are delayed or corrupted. Belief-state look-ahead samples three continuations and picks the action with the best expected completion.",
            ]),
            ("Findings", [
                "Belief-state look-ahead completes 83 percent of tasks, against 72 percent for step-wise replanning and 69 percent for fixed plans. It issues 1.9 model calls per task on average, compared with 2.5 for replanning. The advantage grows with task length.",
                "Table 1 breaks the results down by required calls. For tasks with five or six calls, look-ahead is 19 points ahead of fixed plans.",
            ]),
            ("Threats to Validity", [
                "Templates are synthetic and may not reflect the ambiguity of real user goals. The look-ahead policy uses a stronger model than the baselines; a control experiment with matched models reduces the gain to 7 points.",
            ]),
            ("Conclusion", [
                "Treating tool use as planning under belief pays off when tasks are long and observations are noisy. We release the task generator and the three policies.",
            ]),
        ],
        table=dict(caption="Table 1: Task success and model calls by the number of required tool calls (1,150 tasks).",
                   header=["Required calls", "Tasks", "Fixed plan", "Replanning", "Look-ahead"],
                   rows=[["1-2", "410", "88.0%", "87.8%", "88.3%"], ["3-4", "380", "66.7%", "70.5%", "83.7%"],
                         ["5-6", "360", "51.1%", "57.2%", "76.9%"]]),
    ),
]

NOTES = {
    "2025-tool-augmented-agents": "## 核心结论\n\n固定工具 schema + 制品级成功判定后，开源智能体之间的差距从 52 收窄到 14 个点。\n\n## 对我的启发\n\n- 轨迹日志（trajectory log）是复现的前提，综述里要把“可审计”单列一节。\n- 注入 10% 工具错误来测恢复能力，这个设计可以借用到自己的实验里。\n\n## 待核实\n\n- 表 1 中 Atlas 在 Protocol 列的 71.4 是否包含恢复失败的样本？",
    "2025-citation-faithfulness": "## 研究问题\n\n句级引用忠实度：被引用的片段是否真的支持这句话。\n\n## 方法亮点\n\n标注者标出最小支持片段，区分“检索失败”和“归因失败”。\n\n## 可引用\n\n- 忠实度 61%–88%；给 oracle 候选集后收窄到 74%–91%。\n",
    "2026-self-verification": "## 一句话\n\n让模型在定稿前重读被引段落，可以把无支持引用从 18.4% 降到 6.9%，代价是推理成本 +14%。\n\n## 与综述的关系\n\n对应“生成后校验”这一支，可以和 retrieval 侧的改进做对比。",
    "2024-planning-under-uncertainty": "## 笔记\n\n belief-state lookahead 比 fixed plan 高 11 个点，模型调用少 23%。\n\n## 疑问\n\n lookahead 用了更强的模型，匹配模型后只剩 7 个点——写的时候要注明。",
}

REFERENCES = [
    "L. Ferreira, D. Osei, and Y. Chen. A benchmark for tool-use robustness across domain shifts. Preprint, 2025.",
    "V. Sorensen, O. Mensah, and J. Park. Memory of prior tool calls: auditing agent trajectories. Preprint, 2025.",
    "R. Castellanos, M. Ishida, and P. Lindqvist. Citation faithfulness in knowledge-grounded generation. Preprint, 2025.",
    "E. Vogel, H. Duarte, and N. Kowalski. Self-verification reduces hallucinated citations in scientific summaries. Preprint, 2026.",
    "G. Petrova, B. Solomon, and A. Rahman. Human-in-the-loop approval for agent-generated scientific claims. Preprint, 2024.",
]


def first_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Demo-Italic", 7.6)
    canvas.setFillColor(colors.HexColor("#555555"))
    canvas.drawString(M, PH - 30, "Preprint · Under review")
    canvas.drawRightString(PW - M, PH - 30, "November 2025")
    canvas.setStrokeColor(colors.HexColor("#bbbbbb"))
    canvas.setLineWidth(0.5)
    canvas.line(M, PH - 36, PW - M, PH - 36)
    canvas.setFont("Demo", 8.4)
    canvas.drawCentredString(PW / 2, 28, str(doc.page))
    canvas.restoreState()


def later_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Demo-Italic", 7.6)
    canvas.setFillColor(colors.HexColor("#555555"))
    canvas.drawString(M, PH - 30, "Preprint · Under review")
    canvas.setFont("Demo", 8.4)
    canvas.drawCentredString(PW / 2, 28, str(doc.page))
    canvas.restoreState()


def build(path, paper):
    template = TEMPLATES[paper["template"]]
    head_h = 196
    col_top = PH - M - head_h - 12
    col_h = col_top - M - 16
    doc = BaseDocTemplate(path, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=M,
                          title=paper["title"], author=paper["authors"], subject="Sample paper for CSPAPER screenshots")
    pad = dict(leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    first = PageTemplate(id="first", frames=[Frame(M, PH - M - head_h, PW - 2 * M, head_h, id="head", **pad),
                                              Frame(M, M + 16, COL_W, col_h, id="l", **pad),
                                              Frame(M + COL_W + GUTTER, M + 16, COL_W, col_h, id="r", **pad)], onPage=first_page)
    rest = PageTemplate(id="rest", frames=[Frame(M, M + 16, COL_W, PH - 2 * M - 16, id="l", **pad),
                                           Frame(M + COL_W + GUTTER, M + 16, COL_W, PH - 2 * M - 16, id="r", **pad)], onPage=later_page)
    doc.addPageTemplates([first, rest])

    story = [Paragraph(paper["title"], TITLE), Paragraph(paper["authors"], AUTHORS),
             Paragraph(paper["affil"].format(affil="Sample Institution"), AFFIL),
             Paragraph("<b>Abstract</b>—" + paper["abstract"], ABSTRACT),
             Paragraph("<b>Keywords:</b> " + "; ".join(paper["tags"]).replace("工具调用", "tool use").replace("评测基准", "benchmark").replace("引用忠实度", "citation faithfulness").replace("检索增强", "retrieval augmentation").replace("任务规划", "planning").replace("可靠性", "reliability").replace("自我验证", "self-verification").replace("鲁棒性", "robustness").replace("人机协同", "human-in-the-loop").replace("科研诚信", "research integrity").replace("长上下文", "long context").replace("检索成本", "retrieval cost").replace("可审计性", "auditability").replace("轨迹分析", "trajectory analysis"), KEYWORDS),
             FrameBreak()]
    table_placed = False
    for index, (heading, paragraphs) in enumerate(template["sections"]):
        story.append(Paragraph(f"{index + 1}&nbsp;&nbsp;{heading}", H1))
        for p_index, text in enumerate(paragraphs):
            story.append(Paragraph(text, BODY if p_index == 0 else BODY0))
        if heading in ("Evaluation Protocol", "Experiments", "Audit Design") and not table_placed:
            spec = template["table"]
            data = [[Paragraph(h, CELLB) for h in spec["header"]]] + [[Paragraph(c, CELL) for c in row] for row in spec["rows"]]
            table = Table(data, colWidths=[COL_W * 0.31] + [(COL_W * 0.69) / (len(spec["header"]) - 1)] * (len(spec["header"]) - 1), hAlign="LEFT")
            table.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black),
                                       ("LINEBELOW", (0, 0), (-1, 0), 0.4, colors.black),
                                       ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black),
                                       ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                       ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
            story.append(Spacer(1, 4))
            story.append(KeepTogether([table]))
            story.append(Paragraph(spec["caption"], CAPTION))
            table_placed = True
        if index == 1:
            figure = PipelineFigure(COL_W - 6, 92)
            story.append(Spacer(1, 3))
            story.append(KeepTogether([figure, Paragraph("<b>Figure 1:</b> Overview of the evaluation pipeline. Each tool observation is appended to an append-only log before the next action is selected.", CAPTION)]))
    appendix = dict(caption="Table 2: Recovery rate after an injected tool error, by agent (seeded runs).",
                    header=["Agent", "Injected errors", "Recovered", "Retried", "Aborted"],
                    rows=[["Atlas", "41", "78.0%", "12.2%", "9.8%"], ["Boreal", "41", "70.7%", "19.5%", "9.8%"],
                          ["Cinder", "40", "62.5%", "22.5%", "15.0%"], ["Dune", "40", "52.5%", "27.5%", "20.0%"],
                          ["Ember", "39", "41.0%", "28.2%", "30.8%"]])
    story.append(Paragraph("Appendix A&nbsp;&nbsp;Prompt and Logging Format", H1))
    story.append(Paragraph("Every task begins with a fixed instruction that lists the available tools and the expected output format. The instruction is identical across agents; only the tool descriptions differ. Logging uses an append-only JSON-lines format in which each record carries the step index, the tool name, the serialized arguments, the observation hash and the wall-clock duration.", BODY))
    story.append(Paragraph("Reviewers can replay a trajectory by feeding the recorded observations back in order. A replay is considered exact when the sequence of tool names and argument hashes matches the original log. Trajectories that depend on wall-clock timing are replayed with the recorded timestamps.", BODY0))
    story.append(Paragraph("Appendix B&nbsp;&nbsp;Additional Results", H1))
    data = [[Paragraph(h, CELLB) for h in appendix["header"]]] + [[Paragraph(c, CELL) for c in row] for row in appendix["rows"]]
    table = Table(data, colWidths=[COL_W * 0.28] + [(COL_W * 0.72) / 4] * 4, hAlign="LEFT")
    table.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black), ("LINEBELOW", (0, 0), (-1, 0), 0.4, colors.black),
                               ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                               ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story.append(Spacer(1, 4))
    story.append(KeepTogether([table]))
    story.append(Paragraph(appendix["caption"], CAPTION))
    story.append(Paragraph("The column Retried counts cases in which the agent issued a second call to the same tool with modified arguments, and Aborted counts cases in which the agent returned a final answer without recovering. Recovery rates track the protocol results in Table 1 and confirm that verification before reuse is the main driver of robustness.", BODY))
    story.append(Paragraph("Appendix C&nbsp;&nbsp;Threats to Reproduction", H1))
    story.append(Paragraph("Three factors limit exact reproduction. Model providers change sampling behaviour without notice, so the sampling seed is recorded together with the model snapshot identifier. Tool latencies affect agents that implement timeouts, and are replayed from the log. Finally, annotators of the final artefacts may apply the rubric differently; the protocol therefore reports pairwise agreement alongside every score.", BODY0))
    story.append(Paragraph("References", H1))
    for ref in REFERENCES:
        story.append(Paragraph(ref, REF))
    doc.build(story)


class PipelineFigure(Flowable):
    """A small schematic that stands in for a figure in the sample paper."""

    def __init__(self, width, height):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        canvas.saveState()
        width, height = self.width, self.height
        canvas.setFillColor(colors.HexColor("#f3f1ec"))
        canvas.setStrokeColor(colors.HexColor("#999999"))
        canvas.setLineWidth(0.6)
        canvas.rect(0, 0, width, height, stroke=1, fill=1)
        labels = ["Goal", "Plan", "Tool call", "Log", "Verify", "Artefact"]
        box_w, gap = (width - 16) / 6, 4
        for index, label in enumerate(labels):
            bx = 8 + index * (box_w + gap)
            canvas.setFillColor(colors.white)
            canvas.setStrokeColor(colors.HexColor("#555555"))
            canvas.rect(bx, height / 2 - 14, box_w - gap, 28, stroke=1, fill=1)
            canvas.setFillColor(colors.HexColor("#222222"))
            canvas.setFont("Demo", 6.2)
            canvas.drawCentredString(bx + (box_w - gap) / 2, height / 2 - 2.2, label)
            if index < len(labels) - 1:
                canvas.setStrokeColor(colors.HexColor("#777777"))
                canvas.line(bx + box_w - gap, height / 2, bx + box_w - 1, height / 2)
        canvas.restoreState()


def write_library(root):
    written = []
    for paper in PAPERS:
        folder = os.path.join(root, "papers", paper["cat"], paper["slug"])
        os.makedirs(folder, exist_ok=True)
        build(os.path.join(folder, "paper.pdf"), paper)
        notes = NOTES.get(paper["slug"], "## 阅读记录\n\n（在 CSPAPER 中划词高亮或写下笔记。）")
        md = "---\n"
        md += 'title: "%s"\n' % paper["title"].replace('"', '\\"')
        md += 'authors: "%s"\nyear: %d\nvenue: "%s"\ndoi: "10.0000/%s"\n' % (paper["authors"], paper["year"], paper["venue"], paper["slug"])
        md += "tags: [%s]\n" % ", ".join(paper["tags"])
        md += 'abstract: "%s"\n' % paper["abstract"].replace('"', '\\"').replace("\n", " ")
        md += "---\n\n# %s\n\n## 我的笔记\n<!-- cspaper:notes:start -->\n%s\n<!-- cspaper:notes:end -->\n" % (paper["title"], notes)
        with open(os.path.join(folder, paper["slug"] + ".md"), "w", encoding="utf-8") as handle:
            handle.write(md)
        written.append(paper["slug"])

    record = dict(slug="2023-reading-lists-survey", cat="03-评测方法", title="From Reading Lists to Research Assistants: A Workflow Survey",
                  authors="B. Haddad, K. Ostrowski", year=2023, tags=["综述", "科研工作流"])
    folder = os.path.join(root, "papers", record["cat"], record["slug"])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "paper.pdf"), "w", encoding="utf-8") as handle:
        handle.write("%PDF-1.4 CSPAPER record-only fixture")
    with open(os.path.join(folder, record["slug"] + ".md"), "w", encoding="utf-8") as handle:
        handle.write('---\ntitle: "%s"\nauthors: "%s"\nyear: %d\nvenue: "Preprint"\ndoi: "10.0000/%s"\nabstract: "A survey of how researchers move from curated reading lists to agentic assistants, and which parts of the workflow remain manual."\nsource_kind: record\ntags: [%s]\n---\n\n# %s\n' % (
            record["title"], record["authors"], record["year"], record["slug"], ", ".join(record["tags"]), record["title"]))
    written.append(record["slug"])
    return written


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "demo-library"
    os.makedirs(target, exist_ok=True)
    print("DEMO_PAPERS", len(write_library(target)))
