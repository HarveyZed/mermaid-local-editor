import YAML from 'yaml';

/**
 * compat.js — Mermaid v12 语法兼容层
 *
 * 目标：让从旧版本 Mermaid（v8 ~ v11）复制来的图表代码，在 v12 渲染器下
 *   1) 不因为配置项被移除而悄悄失效（defaultRenderer -> layout）
 *   2) 不因为关键字改名而直接报错（swimlanes -> swimlane-beta 等）
 *   3) 不因为中文全角标点而解析失败（【】 / “” / ，）
 *   4) 结构小错（subgraph 少 end 等）能被定位并一键修复
 *
 * 设计原则：
 *   - 纯函数，无副作用，便于单测
 *   - 每条规则都标注 severity：'error' 必修 / 'warn' 建议 / 'info' 现代化
 *   - 迁移只做「语义等价」的改写，不猜用户意图
 */

// ---------------------------------------------------------------------------
// v12 已注册的图类型关键字（来自 mermaid v12 的 detectType 实测结果）
// ---------------------------------------------------------------------------
export const DIAGRAM_TYPES = [
  { kw: 'flowchart', type: 'flowchart', label: '流程图' },
  { kw: 'graph', type: 'flowchart', label: '流程图', legacy: true },
  { kw: 'sequenceDiagram', type: 'sequence', label: '时序图' },
  { kw: 'classDiagram', type: 'classDiagram', label: '类图' },
  { kw: 'stateDiagram', type: 'stateDiagram', label: '状态图' },
  { kw: 'stateDiagram-v2', type: 'stateDiagram', label: '状态图', legacy: true },
  { kw: 'erDiagram', type: 'er', label: '实体关系图' },
  { kw: 'gantt', type: 'gantt', label: '甘特图' },
  { kw: 'pie', type: 'pie', label: '饼图' },
  { kw: 'journey', type: 'journey', label: '用户旅程图' },
  { kw: 'gitGraph', type: 'gitGraph', label: 'Git 流程图' },
  { kw: 'mindmap', type: 'mindmap', label: '思维导图' },
  { kw: 'timeline', type: 'timeline', label: '时间线' },
  { kw: 'quadrantChart', type: 'quadrantChart', label: '象限图' },
  { kw: 'requirementDiagram', type: 'requirement', label: '需求图' },
  { kw: 'C4Context', type: 'c4', label: 'C4 上下文图' },
  { kw: 'C4Container', type: 'c4', label: 'C4 容器图' },
  { kw: 'C4Component', type: 'c4', label: 'C4 组件图' },
  { kw: 'C4Dynamic', type: 'c4', label: 'C4 动态图' },
  { kw: 'block-beta', type: 'block', label: '块图' },
  { kw: 'architecture-beta', type: 'architecture', label: '架构图' },
  { kw: 'xychart-beta', type: 'xychart', label: 'XY 图表' },
  { kw: 'sankey-beta', type: 'sankey', label: '桑基图' },
  { kw: 'packet-beta', type: 'packet', label: '数据包图' },
  { kw: 'kanban', type: 'kanban', label: '看板' },
  { kw: 'treemap', type: 'treemap', label: '矩形树图' },
  { kw: 'radar-beta', type: 'radar', label: '雷达图' },
  { kw: 'ishikawa-beta', type: 'ishikawa', label: '鱼骨图' },
  { kw: 'venn-beta', type: 'venn', label: '韦恩图' },
  { kw: 'wardley-beta', type: 'wardley', label: '沃德利地图' },
  { kw: 'cynefin-beta', type: 'cynefin', label: 'Cynefin 框架' },
  { kw: 'railroad-beta', type: 'railroad', label: '铁路图' },
  { kw: 'swimlane-beta', type: 'swimlane', label: '泳道图' },
  { kw: 'usecase-beta', type: 'usecase', label: '用例图' },
];

