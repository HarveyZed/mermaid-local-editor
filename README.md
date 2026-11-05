# Mermaid Local · 单文件离线 Mermaid v12 编辑器

一个**单文件、便携、纯离线**的 Mermaid 编辑器，功能对标官方 [mermaid.live](https://mermaid.live/edit)，
额外内置了**语法自动兼容层**，让旧版本（v8 ~ v11）的图表代码粘进来也能直接渲染。

产物：`output/mermaid-local-editor.html`（约 5.85 MB，**双击即可用**，无需安装、无需服务器、无需联网）。

> **直接下载成品**：前往 [Releases](https://github.com/HarveyZed/mermaid-local-editor/releases) 下载
> `mermaid-local-editor.html`，双击即可使用。仓库里只放源码，产物不进 git 历史。

License: [MIT](LICENSE)

---

## 为什么需要它

官方 mermaid.live 在国内访问慢，而且：

- Mermaid v12 改了三个默认开关（`layout` → ELK、`theme` → redux-color、`look` → neo），
  老代码粘进去虽然还能渲染，但**样式和布局全变了**；
- v12 删掉了 `defaultRenderer` 配置项，老的 frontmatter **不报错但静默失效**，是最容易踩的坑。

本工具把 Mermaid 12.3.0（含 ELK 布局引擎）整个塞进一个 HTML 文件，
再叠一层兼容层来兜住这些坑。

---

## 功能清单

### 编辑与预览
- 左侧 CodeMirror 6 编辑器，带 Mermaid 语法高亮、行号、自动补全、`Ctrl+F` 搜索
- 右侧实时预览（防抖 260ms），可**拖拽平移 / 滚轮缩放**，带缩放、适应窗口、重置按钮
- 顶部「全屏」进入纯净预览模式
- Markdown 多图：打开含 ```mermaid 代码块的 `.md` 时，预览按顺序渲染全部图表，
  预览区顶部有独立的**图块导航条**（`#1 #2 …`）——挤不下自动换行，最多 3 行后转为滚动，绝不溢出压住侧栏
- 点图块导航会**按该图自身尺寸适应并居中**（多图时不会被最宽的那张图拖成看不清的小缩放）
- **三处可折叠**：顶栏（`⌃`）、图块导航条（`23 图块 ▾`）、侧栏（`›`）。
  折叠状态存 localStorage，刷新后保留
- 顶栏与标题栏自适应：窗口不够宽时按钮组自动换行，不产生横向滚动条

### 容错
- 渲染失败时给出**中文解释 + 出错行号 + 一键跳转到出错行**
- 超出 mermaid 的 `maxEdges`(500) / `maxTextSize`(50000) 上限时，会识别出「错误图伪装成正常图」的情况，
  并提供「放宽上限并重试」按钮（上限是安全配置，不能写在图里，只能在运行时放开）
- 空文档给出友好提示；任意非法输入都不会白屏

### 导入导出
- **PNG**（2x，自动以 `htmlLabels:false` 重渲染一版，保证中文文字真的画进位图；多图同样打包成 `.zip`）
- **SVG**（单图直出 `.svg`；多图打包成一个 `.zip`，内含 `名称-1.svg`…——浏览器对"一次触发多个下载"有 10 个的硬上限，打包才不会被截断）
- 复制 SVG 到剪贴板
- 保存 `.mmd` / `.md`
- 分享链接：代码经 pako 压缩后进 URL hash，刷新即可还原（可离线使用）

### 设置
- 外观预设：`v12 默认` / `经典 v11` / `暗色` / `手绘`
- 逐项覆盖 `theme` / `look` / `layout` / 字体 / `securityLevel` / `useMaxWidth` / `htmlLabels`，
  全部写回源码的 frontmatter（所见即所得，导出的 `.mmd` 自带配置）
- 界面深/浅色切换
- 自动保存到 `localStorage`，关页面不丢

### 语法自动兼容层（核心差异点）
渲染前自动分析代码，检出问题后自动修复（可在顶栏一键关掉），并在右侧「兼容」面板列出
**问题 + 行号 + 规则 + 修改前后 diff**，每条都能单独修复。

已实现的规则：

| 规则 | 级别 | 说明 |
|---|---|---|
| `default-renderer` | 错误 | `defaultRenderer` 在 v12 已移除，迁移为 `layout: dagre/elk` |
| `keyword-alias` | 错误 | `swimlanes` → `swimlane-beta`、`usecase` → `usecase-beta`、`flowchart-v2` → `flowchart` 等 |
| `unknown-keyword` | 错误 | 首行关键字不是合法图类型时给出可选清单 |
| `fullwidth-punct` | 错误 | `【】` `""` `：` 等全角标点转半角（否则直接 Lexical error） |
| `missing-end` / `extra-end` | 错误 | `subgraph` 与 `end` 数量不匹配 |
| `sankey-cjk` | 错误 | v12 的 `sankey-beta` 节点名不支持中日韩文字 |
| `init-directive` | 提示 | `%%{init:{...}}%%` 可一键迁移到 frontmatter 的 `config` 段 |
| `unclosed-label` | 建议 | 标签方括号未闭合 |

> 只有标了「可自动修」的规则才会被自动改写；其余一律只提示。
> 这是刻意的：多余的 `end`、未闭合标签、未知关键字这类情况，**猜错比不改更糟**。
>
> 全角标点规则只在**方括号之外**生效，且**不碰中文引号和全角冒号** —— 因为实测
> `A[开始：结束]`、`A[他说"你好"]`（中文引号）在 v12 下本来就是合法的，
> 乱改反而会把能渲染的代码改成语法错误。真正会炸的是全角 `【】` 和 `（）`。

**渲染时用修复后的代码，编辑器里保留你的原文**，所以「写回编辑器」是可选项，不会偷偷改你的代码。

### 脚本 API
控制台可用 `window.__lme`：

```js
__lme.getCode()                 // 取当前代码
__lme.setCode('flowchart TD\n A-->B')
__lme.render()
__lme.analyze(code)             // 只分析，返回问题列表
__lme.migrate(code)             // 返回 { code, applied }
__lme.exportSvgText()           // Promise<string>，导出用 SVG（无 foreignObject）
__lme.exportPngBlob(2)          // Promise<Blob>，2x PNG
__lme.samples                   // 22 个内置样例
__lme.version                   // '12.3.0'
```

---

## 构建

```bash
npm install
npm run build          # → output/mermaid-local-editor.html
```

构建脚本做的事：
1. 用 esbuild 把 `src/app.js` + CodeMirror 6 + yaml + pako 打成一个 IIFE
2. 读取 npm 上的 `mermaid@12.3.0` 包，取官方 `dist/mermaid.min.js`（已内含 ELK）
3. 把 CSS / mermaid / app 三段全部内联进 `src/index.html` 模板，产出单个 HTML

> v12 的 ESM 构建是分包的，浏览器直连 CDN 在部分网络下不可用；
> 官方 IIFE 构建 `mermaid.min.js` 已把 ELK 全部内联，因此可以完全离线、且能直接 `file://` 打开。

## 测试

```bash
node test/compat.test.mjs        # 34 项兼容层单测
python3 test/e2e.py              # 19 项 Playwright 端到端测试
```

e2e 覆盖（23 项）：首屏渲染、运行期零外部请求、无 console error、编辑重渲染、兼容检出与自动修复、
一键修复写回、22 个样例全部可渲染、SVG/PNG 导出合法性、缩放、分享链接往返、
设置写 frontmatter、localStorage、界面主题切换、全屏、Markdown 多图、
打开本地 `.md`（多图）、打开老代码 `.mmd`（自动兼容救回且原文不被改写）、超限时的放宽提示。

### 兼容性说明
Mermaid v12 要求 **ES2024 / Safari 17.4+ / Node 22.12+**。
本项目在 **Chromium 131** 上实测通过（`file://` 协议）。
Safari / Firefox 未在本环境实测，若出现兼容问题优先检查浏览器版本是否满足 v12 的要求。

---

## 独立审计

v1.0.0 之后做了一轮**独立对抗性审计**（换一个 agent 专门找这个产物的毛病），发现 9 个缺陷并全部修复，
见 [v1.0.1 修复清单](CHANGELOG.md#v101--审计修复)。

关键几条：

| 缺陷 | 现象 | 修复 |
|---|---|---|
| `escapeHtml` 映射表写错 | 兼容面板把 `<b>` 当成真实标签注入 DOM | 换成标准 5 字符实体表 |
| 单图 markdown 完全渲染不了 | `.md` 里只有 1 个 mermaid 块时整篇被当 mermaid 源码 | `found.length > 1` → `>= 1` |
| 用字符串查找定位改写 | `%% 注释` 里复述节点定义时，修复落到注释行 | 改用行索引定位，并校验该行内容仍是规则看到的那行 |
| 兼容层改写 markdown 散文 | `# 说明【重要】` 被改成 `# 说明["重要"]` | 兼容层只分析 ```mermaid 围栏内的代码 |
| 时序图误报「多出 end」 | `alt/end` 被当成 subgraph 的 end | 该规则只对 flowchart / swimlane 启用 |
| 补 end 落在文档末尾 | 污染后续图块 | 插到对应 subgraph 的闭合位置 |

---

## 目录

```
lme/
├── build.mjs              # 打包脚本（esbuild + 内联）
├── src/
│   ├── index.html         # 页面骨架（内联模板）
│   ├── styles.css         # 样式
│   ├── app.js             # 主逻辑
│   ├── compat.js          # 语法兼容层（纯函数，可单测）
│   ├── highlight.js       # CodeMirror 的 Mermaid 语言模式
│   └── samples.js         # 22 个 v12 语法样例
├── test/
│   ├── compat.test.mjs
│   └── e2e.py
└── output/
    └── mermaid-local-editor.html
```

---

## 已知边界

- **云端功能未实现**（Mermaid Chart 账号、在线分享到 mermaid.live、Kroki/Analytics 上报）——
  本工具的定位就是纯本地，这些功能没有意义。
- **PNG 仅支持单图**：多图模式（`.md`）下 PNG 只导出第 1 张；SVG 会按序号分别导出。
- **分享链接只能在同一台机器上还原**：链接把代码塞进 URL hash，跨设备分享需要先把 HTML 一起传过去。
- `sankey-beta` 的节点名在 v12 仍不支持中文（上游限制，兼容层会提前警告）。
