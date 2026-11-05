/* eslint-disable no-console */
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting, foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import YAML from 'yaml';
import pako from 'pako';

import { mermaidHighlight } from './highlight.js';
import { analyze, applyFixes, detectType, explainError, splitFrontmatter, migrateInitDirective, DIAGRAM_TYPES } from './compat.js';
import { SAMPLES } from './samples.js';

const MERMAID = (window.__esbuild_esm_mermaid_nm && window.__esbuild_esm_mermaid_nm.mermaid) || window.mermaid;
const mermaid = MERMAID.default || MERMAID;
const MERMAID_VERSION = typeof __MERMAID_VERSION__ === 'string' ? __MERMAID_VERSION__ : '12.3.0';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
const LS_KEY = 'mermaid-local-state-v1';
const state = {
  fileName: '未命名.mmd',
  uiLight: false,
  autoFix: true,
  showLock: false,
  blocks: [],          // 多图模式（.md）
  lastRenderMs: 0,
  view: { x: 0, y: 0, k: 1 },
  fitOnRender: true,
  userAdjusted: false,
  cfg: {},             // 来自 frontmatter 的 config
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// frontmatter / config
// ---------------------------------------------------------------------------
function readConfig(code) {
  const { frontmatter } = splitFrontmatter(code);
  if (!frontmatter.trim()) return {};
  try {
    const doc = YAML.parse(frontmatter);
    if (doc && typeof doc === 'object' && doc.config && typeof doc.config === 'object') return doc.config;
  } catch { /* 解析失败忽略 */ }
  return {};
}

/** 把 config 写回源码 frontmatter（保留 title 等其它字段） */
function writeConfig(code, config) {
  const { frontmatter, body } = splitFrontmatter(code);
  let doc = {};
  if (frontmatter.trim()) {
    try {
      const parsed = YAML.parse(frontmatter);
      if (parsed && typeof parsed === 'object') doc = parsed;
    } catch { doc = {}; }
  }
  const clean = {};
  Object.keys(config || {}).forEach((k) => {
    const v = config[k];
    if (v === '' || v === null || v === undefined) return;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
    clean[k] = v;
  });
  if (Object.keys(clean).length) doc.config = clean; else delete doc.config;
  const keys = Object.keys(doc);
  if (!keys.length) return body;
  const yamlText = YAML.stringify(doc, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// 编辑器
// ---------------------------------------------------------------------------
const editorTheme = new Compartment();
const highlightStyle = new Compartment();

const darkHL = HighlightStyle.define([
  { tag: t.keyword, color: '#7ee0c0', fontWeight: '600' },
  { tag: t.string, color: '#b48ead' },
  { tag: t.comment, color: '#5f6b7d', fontStyle: 'italic' },
  { tag: t.number, color: '#f0b429' },
  { tag: t.variableName, color: '#7aa2f7' },
  { tag: t.atom, color: '#89ddff' },
  { tag: t.operator, color: '#e0af68' },
  { tag: t.bracket, color: '#8a94a3' },
  { tag: t.punctuation, color: '#8a94a3' },
  { tag: t.meta, color: '#6b7789' },
  { tag: t.labelName, color: '#7aa2f7' },
]);

const lightHL = HighlightStyle.define([
  { tag: t.keyword, color: '#0b7285', fontWeight: '600' },
  { tag: t.string, color: '#a142f4' },
  { tag: t.comment, color: '#93999f', fontStyle: 'italic' },
  { tag: t.number, color: '#b4600a' },
  { tag: t.variableName, color: '#1c6fd4' },
  { tag: t.atom, color: '#0b6e99' },
  { tag: t.operator, color: '#a4600a' },
  { tag: t.bracket, color: '#6a737d' },
  { tag: t.punctuation, color: '#6a737d' },
  { tag: t.meta, color: '#7d8590' },
  { tag: t.labelName, color: '#1c6fd4' },
]);

function buildTheme(light) {
  const fg = light ? '#1c2430' : '#e6ebf3';
  const bg = light ? '#ffffff' : '#0f1115';
  const bg2 = light ? '#f4f6f9' : '#151920';
  const border = light ? '#d9dee6' : '#262d38';
  const mute = light ? '#8a94a3' : '#6b7789';
  return EditorView.theme({
    '&': { color: fg, backgroundColor: bg, height: '100%' },
    '.cm-content': { caretColor: fg, padding: '10px 0' },
    '.cm-gutters': { color: mute, backgroundColor: bg2, borderRight: `1px solid ${border}`, border: 'none' },
    '.cm-activeLine': { backgroundColor: light ? 'rgba(28,111,212,.05)' : 'rgba(76,141,255,.07)' },
    '.cm-activeLineGutter': { backgroundColor: light ? 'rgba(28,111,212,.08)' : 'rgba(76,141,255,.1)', color: fg },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: light ? 'rgba(28,111,212,.18)' : 'rgba(76,141,255,.26)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: fg, borderLeftWidth: '2px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: '1.65' },
    '.cm-tooltip': { backgroundColor: bg2, border: `1px solid ${border}`, color: fg },
    '.cm-panels': { backgroundColor: bg2, color: fg, borderColor: border },
    '.cm-searchMatch': { backgroundColor: 'rgba(240,180,41,.25)', outline: '1px solid rgba(240,180,41,.5)' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(240,180,41,.45)' },
  }, { dark: !light });
}

let editor = null;

function createEditor(initialDoc) {
  const view = new EditorView({
    parent: $('#editor'),
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [mermaidCompletions] }),
        rectangularSelection(),
        crosshairCursor(),
        highlightSelectionMatches(),
        syntaxHighlighting(mermaidHighlight),
        editorTheme.of(buildTheme(state.uiLight)),
        highlightStyle.of(syntaxHighlighting(state.uiLight ? lightHL : darkHL)),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
          { key: 'Mod-Enter', run: () => { renderNow(true); return true; } },
          { key: 'Mod-s', preventDefault: true, run: () => { saveMmd(); return true; } },
          { key: 'Mod-o', preventDefault: true, run: () => { $('#fileInput').click(); return true; } },
          { key: 'Mod-Shift-f', preventDefault: true, run: () => { toggleLightbox(); return true; } },
          { key: 'Mod-0', preventDefault: true, run: () => { fitZoom(); return true; } },
          { key: 'Mod-1', preventDefault: true, run: () => { resetZoom(); return true; } },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onCodeChanged();
            updateStatus();
          }
          if (u.selectionSet) updateStatus();
        }),
      ],
    }),
  });
  return view;
}

