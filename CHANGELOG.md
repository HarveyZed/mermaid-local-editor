# Changelog

## v1.0.2 — 批量导出 SVG 崩溃修复

用户实测反馈：导入含多个 mermaid 代码块的 `.md` 后，批量导出 SVG 报
`TypeError: i.cloneNode is not a function`。查下来是**两个**叠在一起的问题。

### 1. `serializeSvg` 把字符串当 DOM 节点用（直接崩）

mermaid v12 的 `render()` 返回的是**字符串**，不是 DOM 元素，而 `serializeSvg()`
无条件对它调 `svg.cloneNode(true)` → 字符串上没有这个方法 → 直接抛错。

- 影响面：**「导出 SVG」按钮和「复制 SVG」两个功能全废**（不只是批量，单图也一样崩）。
- 根因能溜过去，是因为测试只调了 `window.__lme.exportSvgText()`——那条路径返回的是
  原始字符串，绕过了 `serializeSvg`。**真实的下载链路从来没被测过。**
- 修复：`serializeSvg()` 现在字符串和 DOM 元素都兼容（字符串走 DOMParser 解析后再序列化）。

### 2. `htmlLabels:false` 传不到 markdown 的图块（导出的 SVG 带 foreignObject）

`renderForExport()` 原本是「读文档级 frontmatter → 把配置写回文档顶部 → 抽图块」。
问题在于 **markdown 里 `extractBlocks` 只取 ```mermaid 围栏内的内容，文档顶部的
frontmatter 不在任何一个围栏里，直接被丢掉** —— 于是每个图块都没拿到 `htmlLabels:false`。

后果：
- 导出的 SVG 带 `foreignObject`，文字依赖宿主 HTML/CSS，单独打开不完整；
- **PNG 导出的画布被污染**，`canvas.toBlob()` 抛 `SecurityError: Tainted canvases may not be exported`，
  整个导出流程直接失败。

修复：配置**逐块重新套用**——文档级 `config` 作默认，块内自带 frontmatter 优先，
`htmlLabels:false` 强制关闭。预览渲染路径也一并统一（之前文档顶部的 `theme` 对
markdown 图块也是失效的，现在生效了）。

### 顺带

- 移除死代码 `currentSvgElements()`（无引用，且它指向的是一条已经不存在的 DOM 元素路径）。
- `exportSvgText()` 原本用 `'\n'` 拼接多个 SVG 根节点——多个 `<svg>` 拼一份不是合法 XML。
  改为返回第一张图，并新增 `exportSvgDocs()` 返回每张图独立的合法 XML。

### 测试

端到端测试 26 → **33** 项。新增的 7 项**点真实按钮、接真实下载文件**，而不是调内部 API：

- 批量导出 SVG 不报错、产出多个文件、文件名按序号区分
- 每个导出文件都是合法单根 XML、带 XML 声明与 `xmlns:xlink`
- 导出的 SVG 不含 `foreignObject`
- markdown 多块导出 PNG 不被画布污染
- 复制 SVG 写入剪贴板的是合法单根 SVG

**先验证测试确实能抓住 bug**：把源码临时换回修复前的版本重跑，
新测试如期报红（`导出失败：TypeError: i.cloneNode is not a function`），再恢复修复版转绿。

## v1.0.1 — 审计修复

一轮独立对抗性审计（由另一个 agent 专门找本产物的毛病）发现 9 个缺陷，本次全部修复。
审计脚本复跑确认：9 条缺陷检查全部由「缺陷存在」翻转为「缺陷已修复」。

### 阻断交付级

- **D-2 `escapeHtml` 根本没转义**（`src/app.js`）
  映射表写成了 `&`→`&`、`<`→`<`、实体名丢失，导致粘贴含 `<b>` 的代码时兼容面板/错误卡片
  会注入真实 DOM 元素。改为标准 5 字符实体表（`&amp;` `&lt;` `&gt;` `&quot;` `&#39;`）。

- **D-3 单个 mermaid 块的 markdown 完全渲染不了**（`src/app.js`）
  `extractBlocks` 判定条件是 `found.length > 1`，只有一个图块时整篇 markdown 被当作 mermaid 源码解析，
  直接报「没有匹配到图类型」。改为 `>= 1`。

- **D-4 字符串查找定位导致改错行**（`src/compat.js` / `src/app.js`）
  `code.indexOf(before)` 不做行边界匹配。`%%   A【x】 --> B` 这种注释里复述节点定义（很常见）
  会让修复落到注释行，真正的问题行没被改，而界面提示「已自动兼容」——图还是渲染失败。
  改为**行索引定位**，并在改写前校验该行内容仍与规则看到的一致；改写从后往前进行，避免行号偏移。

### 同批修复

- **D-5「整理缩进」破坏 markdown 代码围栏**（`src/app.js`）
  闭合的 ` ``` ` 被缩进后不再是围栏。改为只对 ```mermaid 围栏内的代码重排缩进，围栏与散文逐字保留。

- **D-6 合法 `sequenceDiagram` 被误报「多出 end」**（`src/compat.js`）
  `alt/else/loop/opt/par` 块同样用 `end` 收尾，被当成了 subgraph 的 `end`。
  该规则改为只对 flowchart / swimlane 启用；`extra-end` 降级为「建议」级且永不自动删除。

- **D-7 `sankey-beta` 中文节点名在首行是注释时漏检**（`src/compat.js`）
  `lines.find(l => l.trim())` 取的是第一个非空行，没跳过 `%%` 注释。改用 `firstMeaningfulLine()`。

- **D-8 补出的 `end` 落在整个文档末尾**（`src/compat.js`）
  会污染后续图块。改为按 subgraph 的缩进层级，找到内容结束位置插入。

- **R-5 兼容层改写 markdown 散文**（`src/compat.js`）
  `# 说明【重要】` 会被改成 `# 说明["重要"]`。兼容层现在只分析 ```mermaid 围栏内的代码，
  块外原文一个字都不动。

### 次要

- **D-9 超大图产生 NaN 几何时不再塞坏 SVG 进预览区**（`src/app.js`）
  检测几何属性里的 NaN（只看 transform/坐标/尺寸，**不看颜色**——象限图的
  `hsl(240, 100%, NaN%)` 是 mermaid 上游的配色 bug，不影响图形），给出可操作提示。

- **D-10 导出 SVG 补上 XML 声明与 `xmlns:xlink`**（`src/app.js`）
  `serializeSvg()` 之前是死代码，现在导出路径真正走它。

- **D-11 `extra-end` 的 `removeEnd` 字段未实现**（`src/compat.js`）
  字段已移除；多余 `end` 只提示、由用户手动处理（自动删 `end` 猜错的风险更高）。

### 测试

- 单元测试 34 → **53** 项
- 端到端测试 23 → **26** 项
- 修正了 e2e 的一个真盲区：网络监听原先挂在 `page.goto()` **之后**，
  导致「加载时零网络请求」这个核心承诺从未被真正验证过。现已前置。
- PNG 导出现在做**深色像素差分**（有文字 vs 无文字），不再只校验 magic bytes。

## v1.0.0 — 首个版本

单文件离线 Mermaid v12 编辑器。