/** 关键字别名 -> 正确关键字（旧版本/常见误写） */
export const KEYWORD_ALIASES = {
  swimlanes: 'swimlane-beta',
  swimlane: 'swimlane-beta',
  'swimlane-v2': 'swimlane-beta',
  usecase: 'usecase-beta',
  useCase: 'usecase-beta',
  usecaseDiagram: 'usecase-beta',
  'use-case': 'usecase-beta',
  'flowchart-v2': 'flowchart',
  neoflowchart: 'flowchart',
  graph: 'flowchart',
  'xychart': 'xychart-beta',
  'sankey': 'sankey-beta',
  'packet': 'packet-beta',
  'radar': 'radar-beta',
  'ishikawa': 'ishikawa-beta',
  'venn': 'venn-beta',
  'wardley': 'wardley-beta',
  'cynefin': 'cynefin-beta',
  'railroad': 'railroad-beta',
  'architecture': 'architecture-beta',
  block: 'block-beta',
};

// ---------------------------------------------------------------------------
// frontmatter 拆解
// ---------------------------------------------------------------------------

/**
 * 把源码切成 { frontmatter, body, offset }。
 * frontmatter 为空时 frontmatter = ''，body 为整段源码。
 */
export function splitFrontmatter(src) {
  const text = src.replace(/^\uFEFF/, '');
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { frontmatter: '', body: text, bodyStart: 0 };
  return {
    frontmatter: m[1],
    body: text.slice(m[0].length),
    bodyStart: m[0].length,
  };
}

/** 源码行数组（去掉 BOM） */
export function toLines(src) {
  return src.replace(/^\uFEFF/, '').split(/\r?\n/);
}

/** 在 body 中找到第一段「有内容的行」（跳过空行与 %% 注释） */
function firstMeaningfulLine(body) {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t || t.startsWith('%%')) continue;
    return { text: t, index: i };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 规则实现：每条规则返回 { line, rule, severity, message, before, after }
// ---------------------------------------------------------------------------

/**
 * R1: defaultRenderer 已被 v12 移除，需要迁移成 layout。
 * 这是最「阴险」的一类：旧配置写了不报错，但完全不生效。
 */