function mermaidCompletions(context) {
  const word = context.matchBefore(/[\w-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const kws = DIAGRAM_TYPES.map((d) => d.kw);
  const extra = ['subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click',
    'href', 'participant', 'actor', 'note', 'alt', 'else', 'loop', 'par', 'and', 'opt', 'rect',
    'section', 'dateFormat', 'axis', 'quadrant-1', 'requirement', 'state', 'branch', 'merge'];
  const options = [...new Set([...kws, ...extra])].map((k) => ({ label: k, type: 'keyword' }));
  return { from: word.from, options, validFor: /^[\w-]*$/ };
}


// ---------------------------------------------------------------------------
// Mermaid 全局初始化（上限可动态放宽）
// ---------------------------------------------------------------------------
let renderLimits = {};

function initMermaid() {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...renderLimits });
}

// 只匹配几何属性里的 NaN：transform / path d / 坐标 / 尺寸
const GEOMETRY_NAN = /\b(?:transform|d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height)\s*=\s*"[^"]*NaN[^"]*"/;

/**
 * mermaid 对「超限」这类错误不会抛异常，而是渲染成一张「错误图」，
 * 肉眼看过去像正常图。这里把它识别出来，别让用户对着假图发呆。
 */
function detectSvgError(svgText) {
  if (!svgText) return null;
  if (svgText.includes('Maximum text size in diagram exceeded')) {
    return {
      kind: 'maxTextSize',
      message: '图表文本长度超过 mermaid 的 maxTextSize 上限（默认 50000 字符），mermaid 把它渲染成了一张错误图。',
      action: 'raise-text',
      actionLabel: '放宽文本上限并重试',
    };
  }
  if (/Maximum number of edges/i.test(svgText) || /maxEdges/i.test(svgText)) {
    return {
      kind: 'maxEdges',
      message: '边的数量超过 mermaid 的 maxEdges 上限，mermaid 把它渲染成了一张错误图。',
      action: 'raise-edges',
      actionLabel: '放宽边数上限并重试',
    };
  }
  if (svgText.includes('Syntax error in text')) {
    return { kind: 'syntax', message: 'mermaid 渲染出了语法错误图，请看图上的具体提示。', action: null, actionLabel: null };
  }
  // 超大图时 mermaid 会算出 NaN 几何（translate(0,NaN)），浏览器会报 SVG 属性错误。
  // 与其把一张坏 SVG 塞进预览区，不如明确告诉用户「图太大了」。
  // 只看几何属性：象限图的配色会合法地出现 hsl(240, 100%, NaN%)，那是 mermaid 上游
  // 的配色 bug，不影响图形，不该拦下来。
  if (GEOMETRY_NAN.test(svgText)) {
    return {
      kind: 'nan',
      message: '布局引擎算出了无效坐标（NaN），这张图渲染不出来。常见原因：图太大（节点/边过多），或数据格式不对（例如 sankey 的第三列必须是数字）。建议先拆分图形或检查数据。',
      action: null,
      actionLabel: null,
    };
  }
  return null;
}

function raiseLimits(kind) {
  if (kind === 'raise-text') renderLimits.maxTextSize = 500000;
  if (kind === 'raise-edges') renderLimits.maxEdges = 20000;
  initMermaid();
  renderNow(true);
  toast('已放宽上限，正在重试渲染');
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------
let renderSeq = 0;
let renderTimer = null;

function onCodeChanged() {
  scheduleSave();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderNow(false), 260);
  renderNow(false, true); // 轻量：只更新兼容面板
}

async function renderNow(force = false, analysisOnly = false) {
  const code = editor.state.doc.toString();
  const analysis = analyze(code);
  updateCompatPanel(analysis);
  updateTypeBadge(analysis.type);

  if (analysisOnly) return;

  let effective = code;
  let applied = [];
  if (state.autoFix && analysis.errorCount) {
    const r = applyFixes(code, { includeInit: false });
    if (r.applied.length) {
      effective = r.code;
      applied = r.applied;
    }
  }
  showFixBar(applied);

  const t0 = performance.now();
  const blocks = extractBlocks(effective);
  const layer = $('#zoomLayer');
  const msg = $('#previewMsg');
  msg.classList.remove('show');
  msg.innerHTML = '';

  if (!effective.trim()) {
    layer.innerHTML = '';
    msg.classList.add('show');
    msg.innerHTML = `<div class="err-card"><h4>代码为空</h4>
      <div class="err-hint">在左侧写点什么吧，或者从右侧「样例」里挑一个开始。</div></div>`;
    $('#stRender').textContent = '—';
    return;
  }

  try {
    const rendered = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const { svg } = await mermaid.render(`lme${renderSeq++}`, blocks[i].code);
      const svgErr = detectSvgError(svg);
      if (svgErr) {
        showError(new Error(svgErr.message), svgErr);
        $('#stRender').textContent = svgErr.kind === 'nan' ? '渲染失败（图形过大）' : '渲染失败（超限）';
        $('#stRender').style.color = 'var(--danger)';
        return;
      }
      rendered.push(svg);
    }
    layer.innerHTML = rendered.map((svg) => `<div class="blk">${svg}</div>`).join('');
    state.fitOnRender = true;
    fitZoom();
    state.lastRenderMs = Math.round(performance.now() - t0);
    $('#stRender').textContent = `渲染 ${state.lastRenderMs}ms`;
    $('#stRender').style.color = '';
  } catch (err) {
    showError(err);
    $('#stRender').textContent = '渲染失败';
    $('#stRender').style.color = 'var(--danger)';
  }
}

