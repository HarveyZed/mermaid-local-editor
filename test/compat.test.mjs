import assert from 'node:assert/strict';
import { analyze, applyFixes, detectType, explainError, splitFrontmatter, migrateInitDirective } from '../src/compat.js';

let pass = 0;
const fails = [];
function t(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (e) {
    fails.push([name, e.message]);
  }
}

// --- detectType -----------------------------------------------------------
t('detect flowchart', () => {
  const r = detectType('flowchart TD\n A-->B');
  assert.equal(r.type, 'flowchart');
});
t('detect graph as flowchart legacy', () => {
  const r = detectType('graph TD\n A-->B');
  assert.equal(r.type, 'flowchart');
  assert.equal(r.legacy, true);
});
t('detect with frontmatter', () => {
  const r = detectType('---\nconfig:\n  theme: default\n---\nsequenceDiagram\n A->>B: hi');
  assert.equal(r.type, 'sequence');
});
t('detect alias swimlanes', () => {
  const r = detectType('swimlanes\n title T');
  assert.equal(r.aliasOf, 'swimlane-beta');
});
t('detect unknown', () => {
  const r = detectType('foobarDiagram\n A');
  assert.equal(r.unknown, true);
});

// --- defaultRenderer migration -------------------------------------------
t('defaultRenderer -> layout', () => {
  const src = '---\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\nflowchart TD\n A-->B';
  const { code, applied } = applyFixes(src);
  assert.match(code, /layout: elk/);
  assert.doesNotMatch(code, /defaultRenderer/);
  assert.equal(applied.length, 1);
});
t('defaultRenderer dagre-d3 -> dagre', () => {
  const src = '---\nconfig:\n  class:\n    defaultRenderer: dagre-d3\n---\nclassDiagram\n A<|--B';
  const { code } = applyFixes(src);
  assert.match(code, /layout: dagre/);
});
t('defaultRenderer detected as error', () => {
  const a = analyze('---\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\nflowchart TD\n A-->B');
  assert.equal(a.errorCount, 1);
});

// --- keyword alias --------------------------------------------------------
t('swimlanes -> swimlane-beta', () => {
  const { code, applied } = applyFixes('swimlanes\n title T\n lane A\n  a-->b');
  assert.match(code, /^swimlane-beta/m);
  assert.ok(applied.some((x) => x.rule === 'keyword-alias'));
});
t('usecase -> usecase-beta', () => {
  const { code } = applyFixes('usecase\n actor User\n usecase "Login" as L');
  assert.match(code, /^usecase-beta/m);
});
t('unknown keyword reported not rewritten', () => {
  const { code, applied } = applyFixes('foobarDiagram\n A');
  assert.match(code, /^foobarDiagram/m);
  assert.equal(applied.length, 0);
});

// --- fullwidth punctuation ------------------------------------------------
t('【】 -> quoted label', () => {
  const { code } = applyFixes('flowchart TD\n  A【开始】 --> B');
  assert.match(code, /A\["开始"\]/);
});
t('方括号内的中文引号不该被改（会改坏代码）', () => {
  const { code } = applyFixes('flowchart TD\n  A["“测试”"] --> B');
  assert.match(code, /[“”]/, '中文引号在标签内是合法的，不能改');
});
t('方括号内的全角冒号不该被改', () => {
  const { code } = applyFixes('flowchart TD\n  A[开始：结束] --> B');
  assert.match(code, /开始：结束/);
});
t('方括号内的中文引号整体保持不变', () => {
  const src = 'flowchart TD\n  A[他说“你好”] --> B';
  const { code } = applyFixes(src);
  assert.equal(code, src);
});
t('全角圆括号在形状位置转半角', () => {
  const { code } = applyFixes('flowchart TD\n  A[文本] --> B（注释）');
  assert.match(code, /B\(注释\)/);
});
t('括号内的内容一律不动', () => {
  const src = 'flowchart TD\n  A[开始（测试）] --> B';
  const { code } = applyFixes(src);
  assert.equal(code, src);
});

// --- subgraph / end -------------------------------------------------------
t('missing end appended', () => {
  const src = 'flowchart TD\n  subgraph S\n    a-->b';
  const { code, applied } = applyFixes(src);
  assert.match(code, /end\s*$/);
  assert.ok(applied.some((x) => x.rule === 'missing-end'));
});
t('extra end reported', () => {
  const a = analyze('flowchart TD\n  A-->B\n  end');
  assert.ok(a.issues.some((i) => i.rule === 'extra-end'));
});

// --- frontmatter ----------------------------------------------------------
t('split frontmatter', () => {
  const s = splitFrontmatter('---\na: 1\n---\nflowchart TD\n A');
  assert.equal(s.frontmatter, 'a: 1');
  assert.match(s.body, /^flowchart TD/);
});
t('no frontmatter', () => {
  const s = splitFrontmatter('flowchart TD\n A');
  assert.equal(s.frontmatter, '');
});

// --- error explanation ----------------------------------------------------
t('explain lexical error', () => {
  const e = explainError(new Error('Lexical error on line 2. Unrecognized text.'));
  assert.equal(e.kind, 'lexical');
  assert.equal(e.line, 2);
});
t('explain unknown diagram', () => {
  const e = explainError(new Error('No diagram type detected matching given configuration'));
  assert.equal(e.kind, 'unknown');
});
t('explain parse error', () => {
  const e = explainError(new Error('Parse error on line 5:\nfoo\n--^'));
  assert.equal(e.kind, 'parse');
  assert.equal(e.line, 5);
});


