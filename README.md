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
node test/compat.test.mjs        # 53 项兼容层单测
node test/artifact.test.mjs      #  8 项产物完整性测试
python3 test/e2e.py              # 46 项 Playwright 端到端测试
```

或者 `npm test`（单测 + 产物测试）与 `npm run test:e2e`。

**产物完整性测试**把「单文件 / 离线 / 零外链」这个核心承诺变成可断言的：
检查产物里没有 `src`/`href` 外链、没有 `@import` 规则、没有远程 `url()`、没有外链 script/link，
并确认 ZIP 打包器与 `escapeHtml` 实体表还在。

**端到端测试**全部走真实链路：点真实按钮、接真实下载文件（不是调内部 API），
覆盖首屏渲染、运行期零外部请求、无 console error、编辑重渲染、兼容检出与自动修复、
一键修复写回、22 个样例全部可渲染、**批量导出 SVG 的 ZIP 内容校验**、PNG 导出与深色像素校验、
缩放、分享链接往返、设置写 frontmatter、localStorage、界面主题切换、全屏、Markdown 多图、
**23 个图块时导航条不溢出**、三处折叠与状态持久化、
打开本地 `.md`（多图）、打开老代码 `.mmd`（自动兼容救回且原文不被改写）、超限时的放宽提示。

CI（`.github/workflows/ci.yml`）会跑完上面全部三套；打 tag 时还会自动把构建产物挂到 Release。

### 兼容性说明
Mermaid v12 要求 **ES2024 / Safari 17.4+ / Node 22.12+**。
本项目在 **Chromium 131** 上实测通过（`file://` 协议）。
Safari / Firefox 未在本环境实测，若出现兼容问题优先检查浏览器版本是否满足 v12 的要求。

---

## 给贡献者

这个项目踩过的坑基本都集中在两类：**测试没走到真实链路**，和**本地有、CI 没有的差异**。
下面每一条都对应一次真实事故，改代码前值得扫一眼。

### 一、测试必须走真实链路

前三个 bug（审计发现 9 个缺陷、导出 SVG 崩溃、图块标签号溢出压住侧栏）
**没有一个是被单测发现的**，因为测试都绕开了真正的代码路径：

| 错误做法 | 后果 | 正确做法 |
|---|---|---|
| 用 `exportSvgText()` 测导出 | 它返回原始字符串，绕过了 `serializeSvg()`，真正的导出崩溃测不出来 | 点真实按钮 + 接真实下载文件 |
| 网络监听挂在 `page.goto()` **之后** | 「加载时零请求」这个核心承诺**从来没被验证过** | 监听必须挂在 `goto()` 之前 |
| 只测单图 | 多图 markdown 的 `htmlLabels:false` 传不到图块，PNG 画布被污染 | 用含多个图块的 markdown 测 |
| 断言渲染出的 DOM | 布局溢出、按钮重叠这类问题看不见 | 量 `getBoundingClientRect()`，看有没有压住别的元素 |

写新测试时先问一句：**这条测试如果功能坏了，它真的会红吗？**
改完记得反向验证一次——把代码临时改回旧行为，确认测试确实报红。

### 二、本地有、CI 没有的依赖 = 隐性雷

PNG 深色像素检查原本用 Pillow，本地装了、CI 没装，CI 第一次跑就挂在
`ModuleNotFoundError: No module named 'PIL'`。

现在 e2e **零 Python 第三方依赖**（PNG 解码自己写在 `test/pngread.py`，
有 Pillow 时优先用它，两者结果实测一致）。
新增依赖前先想清楚：CI 上装得起来吗？本地装了不代表 CI 有。

### 三、别用 `git reset --hard` 冲掉未提交的改动

有一次为了同步远端分支跑了 `git reset --hard`，把工作区里**已经改好但还没提交**的
`test/e2e.py` 冲没了，导致 CI 连续挂了两轮才发现。