/** 从源码中提取 mermaid 代码块（markdown 模式） */
function extractBlocks(code) {
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  const found = [];
  let m;
  while ((m = re.exec(code)) !== null) found.push(m[1].trim());
  // 只要有围栏就按 markdown 处理：单图块也必须能渲染，
  // 否则整篇 markdown 会被当成 mermaid 源码去解析，直接报「没有匹配到图类型」。
  if (found.length >= 1) {
    state.blocks = found;
    const nav = $('#blockNav');
    nav.classList.remove('hidden');
    nav.innerHTML = found.map((_, i) => `<button class="mini" data-block="${i}">#${i + 1}</button>`).join('');
    Array.from(nav.querySelectorAll('button')).forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.block);
        const el = $('#zoomLayer').querySelectorAll('.blk')[i];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return found.map((c) => ({ code: c }));
  }
  state.blocks = [];
  $('#blockNav').classList.add('hidden');
  return [{ code }];
}

function showError(err, svgErrIn = null) {
  let svgErr = svgErrIn;
  const info = explainError(err);
  const msg = $('#previewMsg');
  const layer = $('#zoomLayer');
  layer.innerHTML = '';
  msg.classList.add('show');
  const jump = info.line
    ? `<div class="err-jump">出错位置：第 ${info.line} 行</div>`
    : '';
  const actions = [];
  if (svgErr && svgErr.action) {
    actions.push(`<button class="btn" data-act="raise">${svgErr.actionLabel}</button>`);
  } else if (info.fix && (info.fix.kind === 'maxEdges' || info.fix.kind === 'maxTextSize')) {
    const kind = info.fix.kind === 'maxEdges' ? 'raise-edges' : 'raise-text';
    const label = info.fix.kind === 'maxEdges' ? '放宽边数上限并重试' : '放宽文本上限并重试';
    svgErr = { action: kind, actionLabel: label };
    actions.push(`<button class="btn" data-act="raise">${label}</button>`);
  }
  if (info.fix && info.fix.kind === 'fullwidth') {
    actions.push('<button class="btn" data-act="fix-fullwidth">修复全角标点</button>');
  }
  if (info.fix && info.fix.kind === 'structure') {
    actions.push('<button class="btn" data-act="fix-structure">补齐 subgraph/end</button>');
  }
  if (info.fix && info.fix.kind === 'keyword') {
    actions.push('<button class="btn" data-act="fix-keyword">修正图类型关键字</button>');
  }
  actions.push('<button class="btn ghost" data-act="goto-error">跳到出错行</button>');
  msg.innerHTML = `
    <div class="err-card">
      <h4>渲染失败</h4>
      <div class="err-hint">${escapeHtml(info.hint || '未知错误')}</div>
      ${jump}
      <div class="err-raw">${escapeHtml(info.raw)}</div>
      <div class="err-actions">${actions.join('')}</div>
    </div>`;
  msg.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'raise' && svgErr) {
        raiseLimits(svgErr.action);
      } else if (act === 'goto-error' && info.line) {
        gotoLine(info.line);
      } else {
        applyFixesToEditor();
      }
    });
  });
}

function escapeHtml(s) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

function gotoLine(line) {
  const n = Math.max(1, line);
  const pos = editor.state.doc.line(Math.min(n, editor.state.doc.lines)).from;
  editor.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  editor.focus();
}

