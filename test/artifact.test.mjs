/**
 * 产物完整性测试 —— 把「单文件、离线、零网络请求」这个核心承诺变成可断言的。
 *
 * 这些断言守护的是这个项目最核心的卖点：双击即用、运行时一个网络请求都不发。
 * 一旦有人往产物里塞了外链资源（比如某个 CDN 字体、图片、CDN 化的 mermaid），
 * 这里就会红。
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ART = path.join(ROOT, 'output', 'mermaid-local-editor.html');

let pass = 0;
const fails = [];
async function t(name, fn) {
  try {
    await fn();
    pass += 1;
  } catch (e) {
    fails.push([name, e.message]);
  }
}

const html = await readFile(ART, 'utf8');
const size = (await stat(ART)).size;

await t('产物存在且已把 mermaid 内联进来（> 5MB）', () => {
  assert.ok(size > 5 * 1024 * 1024, `产物只有 ${size} 字节，mermaid 可能没内联`);
});

await t('没有任何外链资源引用（src/href 指向 http）', () => {
  const hits = html.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || [];
  assert.equal(hits.length, 0, `发现 ${hits.length} 处外链：${hits.slice(0, 3).join(' | ')}`);
});

await t('没有外链脚本 / 样式表', () => {
  assert.ok(!/<script[^>]+src\s*=/i.test(html), '存在 <script src=...>');
  assert.ok(!/<link[^>]+rel\s*=\s*["']?stylesheet/i.test(html), '存在 <link rel=stylesheet>');
});

await t('CSS 里没有远程 url() / @import', () => {
  const urlHits = html.match(/url\(\s*['"]?https?:\/\//gi) || [];
  assert.equal(urlHits.length, 0, `发现 ${urlHits.length} 处远程 url()`);
  // @import 只允许作为 CSS 解析器的关键字常量出现（如 mermaid 里的 mKr="@import"），
  // 不允许是真正的 @import 规则（后面必须跟 url( 或 "）
  const realImports = html.match(/@import\s+(url\(|["'])/gi) || [];
  assert.equal(realImports.length, 0, `发现 ${realImports.length} 条真正的 @import 规则`);
});

await t('所有 script 都是内联的（没有外部引用）', () => {
  const srcCount = (html.match(/<script\b[^>]*>/gi) || []).length;
  const withSrc = (html.match(/<script[^>]+src\s*=/gi) || []).length;
  assert.equal(withSrc, 0, `有 ${withSrc} 个 script 带 src`);
  assert.ok(srcCount >= 3, `只找到 ${srcCount} 个 script，结构可能变了`);
});

await t('带上了内置 mermaid 版本号', () => {
  assert.match(html, /12\.\d+\.\d+/, '找不到 mermaid 版本标记');
});

await t('自带 ZIP 打包器（多图导出的关键件）', () => {
  // 注意：esbuild 会把 0x04034b50 这类十六进制常量压成十进制，
  // 所以这里查 MIME 与 CRC32 多项式的十进制形式
  assert.ok(html.includes('application/zip'), 'ZIP 的 MIME 类型不见了');
  assert.ok(html.includes('3988292384'), 'ZIP 的 CRC32 多项式不见了（0xEDB88320）');
  assert.ok(html.includes('101010256'), 'ZIP 的 EOCD 签名不见了（0x06054B50）');
});

await t('escapeHtml 用了真实实体（审计 D-2 回归防护）', () => {
  assert.ok(html.includes('&amp;') && html.includes('&lt;') && html.includes('&#39;'),
    'escapeHtml 的实体表不见了');
});

// 注：像「found.length > 1」这类局部变量名在 esbuild 压缩后会被改名，
// 在产物里断言它没有意义（永远命中不了）。这类逻辑回归由 test/compat.test.mjs
// 在源码层守住。

console.log(`\nartifact tests: ${pass} passed, ${fails.length} failed`);
for (const [n, m] of fails) console.log('  FAIL', n, '::', m);
process.exit(fails.length ? 1 : 0);