改完代码**先提交再 reset**。要同步远端用 `git pull --rebase` 或 `git fetch` + `git reset --soft`。

### 四、mermaid v12 的几个 API 陷阱

写代码时直接踩过：

- **`mermaid.render()` 返回的是字符串，不是 DOM 元素。**
  对它调 `cloneNode()` 会抛 `TypeError: i.cloneNode is not a function`。
- **mermaid 的 frontmatter 必须紧贴图源码前面。**
  markdown 里用 `extractBlocks` 只取 ```mermaid 围栏内的内容，
  文档顶部的 frontmatter 不在任何一个围栏里，会被**整体丢掉** →
  逐图块的 config（尤其 `htmlLabels:false`）到不了图块上。
  所以配置要**逐块重新套用**：文档级 `config` 作默认，块内 frontmatter 优先。
- **SVG 元素没有 `offsetTop` / `offsetLeft`**（那是 HTMLElement 专有的）。
  要拿图在图层里的位置，得用父级容器的 offset + 相对位移 ÷ 当前缩放。
- 标签里的中文引号 `“”`、全角冒号 `：` 是**合法**的，别乱改；
  真正会炸的是全角 `【】` 和 `（）`，且只在方括号外。

### 五、浏览器的下载上限

**Chromium 对「一次性触发的多个下载」有 10 个的硬上限**
（`DownloadRequestLimiter::kMaxDownloadsAtOnce`），超出部分被静默丢弃，连报错都没有。

所以多文件导出必须**打包成一个 ZIP 一次下载**，不能发 N 次下载。
ZIP 打包器是自己写的（STORE 模式，约 90 行，无外部依赖），别退化回逐个下载。

### 六、构建是可复现的

CI 从干净检出独立构建的产物，与本地构建 **sha256 完全一致**。
这意味着：CI 跑绿了就等于能发版，产物不需要手工传。

顺带一个坑：`actions/upload-artifact` 会压缩，
所以 artifact 显示的大小和原始文件大小对不上，**要解包再比 sha256**。

### 七、几条约定

- 提交信息用中文，说清「改了什么」和「为什么」，别只写「修复 bug」。
- 改了 `src/` 就要跑一遍全部三套测试；改了构建流程要确认产物 sha256 没变。
- 别把 `node_modules/`、`vendor/`、`output/`、`__pycache__/` 提交进去（`.gitignore` 已处理）。

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
│   ├── compat.test.mjs       # 兼容层单测（53 项）
│   ├── artifact.test.mjs     # 产物完整性测试（8 项）
│   ├── e2e.py                # 端到端测试（46 项）
│   └── pngread.py            # 纯标准库 PNG 解码（e2e 用，零依赖）
├── .github/workflows/
│   └── ci.yml                # CI：测试 + 构建 + 自动挂 Release
└── output/
    └── mermaid-local-editor.html
```

---

## 已知边界

- **云端功能未实现**（Mermaid Chart 账号、在线分享到 mermaid.live、Kroki/Analytics 上报）——
  本工具的定位就是纯本地，这些功能没有意义。
- **多图导出会打包成 ZIP**，不是散装的一堆文件——Chromium 对一次性触发的多个下载有 10 个硬上限
  （详见「给贡献者」一节）。单图仍是直出 `.svg` / `.png`。
- **分享链接只能在同一台机器上还原**：链接把代码塞进 URL hash，跨设备分享需要先把 HTML 一起传过去。
- `sankey-beta` 的节点名在 v12 仍不支持中文（上游限制，兼容层会提前警告）。
- **未在 Safari / Firefox 实测**：Mermaid v12 要求 ES2024 / Safari 17.4+，
  代码本身没用到 Chromium 专属 API，但没条件跑跨浏览器验证。
- **图块导航在超窄窗口会先滚动再换行**：窗口小于约 700px 时预览区太窄，
  导航条会占掉较多垂直空间，这时建议直接收起侧栏。