// ---------------------------------------------------------------------------
// 兼容面板
// ---------------------------------------------------------------------------
function updateCompatPanel(analysis) {
  const list = $('#compatList');
  const badge = $('#compatBadge');
  const count = $('#compatCount');
  const issues = analysis.issues;

  if (!issues.length) {
    list.innerHTML = '<div class="hint">未发现兼容问题，代码可直接在 v12 渲染。</div>';
    $('#compatSummary').textContent = '未发现兼容问题';
    badge.classList.add('badge-hidden');
    count.classList.add('hidden');
    $('#btnFixAll').disabled = true;
    return;
  }
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  $('#compatSummary').textContent = `${errs} 个错误级 / ${warns} 个建议级`;
  badge.textContent = errs ? `${errs} 个兼容问题` : `${warns} 条建议`;
  badge.classList.remove('badge-hidden');
  badge.className = `badge ${errs ? 'badge-err' : 'badge-warn'}`;
  count.classList.remove('hidden');
  $('#btnFixAll').disabled = false;

  list.innerHTML = issues.map((i, idx) => {
    let diff = '';
    if (i.before && i.after) {
      diff = `<div class="ci-diff"><span class="del">− ${escapeHtml(i.before.trim())}</span><br><span class="ins">+ ${escapeHtml(i.after.trim())}</span></div>`;
    }
    const loc = i.line ? `第 ${i.line} 行` : '全文';
    return `<div class="compat-item sev-${i.severity}">
      <div class="ci-msg">${escapeHtml(i.message)}</div>
      <div class="ci-loc">${loc} · 规则 ${escapeHtml(i.rule)}</div>
      ${diff}
      <div class="ci-actions"><button class="mini" data-fix="${idx}">修复此项</button></div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-fix]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.fix);
      const issue = issues[idx];
      if (!issue) return;
      if (issue.initDirective) {
        const mig = migrateInitDirective(editor.state.doc.toString());
        if (mig.applied.length) {
          editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: mig.code } });
          editor.focus();
          renderNow(true);
          toast('已迁移到 frontmatter');
        } else {
          toast('该指令无法自动解析，请手动调整');
        }
      } else if (issue.keyword && issue.after) {
        if (!replaceKeywordAt(issue.lineIndex, issue.before, issue.after)) {
          toast('未能定位到该关键字所在行，请手动修改');
        }
      } else if (issue.after != null && issue.before != null) {
        if (!replaceLineByIndex(issue.lineIndex, issue.before, issue.after)) {
          toast('未能定位到该行，请手动修改');
        }
      } else {
        applyFixesToEditor();
      }
      toast('已应用修复');
    });
  });
}

/**
 * 按「行索引」精确替换某一行。
 * 不用字符串查找：同一段文本可能先出现在 %% 注释、frontmatter 或 markdown 散文里，
 * 全文搜索会改错行，而且用户完全看不出来。
 */
function replaceLineByIndex(lineIndex, expected, replacement) {
  const doc = editor.state.doc;
  const n = doc.lines;
  if (lineIndex < 0 || lineIndex >= n) return false;
  const line = doc.line(lineIndex + 1);
  if (line.text.trim() !== String(expected).trim()) return false;
  editor.dispatch({
    changes: { from: line.from, to: line.to, insert: replacement },
  });
  editor.focus();
  return true;
}

/** 关键字别名：只改那一行开头的关键字 */
function replaceKeywordAt(lineIndex, before, after) {
  const doc = editor.state.doc;
  if (lineIndex < 0 || lineIndex >= doc.lines) return false;
  const line = doc.line(lineIndex + 1);
  const re = new RegExp(`^(\\s*)${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(line.text);
  if (!m) return false;
  editor.dispatch({
    changes: { from: line.from + m[1].length, to: line.from + m[1].length + before.length, insert: after },
  });
  editor.focus();
  return true;
}

function applyFixesToEditor() {
  const code = editor.state.doc.toString();
  const r = applyFixes(code);
  if (!r.applied.length) {
    toast('没有可自动应用的修复');
    return;
  }
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: r.code },
  });
  editor.focus();
  toast(`已修复 ${r.applied.length} 处`);
  renderNow(true);
}

function showFixBar(applied) {
  const bar = $('#fixBar');
  if (!applied || !applied.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  const summary = applied.map((a) => a.message.split('。')[0]).join('；');
  bar.innerHTML = `<span>⚠ 已自动兼容 <b>${applied.length}</b> 处：${escapeHtml(summary.slice(0, 200))}</span>
    <div class="fb-actions">
      <button class="mini" id="fbWrite">写回编辑器</button>
      <button class="mini" id="fbDismiss">忽略</button>
    </div>`;
  bar.classList.remove('hidden');
  $('#fbWrite').addEventListener('click', () => {
    const r = applyFixes(editor.state.doc.toString());
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: r.code } });
    renderNow(true);
    toast('已写回编辑器');
  });
  $('#fbDismiss').addEventListener('click', () => bar.classList.add('hidden'));
}