function ruleDefaultRenderer(src) {
  const out = [];
  const lines = toLines(src);
  lines.forEach((line, i) => {
    const m = /^(\s*)defaultRenderer\s*:\s*(['"]?)([A-Za-z0-9_\-]+)\2\s*$/.exec(line);
    if (!m) return;
    const [, indent, , value] = m;
    const layout = value === 'elk' ? 'elk' : 'dagre';
    out.push({
      line: i + 1,
      rule: 'default-renderer',
      severity: 'error',
      auto: true,
      message: `defaultRenderer 在 v12 已移除，配置会被静默忽略。应改为 layout: ${layout}`,
      before: line,
      after: `${indent}layout: ${layout}`,
    });
  });
  return out;
}

/**
 * 解析 %%{init: {...}}%% 里的对象字面量。
 * 官方写法是 Python 风格（单引号），这里容错处理。
 */
function parseInitObject(text) {
  const t = text.trim();
  const attempts = [t, t.replace(/'/g, '"')];
  for (const a of attempts) {
    try {
      const v = JSON.parse(a);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* 试下一种 */ }
  }
  // 退一步：解析 "key: value" 形式
  const obj = {};
  const re = /['"]?([\w.$-]+)['"]?\s*:\s*('[^']*'|"[^"]*"|[^,}]+)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    let v = m[2].trim();
    if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (/^".*"$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    obj[m[1]] = v;
  }
  return Object.keys(obj).length ? obj : null;
}

/**
 * 把 %%{init: {...}}%% 整段迁移到 frontmatter 的 config 段。
 * 这是文档级变换，单独处理。
 */
export function migrateInitDirective(src) {
  // 行号必须基于 body（不含 frontmatter），否则带 frontmatter 时会删错行
  const { frontmatter, body } = splitFrontmatter(src);
  const bodyLines = toLines(body);
  const hits = [];
  bodyLines.forEach((line, i) => {
    const m = /^\s*%%\{\s*init\s*:\s*(.+?)\s*\}%%\s*$/.exec(line);
    if (m) hits.push({ index: i, raw: m[1], text: line });
  });
  if (!hits.length) return { code: src, applied: [] };

  const merged = {};
  hits.forEach((h) => {
    const obj = parseInitObject(h.raw);
    if (obj) Object.assign(merged, obj);
  });
  if (!Object.keys(merged).length) return { code: src, applied: [] };

  let doc = {};
  if (frontmatter.trim()) {
    try {
      const parsed = YAML.parse(frontmatter);
      if (parsed && typeof parsed === 'object') doc = parsed;
    } catch { doc = {}; }
  }
  doc.config = { ...(doc.config || {}), ...merged };

  const yamlText = YAML.stringify(doc, { lineWidth: 0 }).trimEnd();
  hits.forEach((h) => { bodyLines[h.index] = null; });

  const newBody = bodyLines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  const out = `---\n${yamlText}\n---\n${newBody.replace(/^\n+/, '')}`;
  return {
    code: out,
    applied: [{
      rule: 'init-directive',
      severity: 'info',
      auto: false,
      message: '%%{init:...}%% 已迁移到 frontmatter 的 config 段',
      before: hits.map((h) => h.text).join(' | '),
      after: `config: ${JSON.stringify(merged)}`,
    }],
  };
}

/**
 * R2: %%{init: ...}%% 旧指令 -> frontmatter config
 * 仍能跑，但 v12 推荐 frontmatter；转换后可读性更好。
 */
function ruleInitDirective(src) {
  const out = [];
  const { body } = splitFrontmatter(src);
  const lines = toLines(body);
  lines.forEach((line, i) => {
    const m = /^\s*%%\{\s*init\s*:\s*(.+?)\s*\}%%\s*$/.exec(line);
    if (!m) return;
    out.push({
      line: i + 1,
      rule: 'init-directive',
      severity: 'info',
      auto: false,
      message: '%%{init:...}%% 指令仍可用，但 v12 推荐改用 frontmatter 的 config 段（可一键迁移）',
      before: line,
      after: null,
      initDirective: true,
    });
  });
  return out;
}

/**
 * R3: 关键字别名 / 误写
 */
function ruleKeyword(src) {
  const out = [];
  const { body } = splitFrontmatter(src);
  const first = firstMeaningfulLine(body);
  if (!first) return out;
  const line = first.text;
  const m = /^([A-Za-z][A-Za-z0-9\-_]*)(\s|$)/.exec(line);
  if (!m) return out;
  const kw = m[1];
  const known = DIAGRAM_TYPES.some((d) => d.kw === kw);
  if (known) return out;
  const alias = KEYWORD_ALIASES[kw];
  if (!alias) {
    out.push({
      line: 0,
      rule: 'unknown-keyword',
      severity: 'error',
      auto: false,
      message: `无法识别的图类型关键字「${kw}」。可用：${DIAGRAM_TYPES.filter((d) => !d.legacy).slice(0, 8).map((d) => d.kw).join(' / ')} …`,
      before: null,
      after: null,
    });
    return out;
  }
  out.push({
    line: 0,
    rule: 'keyword-alias',
    severity: 'error',
    auto: true,
    message: `「${kw}」在 v12 中不是有效关键字，应改为「${alias}」`,
    before: kw,
    after: alias,
    keyword: true,
  });
  return out;
}

/**
 * R4: 中文全角标点导致的词法错误
 *
 * 实测（mermaid 12.3.0）：
 *   A【开始】 --> B        ✗ Lexical error   —— 全角方括号当节点形状
 *   A[文本] --> B（注释）  ✗ Lexical error   —— 全角圆括号当节点形状
 *   A[“开始”] --> B        ✓ 合法（中文引号在方括号内没问题）
 *   A[开始：结束] --> B     ✓ 合法（全角冒号在方括号内没问题）
 *   A[开始(测试)] --> B     ✗ 括号内不能再出现圆括号
 *
 * 所以规则必须**只动方括号之外**的字符，且**绝不碰中文引号和全角冒号**，
 * 否则会把本来能渲染的代码改成语法错误。
 */
function ruleFullwidthPunct(src) {
  const out = [];
  const lines = toLines(src);
  lines.forEach((line, i) => {
    if (/^\s*%%/.test(line)) return;
    if (!/[【（]/.test(line)) return;

    let after = '';
    let depth = 0; // 方括号深度：括号内部一律原样保留
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '[') depth += 1;
      else if (ch === ']') depth = Math.max(0, depth - 1);

      if (depth > 0) {
        after += ch;
        continue;
      }
      if (ch === '【') {
        const close = line.indexOf('】', j);
        if (close !== -1) {
          const inner = line.slice(j + 1, close).replace(/"/g, "'");
          after += `["${inner}"]`;
          j = close;
          continue;
        }
      }
      if (ch === '（') { after += '('; continue; }
      if (ch === '）') { after += ')'; continue; }
      after += ch;
    }

    if (after !== line) {
      out.push({
        line: i + 1,
        rule: 'fullwidth-punct',
        severity: 'error',
        auto: true,
        message: '全角方括号/圆括号（【】/（））会导致词法错误，已转成半角',
        before: line,
        after,
      });
    }
  });
  return out;
}

/**
 * R5: flowchart / state 里的 subgraph 与 end 数量不匹配
 */
function ruleSubgraphEnd(src) {
  const out = [];
  const { body } = splitFrontmatter(src);
  const lines = body.split(/\r?\n/);
  let opens = 0;
  let closes = 0;
  const openLines = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('%%')) return;
    if (/^subgraph\b/.test(t)) {
      opens += 1;
      openLines.push(i);
    } else if (/^end\b\s*$/.test(t)) {
      closes += 1;
    }
  });
  if (opens > closes) {
    out.push({
      line: openLines[openLines.length - 1] + 1,
      rule: 'missing-end',
      severity: 'error',
      auto: true,
      message: `有 ${opens} 个 subgraph 但只有 ${closes} 个 end，缺少 ${opens - closes} 个 end`,
      before: null,
      after: null,
      appendEnd: opens - closes,
    });
  } else if (closes > opens) {
    out.push({
      line: 0,
      rule: 'extra-end',
      severity: 'error',
      auto: false,
      message: `有 ${closes} 个 end 但只有 ${opens} 个 subgraph，多出 ${closes - opens} 个 end`,
      before: null,
      after: null,
      removeEnd: closes - opens,
    });
  }
  return out;
}