// --- init 指令迁移 ------------------------------------------------------
t('init 指令迁移到 frontmatter', () => {
  const src = "%%{init: {'theme':'forest', 'flowchart': {'curve':'basis'}}}%%\nflowchart TD\n A-->B";
  const r = applyFixes(src);
  assert.match(r.code, /^---\n/);
  assert.match(r.code, /theme: forest/);
  assert.match(r.code, /curve: basis/);
  assert.doesNotMatch(r.code, /%%\{init/);
});
t('init 迁移保留原有 frontmatter', () => {
  const src = "---\ntitle: 我的图\n---\n%%{init: {'theme':'dark'}}%%\nflowchart TD\n A-->B";
  const r = applyFixes(src);
  assert.match(r.code, /title: 我的图/);
  assert.match(r.code, /theme: dark/);
});
t('init 迁移可以关闭', () => {
  const src = "%%{init: {'theme':'forest'}}%%\nflowchart TD\n A-->B";
  const r = applyFixes(src, { includeInit: false });
  assert.match(r.code, /%%\{init/);
});
t('init 指令只是提示不会被自动当错误', () => {
  const a = analyze("%%{init: {'theme':'forest'}}%%\nflowchart TD\n A-->B");
  assert.equal(a.errorCount, 0);
  assert.ok(a.issues.some((i) => i.rule === 'init-directive'));
});

// --- sankey 中文节点名 --------------------------------------------------
t('sankey 中文节点名被检出', () => {
  const a = analyze('sankey-beta\n煤,发电,80');
  assert.ok(a.issues.some((i) => i.rule === 'sankey-cjk'));
});
t('sankey 英文节点名不误报', () => {
  const a = analyze('sankey-beta\nCoal,Power,80');
  assert.equal(a.issues.filter((i) => i.rule === 'sankey-cjk').length, 0);
});
t('非 sankey 图不受影响', () => {
  const a = analyze('flowchart TD\n  A[中文] --> B');
  assert.equal(a.issues.filter((i) => i.rule === 'sankey-cjk').length, 0);
});

// --- 不误伤新语法 --------------------------------------------------------
t('swimlane-beta 不被当成非法关键字', () => {
  const a = analyze('swimlane-beta LR\n  subgraph A\n    x --> y\n  end');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('usecase-beta 不被当成非法关键字', () => {
  const a = analyze('usecase-beta\nactor A("甲")');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('xychart-beta 不被当成非法关键字', () => {
  const a = analyze('xychart-beta\n  title "t"\n  x-axis ["a","b"]\n  bar [1,2]');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('block-beta 不被当成非法关键字', () => {
  const a = analyze('block-beta\n  columns 3\n  a b c');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('archetype-beta 不被当成非法关键字', () => {
  const a = analyze('architecture-beta\n  service s(server)[S]');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('sankey-beta 关键字合法', () => {
  const a = analyze('sankey-beta\nA,B,1');
  assert.equal(a.issues.filter((i) => i.rule === 'unknown-keyword').length, 0);
});
t('普通 flowchart 不会被误判', () => {
  const a = analyze('flowchart TD\n  A[开始] --> B[结束]');
  assert.equal(a.errorCount, 0);
});


// --- 自动修复边界（只动 auto:true 的规则）--------------------------
t('未知关键字不会被自动改写', () => {
  const src = 'foobarDiagram\n A';
  const { code, applied } = applyFixes(src);
  assert.equal(code, src);
  assert.equal(applied.length, 0);
});
t('sankey 中文节点名只提示不自动改', () => {
  const src = 'sankey-beta\n煤,发电,80';
  const { code, applied } = applyFixes(src);
  assert.equal(code, src);
  assert.equal(applied.length, 0);
});
t('多余的 end 只提示不自动删（避免误删）', () => {
  const src = 'flowchart TD\n  A-->B\n  end';
  const { code, applied } = applyFixes(src);
  assert.equal(code, src);
  assert.equal(applied.length, 0);
});
t('未闭合标签只提示不自动补（补错位置更糟）', () => {
  const src = 'flowchart TD\n  A[文本 --> B';
  const { code, applied } = applyFixes(src);
  assert.equal(code, src);
  assert.equal(applied.length, 0);
});
t('defaultRenderer 与关键字都会被自动修', () => {
  const src = '---\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\nswimlanes\n x';
  const { code, applied } = applyFixes(src);
  assert.match(code, /layout: elk/);
  assert.match(code, /swimlane-beta/);
  assert.equal(applied.length, 2);
});


t('init 迁移 + defaultRenderer 同存时两者都生效', () => {
  const src = "---\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\n%%{init: {'theme':'forest'}}%%\nflowchart TD\n A-->B";
  const { code, applied } = applyFixes(src);
  assert.doesNotMatch(code, /%%\{init/, 'init 指令必须被真正删掉');
  assert.match(code, /layout: elk/);
  assert.match(code, /theme: forest/);
  assert.equal(applied.length, 2);
});
t('init 迁移不能删错行（带 frontmatter 时行号偏移）', () => {
  const src = "---\ntitle: T\n---\n%%{init: {'theme':'forest'}}%%\nflowchart TD\n A-->B";
  const { code } = applyFixes(src);
  assert.match(code, /^flowchart TD$/m, 'flowchart 那行必须还在');
  assert.match(code, / A-->B/);
});

console.log(`\ncompat tests: ${pass} passed, ${fails.length} failed`);
for (const [n, m] of fails) console.log('  FAIL', n, '::', m);
process.exit(fails.length ? 1 : 0);