// ---------------------------------------------------------------------------
// 平移 / 缩放
// ---------------------------------------------------------------------------
function applyTransform() {
  const layer = $('#zoomLayer');
  layer.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.k})`;
  $('#zoomLabel').textContent = `${Math.round(state.view.k * 100)}%`;
}

function fitZoom() {
  state.userAdjusted = false;
  const layer = $('#zoomLayer');
  const svgs = Array.from(layer.querySelectorAll('svg'));
  if (!svgs.length) return;
  const box = $('#preview').getBoundingClientRect();
  let maxW = 0;
  let maxH = 0;
  svgs.forEach((s) => {
    const vb = s.viewBox && s.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : (s.getBoundingClientRect().width / state.view.k);
    const h = vb && vb.height ? vb.height : (s.getBoundingClientRect().height / state.view.k);
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
  });
  if (!maxW || !maxH) return;
  const pad = 40;
  const k = Math.min((box.width - pad) / maxW, (box.height - pad) / maxH, 1.5);
  state.view.k = Math.max(0.05, k);
  state.view.x = (box.width - maxW * state.view.k) / 2;
  state.view.y = (box.height - maxH * state.view.k) / 2;
  applyTransform();
}

function resetZoom() {
  state.view = { x: 0, y: 0, k: 1 };
  state.userAdjusted = false;
  applyTransform();
}

function zoomBy(factor, cx, cy) {
  const box = $('#preview').getBoundingClientRect();
  const px = cx ?? box.width / 2;
  const py = cy ?? box.height / 2;
  const old = state.view.k;
  const next = Math.min(6, Math.max(0.05, old * factor));
  state.userAdjusted = true;
  state.view.x = px - ((px - state.view.x) * next) / old;
  state.view.y = py - ((py - state.view.y) * next) / old;
  state.view.k = next;
  applyTransform();
}

function initPanZoom() {
  const preview = $('#preview');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  preview.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    dragging = true;
    state.userAdjusted = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = state.view.x;
    originY = state.view.y;
    preview.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.view.x = originX + (e.clientX - startX);
    state.view.y = originY + (e.clientY - startY);
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    preview.classList.remove('dragging');
  });
  preview.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = preview.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  $('#btnZoomIn').addEventListener('click', () => zoomBy(1.2));
  $('#btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
  $('#btnZoomFit').addEventListener('click', fitZoom);
  $('#btnZoomReset').addEventListener('click', resetZoom);
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
function currentSvgElements() {
  return Array.from($('#zoomLayer').querySelectorAll('svg'));
}

function serializeSvg(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  if (!clone.getAttribute('style')) clone.setAttribute('style', 'max-width: none;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName() {
  return (state.fileName || 'diagram').replace(/\.(mmd|mermaid|md|txt)$/i, '');
}

/** 为导出重渲染一版（htmlLabels=false，保证 PNG 里文字能画出来） */
async function renderForExport() {
  const code = editor.state.doc.toString();
  const cfg = readConfig(code);
  const exportCfg = { ...cfg, htmlLabels: false };
  const exportCode = writeConfig(code, exportCfg);
  const blocks = extractBlocks(exportCode);
  const out = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const { svg } = await mermaid.render(`exp${renderSeq++}`, blocks[i].code);
    out.push(svg);
  }
  return out;
}

async function exportSvg() {
  try {
    const svgs = await renderForExport();
    if (!svgs.length) return;
    if (svgs.length === 1) {
      downloadBlob(new Blob([serializeSvg(svgs[0])], { type: 'image/svg+xml;charset=utf-8' }), `${baseName()}.svg`);
      toast('已导出 SVG');
    } else {
      // 多个 SVG 根节点不能拼在一个文件里，按序号分别导出
      svgs.forEach((svg, i) => {
        downloadBlob(new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${baseName()}-${i + 1}.svg`);
      });
      toast(`已导出 ${svgs.length} 个 SVG`);
    }
  } catch (e) {
    toast('导出失败：' + String(e).slice(0, 120));
  }
}

/** 把 SVG 文本栅格化成 PNG Blob */
async function rasterizeSvg(svgText, scale = 2, background = '#ffffff') {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : 1200;
  const h = vb && vb.height ? vb.height : 800;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG 光栅化失败'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function exportPng(scale = 2) {
  try {
    const svgs = await renderForExport();
    if (!svgs.length) return;
    const png = await rasterizeSvg(svgs[0], scale);
    if (!png) throw new Error('PNG 编码失败');
    downloadBlob(png, `${baseName()}.png`);
    toast(svgs.length > 1
      ? `已导出第 1 个 PNG（共 ${svgs.length} 个图，PNG 仅支持单图）`
      : `已导出 PNG (${png.size} 字节)`);
  } catch (e) {
    toast('导出 PNG 失败：' + String(e).slice(0, 120));
  }
}

async function copySvg() {
  try {
    const svgs = await renderForExport();
    if (!svgs.length) return;
    await navigator.clipboard.writeText(serializeSvg(svgs[0]));
    toast(svgs.length > 1 ? '已复制第 1 个 SVG（共 ' + svgs.length + ' 个）' : 'SVG 已复制到剪贴板');
  } catch (e) {
    toast('复制失败：' + String(e).slice(0, 100));
  }
}

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------
function saveMmd() {
  const code = editor.state.doc.toString();
  const isMd = /\.md$/i.test(state.fileName);
  downloadBlob(new Blob([code], { type: 'text/plain;charset=utf-8' }), state.fileName || 'diagram.mmd');
  toast(isMd ? '已保存 markdown' : '已保存 .mmd');
}

function openFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    state.fileName = file.name;
    $('#fileName').value = file.name;
    scheduleSave();
    renderNow(true);
    toast(`已打开 ${file.name}`);
  };
  reader.readAsText(file, 'utf-8');
}