/**
 * R6: sankey-beta 的节点名不支持中文（v12 实测：非 ASCII 会直接 Lexical error）
 */
function ruleSankeyCjk(src) {
  const out = [];
  const { body } = splitFrontmatter(src);
  const lines = body.split(/\r?\n/);
  if (!/^\s*sankey(-beta)?\b/.test(lines.find((l) => l.trim()) || '')) return out;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('%%')) return;
    if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(t)) {
      out.push({
        line: i + 1,
        rule: 'sankey-cjk',
        severity: 'error',
        auto: false,
        message: 'sankey-beta 的节点名目前不支持中文/日文/韩文，请改用英文或拼音',
        before: t,
        after: null,
      });
    }
  });
  return out;
}

/**
 * R7: 明显写成 flowchart 的 body 却用了 stateDiagram 专属语法等交叉错误
 * 这里只做一类最常见的：ER 图里写成 `||--o{` 但缺实体名。
 */
function ruleLooseEnds(src) {
  const out = [];
  const lines = toLines(src);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('%%')) return;
    // 节点标签未闭合： A[文本  --> B
    const m = /^[A-Za-z0-9_一-龥]+(\[[^\]]*)$/.exec(t);
    if (m) {
      out.push({
        line: i + 1,
        rule: 'unclosed-label',
        severity: 'warn',
        auto: false,
        message: '方括号标签没有闭合，确认是否漏了 ]',
        before: line,
        after: `${line}]`,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

const RULES = [ruleDefaultRenderer, ruleInitDirective, ruleKeyword, ruleFullwidthPunct, ruleSubgraphEnd, ruleSankeyCjk, ruleLooseEnds];

/** 只做检测，不改代码 */
export function analyze(src) {
  const issues = [];
  for (const rule of RULES) {
    try {
      issues.push(...rule(src));
    } catch {
      /* 单条规则失败不影响整体 */
    }
  }
  issues.sort((a, b) => (a.line || 0) - (b.line || 0));
  const type = detectType(src);
  return {
    type,
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
  };
}

/** 识别图类型 */
export function detectType(src) {
  const { body } = splitFrontmatter(src);
  const first = firstMeaningfulLine(body);
  if (!first) return { kw: null, type: null, label: null };
  const m = /^([A-Za-z][A-Za-z0-9\-_]*)/.exec(first.text);
  if (!m) return { kw: null, type: null, label: null };
  const kw = m[1];
  const hit = DIAGRAM_TYPES.find((d) => d.kw === kw);
  if (hit) return { kw, type: hit.type, label: hit.label, legacy: !!hit.legacy };
  const alias = KEYWORD_ALIASES[kw];
  if (alias) {
    const t = DIAGRAM_TYPES.find((d) => d.kw === alias);
    return { kw, type: t ? t.type : null, label: t ? t.label : null, aliasOf: alias, legacy: true };
  }
  return { kw, type: null, label: null, unknown: true };
}

/**
 * 应用可自动化的修复。返回新代码 + 应用明细。
 * 只处理语义安全、确定性的改写。
 */
export function applyFixes(src, { includeWarnings = true, includeInit = true } = {}) {
  const { issues } = analyze(src);
  const applied = [];
  let code = src;

  // 先做文档级迁移：%%{init}%% -> frontmatter
  if (includeInit && issues.some((i) => i.rule === 'init-directive')) {
    const mig = migrateInitDirective(code);
    if (mig.applied.length) {
      code = mig.code;
      applied.push(...mig.applied);
    }
  }

  // 只有明确标记 auto 的问题才会被自动改写；其余只提示，避免改坏用户代码
  const wanted = issues.filter((i) => i.auto === true);

  for (const issue of wanted) {
    if (issue.after != null && issue.before != null) {
      const idx = code.indexOf(issue.before);
      if (idx === -1) continue;
      code = code.slice(0, idx) + issue.after + code.slice(idx + issue.before.length);
      applied.push({ ...issue, kind: 'replace' });
    } else if (issue.keyword && issue.after) {
      const lines = code.split('\n');
      let changed = false;
      for (let i = 0; i < lines.length; i += 1) {
        if (new RegExp(`^(\\s*)${escapeRe(issue.before)}\\b`).test(lines[i])) {
          lines[i] = lines[i].replace(new RegExp(`^(\\s*)${escapeRe(issue.before)}\\b`), `$1${issue.after}`);
          changed = true;
          break;
        }
      }
      if (changed) {
        code = lines.join('\n');
        applied.push({ ...issue, kind: 'replace' });
      }
    } else if (issue.appendEnd) {
      const trimmed = code.replace(/\s+$/, '');
      code = `${trimmed}\n${'end\n'.repeat(issue.appendEnd)}`;
      applied.push({ ...issue, kind: 'append' });
    }
  }

  return { code, applied, issues };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 mermaid 的渲染错误翻译成人话 + 可执行的修复建议。
 * mermaid v12 的错误信息形如：
 *   "Parse error on line 3:\n...\n-----^\nExpecting ..."
 */
export function explainError(err) {
  const raw = String((err && (err.str || err.message)) || err || '');
  const lineMatch = /line\s+(\d+)/i.exec(raw);
  const line = lineMatch ? Number(lineMatch[1]) : null;
  const lex = /Lexical error/i.test(raw);
  const parse = /Parse error/i.test(raw);
  const unknown = /No diagram type detected/i.test(raw);

  let hint = '';
  let fix = null;

  if (unknown) {
    hint = '没有匹配到图类型。请检查第一行关键字是否正确（v12 支持 flowchart / sequenceDiagram / classDiagram / stateDiagram / erDiagram / gantt / mindmap / …）。';
    fix = { kind: 'keyword' };
  } else if (lex) {
    hint = '词法错误：通常是中文全角标点（【】、""、：）或未闭合的引号造成的。可点「自动修复」一键转换。';
    fix = { kind: 'fullwidth' };
  } else if (parse) {
    hint = '语法解析失败。对照错误箭头位置检查上一行的括号、引号是否成对，以及 subgraph 是否有对应的 end。';
    fix = { kind: 'structure' };
  } else if (/edge limit exceeded|maxEdges/i.test(raw)) {
    hint = '边的数量超过 mermaid 的 maxEdges 上限（默认 500 条）。这是安全配置，不能写在图里，只能通过 mermaid.initialize() 调高。';
    fix = { kind: 'maxEdges' };
  } else if (/maximum text size|maxTextSize/i.test(raw)) {
    hint = '图表文本长度超过 mermaid 的 maxTextSize 上限（默认 50000 字符）。可通过 mermaid.initialize() 调高。';
    fix = { kind: 'maxTextSize' };
  } else if (/limit|too many/i.test(raw)) {
    hint = '图表规模超出限制。可通过 config.maxEdges / maxTextSize 调高。';
  }

  return { raw, line, hint, fix, kind: unknown ? 'unknown' : lex ? 'lexical' : parse ? 'parse' : 'other' };
}
