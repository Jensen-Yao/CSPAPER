# CSPAPER Translators 抓取脚本规范

CSPAPER 的「从网站抓题录」能力不硬编码在主程序里，而是由**声明式 JSON 脚本**驱动（架构对标 Zotero Translators）。内置脚本随应用发布；你或社区写的脚本放进数据目录的 `translators/` 文件夹**即刻生效（免重启，自动热加载）**。

在应用内打开脚本目录：**设置 → 在线获取 → 打开脚本目录**。

- 内置脚本目录（随安装包发布）：`resources/translators/`
- 用户脚本目录（本机数据目录）：`<数据目录>/translators/`（设置 → 数据目录 可查看位置）
- 在线添加入口：**文件 → 在线添加…**（DOI / arXiv ID / 链接 / 关键词）；浏览器插件保存页面时也会优先询问桌面端是否命中脚本

## 脚本结构

```json
{
  "id": "my-site",
  "name": "我的站点",
  "version": 1,
  "type": "web",
  "matches": ["example-journal.com"],
  "patterns": ["example-journal\\.com/doi/"],
  "note": "给使用者看的说明",
  "steps": [
    { "op": "fetch" },
    { "op": "meta", "pick": "citation_title", "as": "title" },
    { "op": "meta", "pick": "citation_author", "as": "authors", "multi": true },
    { "op": "meta", "pick": "citation_date", "as": "year", "re": "(\\d{4})" },
    { "op": "download", "url": "{_pdfurl}" }
  ],
  "transform": "return { title: t.title.trim() }"
}
```

## 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 全局唯一标识（建议 kebab-case，避免与内置脚本重复） |
| `name` | ✓ | 显示名称（设置页与来源徽标） |
| `type` |  | `web`（抓取指定网页，默认）或 `search`（检索型：输入关键词返回结果列表） |
| `matches` | web 型必填 | hostname 后缀匹配列表，如 `"arxiv.org"` 会命中 `www.arxiv.org` |
| `patterns` |  | URL 正则列表（进一步限定页面类型，如只抓详情页）；留空 = 命中域名即可 |
| `steps` | ✓ | 抽取步骤链，按序执行 |
| `transform` |  | 可选 JS 小片段，收尾时对字段做加工（沙箱运行） |

## 步骤（steps）操作符

| op | 参数 | 说明 |
|---|---|---|
| `fetch` | `url`（默认 `{url}`） | GET 页面/接口。`{url}`、`{q}`（自动编码）、`{字段名}` 会插值。响应同时存为文本与 JSON |
| `meta` | `pick`、`as`、`multi`、`re` | 抽 `<meta name=|property=|itemprop="pick">` 的 content；`multi` 收集全部同名字段 |
| `css` | `selector`、`attr`、`as` | CSS 选择器抽 DOM；`attr` 默认 `text`，可为属性名或 `html` |
| `json` | `path`、`as` | 从已 fetch 的 JSON 取点路径，如 `message.title.0` |
| `jsonraw` | `path`、`as` | 同 `json`，但保留原始 JSON 字符串（给 transform 解析复杂结构用） |
| `jsonlist` | `path`、`map`、`rowTransform` | 把 JSON 数组映射成结果列表（search 型脚本核心）；`map` 为 `结果字段: 列表项点路径` |
| `regex` | `from`、`re`、`group`、`as` | 对某字段（默认整个 HTML）跑正则，取第 group 组（默认 1） |
| `template` | `as`、`value` | 模板串插值后写入字段 |
| `download` | `url` | 下载附件并校验 `%PDF` 头；成功后随题录一起入库 |

通用可选参数：`ifEmpty: true` 表示目标字段已有值时不覆盖（meta 优先、css 兜底的回退写法）；`re` 可跟在 meta/css/json 之后做二次提取。

## 字段 → 题录

脚本最终产出的字段会转成标准题录（CSL-JSON）入库：

`title`（必填，没有标题视为失败）、`authors`（逗号分隔）、`year`、`venue`、`doi`、`url`、`abstract`、`volume`、`issue`、`pages`、`publisher`、`itemType`（`journal-article` / `proceedings-article` / `thesis` / `book` 等）、`arxivId`。

入库流程与普通导入一致：内容指纹去重 → AI 自动归类 → PDF（如有）进库可读；无 PDF 时生成题录占位页，拿到原文后替换 `paper.pdf` 即可。

## transform 沙箱

`transform` 在 Node `vm` 沙箱里执行：**没有** `require` / `process` / 网络访问，只有字段对象 `t`，200ms 超时熔断。返回对象会覆盖/新增字段（返回 `null` 值表示删除该字段）：

```json
"transform": "const a = t._authors ? JSON.parse(t._authors) : []\nreturn { authors: a.map(x => x.name || [x.given, x.family].filter(Boolean).join(' ')).join(', ') }"
```

## 检索型脚本（type: "search"）

检索型脚本出现在「在线添加」的关键词检索里，多源并行执行：

```json
{
  "id": "crossref-search",
  "name": "Crossref 检索",
  "type": "search",
  "steps": [
    { "op": "fetch", "url": "https://api.crossref.org/works?query={q}&rows=8" },
    { "op": "jsonlist", "path": "message.items",
      "map": { "title": "title.0", "year": "issued.date-parts.0.0", "venue": "container-title.0", "doi": "DOI", "_authors": "author" },
      "rowTransform": "const a = t._authors ? JSON.parse(t._authors) : []\nreturn { authors: a.map(x => [x.given, x.family].filter(Boolean).join(' ')).join(', ') }" }
  ]
}
```

## 调试建议

1. 复制一个结构相近的内置脚本改 `matches` 起步（多数出版社详情页都带 `citation_*` 元数据，`academic-journals.json` 就是通用模板）。
2. 保存到用户脚本目录后点设置页「重新加载」，或直接在「在线添加」粘贴目标页面 URL 测试。
3. 抓取失败通常有三类原因：需要登录/有验证码、页面是纯客户端渲染（fetch 拿不到内容）、页面结构改版。脚本里每一步失败都不会中断整条链，尽量多写几个回退步骤（配合 `ifEmpty`）。
4. 内置脚本损坏时，删除用户目录同名 `id` 的脚本即可恢复内置版本。

## 与 Zotero Translators 的差异（设计取舍）

Zotero 的 translator 是完整 JS 模块（可写任意逻辑）；CSPAPER 选择「声明式步骤 + 沙箱小片段」：牺牲一点表达力，换来三样东西——普通用户也能写脚本、脚本永远不可能触网或读文件（安全）、坏脚本只影响自己（失败静默降级）。多数出版社详情页和开放 API 用声明式步骤已经足够。