// ---------------------------------------------------------------------------
// 分享链接
// ---------------------------------------------------------------------------
function b64url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function makeShareLink() {
  const payload = JSON.stringify({ c: editor.state.doc.toString(), n: state.fileName });
  const packed = pako.deflate(new TextEncoder().encode(payload), { level: 9 });
  const hash = b64url(packed);
  const base = location.protocol === 'file:' ? location.pathname : `${location.origin}${location.pathname}`;
  const url = `${base}#${hash}`;
  try {
    history.replaceState(null, '', `#${hash}`);
  } catch {
    // file:// 下 origin 为 null，replaceState 会抛 SecurityError，降级为直接写 hash
    try { location.hash = hash; } catch { /* ignore */ }
  }
  return url;
}

function loadFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  try {
    const bytes = unb64url(hash);
    const json = new TextDecoder().decode(pako.inflate(bytes));
    const data = JSON.parse(json);
    if (data && typeof data.c === 'string') {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: data.c } });
      if (data.n) {
        state.fileName = data.n;
        $('#fileName').value = data.n;
      }
      return true;
    }
  } catch { /* 不是有效分享链接 */ }
  return false;
}

// ---------------------------------------------------------------------------
// 本地存储
// ---------------------------------------------------------------------------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        code: editor.state.doc.toString(),
        fileName: state.fileName,
        uiLight: state.uiLight,
        autoFix: state.autoFix,
      }));
      $('#stSaved').textContent = '本地已保存';
    } catch { $('#stSaved').textContent = '本地存储不可用'; }
  }, 400);
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// 设置面板
// ---------------------------------------------------------------------------
const PRESETS = {
  v12: {},
  classic: { layout: 'dagre', theme: 'default', look: 'classic' },
  dark: { layout: 'dagre', theme: 'dark', look: 'classic' },
  hand: { layout: 'dagre', theme: 'default', look: 'handDrawn' },
};

function syncSettingsFromCode() {
  const cfg = readConfig(editor.state.doc.toString());
  state.cfg = cfg;
  $('#cfgTheme').value = cfg.theme || '';
  $('#cfgLook').value = cfg.look || '';
  $('#cfgLayout').value = cfg.layout || '';
  $('#cfgFont').value = cfg.fontFamily || '';
  $('#cfgSecurity').value = cfg.securityLevel || 'strict';
  $('#cfgMaxWidth').checked = cfg.useMaxWidth !== false;
  $('#cfgHtmlLabels').checked = cfg.htmlLabels !== false;
  syncPresetHighlight(cfg);
}

function syncPresetHighlight(cfg) {
  const keys = Object.keys(cfg).filter((k) => ['layout', 'theme', 'look'].includes(k));
  const items = Array.from(document.querySelectorAll('.preset'));
  items.forEach((el) => {
    const p = PRESETS[el.dataset.preset];
    const pKeys = Object.keys(p);
    const match = pKeys.length === keys.length && pKeys.every((k) => cfg[k] === p[k]);
    el.classList.toggle('active', match);
  });
}

function applySettingsToCode() {
  const code = editor.state.doc.toString();
  const cfg = { ...readConfig(code) };
  const theme = $('#cfgTheme').value;
  const look = $('#cfgLook').value;
  const layout = $('#cfgLayout').value;
  const font = $('#cfgFont').value.trim();
  const sec = $('#cfgSecurity').value;
  const maxW = $('#cfgMaxWidth').checked;
  const htmlLabels = $('#cfgHtmlLabels').checked;

  if (theme) cfg.theme = theme; else delete cfg.theme;
  if (look) cfg.look = look; else delete cfg.look;
  if (layout) cfg.layout = layout; else delete cfg.layout;
  if (font) cfg.fontFamily = font; else delete cfg.fontFamily;
  if (sec && sec !== 'strict') cfg.securityLevel = sec; else delete cfg.securityLevel;
  if (!maxW) cfg.useMaxWidth = false; else delete cfg.useMaxWidth;
  if (!htmlLabels) cfg.htmlLabels = false; else delete cfg.htmlLabels;

  const next = writeConfig(code, cfg);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
  syncSettingsFromCode();
  renderNow(true);
  toast('已应用到代码');
}

function applyPreset(name) {
  const cfg = { ...readConfig(editor.state.doc.toString()) };
  ['layout', 'theme', 'look'].forEach((k) => delete cfg[k]);
  Object.assign(cfg, PRESETS[name] || {});
  const next = writeConfig(editor.state.doc.toString(), cfg);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
  syncSettingsFromCode();
  renderNow(true);
  toast(`已切换到「${name}」预设`);
}

// ---------------------------------------------------------------------------
// 整理格式
// ---------------------------------------------------------------------------
// 这些图类型的缩进是有语义的（mindmap 用缩进表达层级），整理缩进会毁掉结构
const INDENT_SENSITIVE = new Set(['mindmap']);

/** 对一段 mermaid 代码重排缩进 */
function reindentMermaid(text) {
  let depth = 0;
  return text.split(/\r?\n/).map((raw) => {
    const t = raw.trim();
    if (!t) return '';
    if (/^end\b/.test(t)) depth = Math.max(0, depth - 1);
    const line = '  '.repeat(depth) + t;
    if (/^subgraph\b/.test(t)) depth += 1;
    return line;
  }).join('\n').replace(/\n{3,}/g, '\n\n');
}

function formatCode() {
  const code = editor.state.doc.toString();
  const { frontmatter, body } = splitFrontmatter(code);

  // markdown 文档：只整理 ```mermaid 围栏里的代码，
  // 围栏本身、散文、列表一律原样保留 —— 否则闭合围栏被缩进后就不再是围栏了。
  if (/```/.test(body)) {
    const lines = body.split(/\r?\n/);
    const out = [];
    let inFence = false;
    let buf = [];
    let changed = false;
    const flush = () => {
      if (!buf.length) return;
      const formatted = reindentMermaid(buf.join('\n'));
      if (formatted !== buf.join('\n')) changed = true;
      out.push(formatted);
      buf = [];
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        flush();
        inFence = !inFence;
        out.push(line);
        continue;
      }
      if (inFence) buf.push(line); else out.push(line);
    }
    flush();
    if (!changed) {
      toast('缩进已经是规范的，无需整理');
      return;
    }
    const next = (frontmatter ? `---\n${frontmatter}\n---\n` : '') + out.join('\n');
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
    renderNow(true);
    toast('已整理 mermaid 代码块缩进');
    return;
  }

  const type = detectType(code);
  if (type.type && INDENT_SENSITIVE.has(type.type)) {
    toast(`${type.label || type.type} 用缩进表达层级，已跳过整理`);
    return;
  }
  const lines = body.split(/\r?\n/);
  let depth = 0;
  const out = lines.map((raw) => {
    const t = raw.trim();
    if (!t) return '';
    if (/^end\b/.test(t)) depth = Math.max(0, depth - 1);
    const line = '  '.repeat(depth) + t;
    if (/^subgraph\b/.test(t)) depth += 1;
    return line;
  });
  const next = (frontmatter ? `---\n${frontmatter}\n---\n` : '') + out.join('\n').replace(/\n{3,}/g, '\n\n');
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
  renderNow(true);
  toast('已整理缩进');
}

// ---------------------------------------------------------------------------
// 样例
// ---------------------------------------------------------------------------
function renderSampleList(filter = '') {
  const list = $('#sampleList');
  const q = filter.trim().toLowerCase();
  const items = SAMPLES.filter((s) => !q || s.name.toLowerCase().includes(q) || s.type.includes(q) || s.code.toLowerCase().includes(q));
  list.innerHTML = items.map((s, i) => {
    const idx = SAMPLES.indexOf(s);
    return `<button class="sample-item" data-idx="${idx}">${escapeHtml(s.name)}<span class="si-type">${escapeHtml(s.type)}</span></button>`;
  }).join('');
  list.querySelectorAll('[data-idx]').forEach((b) => {
    b.addEventListener('click', () => {
      const s = SAMPLES[Number(b.dataset.idx)];
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: s.code } });
      state.fileName = `${s.name}.mmd`;
      $('#fileName').value = state.fileName;
      syncSettingsFromCode();
      renderNow(true);
      toast(`已载入样例：${s.name}`);
    });
  });
}

// ---------------------------------------------------------------------------
// 状态栏 / 徽标
// ---------------------------------------------------------------------------
function updateStatus() {
  const pos = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(pos);
  $('#stPos').textContent = `${line.number}:${pos - line.from + 1}`;
}

function updateTypeBadge(type) {
  const badge = $('#typeBadge');
  if (type && type.label) {
    badge.textContent = type.label + (type.legacy ? ' (旧写法)' : '');
    badge.classList.remove('badge-hidden');
  } else {
    badge.textContent = '—';
  }
  $('#stType').textContent = type && type.kw ? `类型 ${type.kw}` : '类型 —';
}

// ---------------------------------------------------------------------------
// 全屏
// ---------------------------------------------------------------------------
function toggleLightbox() {
  const lb = $('#lightbox');
  if (lb.classList.contains('hidden')) {
    $('#lightboxBody').innerHTML = $('#zoomLayer').innerHTML;
    $('#lightboxTitle').textContent = `${state.fileName} — 预览`;
    lb.classList.remove('hidden');
  } else {
    lb.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------
function bindUI() {
  $('#btnNew').addEventListener('click', () => {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'flowchart TD\n  A[开始] --> B[结束]\n' } });
    state.fileName = '未命名.mmd';
    $('#fileName').value = state.fileName;
    renderNow(true);
  });
  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  });
  $('#btnSave').addEventListener('click', saveMmd);
  $('#btnSvg').addEventListener('click', exportSvg);
  $('#btnPng').addEventListener('click', () => exportPng(2));
  $('#btnCopy').addEventListener('click', copySvg);
  $('#btnShare').addEventListener('click', async () => {
    const url = makeShareLink();
    try {
      await navigator.clipboard.writeText(url);
      toast('分享链接已复制（含全部代码，可离线还原）');
    } catch {
      toast('已写入地址栏，复制地址即可');
    }
  });
  $('#btnFull').addEventListener('click', toggleLightbox);
  $('#lbClose').addEventListener('click', toggleLightbox);
  $('#lbPng').addEventListener('click', () => exportPng(2));
  $('#lbSvg').addEventListener('click', exportSvg);
  $('#btnTheme').addEventListener('click', () => setUiLight(!state.uiLight));

  $('#autoFix').addEventListener('change', (e) => {
    state.autoFix = e.target.checked;
    $('#stAuto').textContent = `自动兼容：${state.autoFix ? '开' : '关'}`;
    scheduleSave();
    renderNow(true);
  });
  $('#btnFixNow').addEventListener('click', applyFixesToEditor);
  $('#btnFixAll').addEventListener('click', applyFixesToEditor);
  $('#btnFormat').addEventListener('click', formatCode);

  $('#btnApplyCfg').addEventListener('click', applySettingsToCode);
  $('#btnClearCfg').addEventListener('click', () => {
    const code = editor.state.doc.toString();
    const { frontmatter, body } = splitFrontmatter(code);
    let next = body;
    if (frontmatter.trim()) {
      // 只删 config 段，保留 title 等其它 frontmatter 字段
      let doc = {};
      try {
        const parsed = YAML.parse(frontmatter);
        if (parsed && typeof parsed === 'object') doc = parsed;
      } catch { doc = null; }
      if (doc && typeof doc === 'object') {
        delete doc.config;
        next = Object.keys(doc).length
          ? `---\n${YAML.stringify(doc, { lineWidth: 0 }).trimEnd()}\n---\n${body}`
          : body;
      }
    }
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
    syncSettingsFromCode();
    renderNow(true);
    toast('已清除配置（保留其它 frontmatter 字段）');
  });
  $('#btnResetLocal').addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: SAMPLES[0].code } });
    state.fileName = '未命名.mmd';
    $('#fileName').value = state.fileName;
    syncSettingsFromCode();
    renderNow(true);
    toast('已恢复默认示例');
  });

  document.querySelectorAll('.preset').forEach((b) => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
  });

  $('#sampleSearch').addEventListener('input', (e) => renderSampleList(e.target.value));

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-body').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    });
  });

  $('#fileName').addEventListener('change', (e) => {
    state.fileName = e.target.value.trim() || '未命名.mmd';
    e.target.value = state.fileName;
    scheduleSave();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#lightbox').classList.contains('hidden')) toggleLightbox();
  });
  window.addEventListener('resize', () => { if (!state.userAdjusted) fitZoom(); });
  window.addEventListener('beforeunload', () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        code: editor.state.doc.toString(), fileName: state.fileName,
        uiLight: state.uiLight, autoFix: state.autoFix,
      }));
    } catch { /* ignore */ }
  });
}

function setUiLight(light) {
  state.uiLight = light;
  document.documentElement.setAttribute('data-ui', light ? 'light' : 'dark');
  editor.dispatch({
    effects: editorTheme.reconfigure(buildTheme(light)),
  });
  editor.dispatch({
    effects: highlightStyle.reconfigure(syntaxHighlighting(light ? lightHL : darkHL)),
  });
  scheduleSave();
}

// ---------------------------------------------------------------------------
// 拖拽分隔条
// ---------------------------------------------------------------------------
function initSplitters() {
  function drag(el, onMove) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      el.classList.add('dragging');
      const move = (ev) => onMove(ev);
      const up = () => {
        el.classList.remove('dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (state.fitOnRender) fitZoom();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
  drag($('#splitter'), (e) => {
    const main = $('.main');
    const rect = main.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const max = rect.width - 340;
    $('#paneEditor').style.flex = `0 0 ${Math.min(Math.max(pct, 18), 75)}%`;
    void max;
  });
  drag($('#splitterV'), (e) => {
    const main = $('.main');
    const rect = main.getBoundingClientRect();
    const px = rect.right - e.clientX;
    $('#side').style.flex = `0 0 ${Math.min(Math.max(px, 220), 620)}px`;
  });
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
function boot() {
  $('#verBadge').textContent = `v${MERMAID_VERSION}`;
  $('#helpVer').textContent = `v${MERMAID_VERSION}`;

  const saved = loadLocal();
  const initial = saved && typeof saved.code === 'string' ? saved.code : SAMPLES[0].code;

  initMermaid();

  editor = createEditor(initial);
  if (saved) {
    state.fileName = saved.fileName || state.fileName;
    state.uiLight = !!saved.uiLight;
    state.autoFix = saved.autoFix !== false;
  }
  $('#fileName').value = state.fileName;
  $('#autoFix').checked = state.autoFix;
  $('#stAuto').textContent = `自动兼容：${state.autoFix ? '开' : '关'}`;
  document.documentElement.setAttribute('data-ui', state.uiLight ? 'light' : 'dark');
  editor.dispatch({ effects: editorTheme.reconfigure(buildTheme(state.uiLight)) });
  editor.dispatch({ effects: highlightStyle.reconfigure(syntaxHighlighting(state.uiLight ? lightHL : darkHL)) });

  bindUI();
  initPanZoom();
  initSplitters();
  renderSampleList('');

  const restored = loadFromHash();
  syncSettingsFromCode();
  renderNow(true);
  if (restored) toast('已从分享链接还原代码');

  // 对外脚本 API：方便自动化与批量处理
  window.__lme = {
    version: MERMAID_VERSION,
    getCode: () => editor.state.doc.toString(),
    setCode: (code) => {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: String(code) } });
      syncSettingsFromCode();
      renderNow(true);
    },
    render: () => renderNow(true),
    analyze: (code) => analyze(code),
    migrate: (code) => applyFixes(code),
    exportSvgText: async () => (await renderForExport()).join('\n'),
    exportPngBlob: async (scale = 2) => {
      const svgs = await renderForExport();
      return rasterizeSvg(svgs[0], scale);
    },
    samples: SAMPLES,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
