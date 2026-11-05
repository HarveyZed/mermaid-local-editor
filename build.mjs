import { build } from 'esbuild';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'output');
const MERMAID_VERSION = process.env.MERMAID_VERSION || '12.3.0';
const MERMAID_PKG = path.join(HERE, 'vendor', 'mermaid', 'package');

async function ensureMermaid() {
  const dist = path.join(MERMAID_PKG, 'dist', 'mermaid.min.js');
  if (existsSync(dist)) return dist;
  const vendorDir = path.join(HERE, 'vendor');
  await mkdir(vendorDir, { recursive: true });
  const tgz = path.join(vendorDir, `mermaid-${MERMAID_VERSION}.tgz`);
  if (!existsSync(tgz)) {
    const url = `https://registry.npmjs.org/mermaid/-/mermaid-${MERMAID_VERSION}.tgz`;
    process.stdout.write(`downloading ${url}\n`);
    execFileSync('curl', ['-sL', '--max-time', '300', '-o', tgz, url]);
  }
  const dir = path.join(vendorDir, 'mermaid');
  await mkdir(dir, { recursive: true });
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  return dist;
}

/** 内联到 <script> 里时必须转义 </script> */
function safeInline(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const mermaidDist = await ensureMermaid();

  // 1) 打包应用（含 CodeMirror / yaml / pako）
  const appOut = path.join(HERE, 'build', 'app.bundle.js');
  await build({
    entryPoints: [path.join(HERE, 'src', 'app.js')],
    outfile: appOut,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox110', 'safari17'],
    minify: true,
    legalComments: 'none',
    define: { __MERMAID_VERSION__: JSON.stringify(MERMAID_VERSION) },
    logLevel: 'info',
  });

  const [tpl, css, mermaidJs, appJs] = await Promise.all([
    readFile(path.join(HERE, 'src', 'index.html'), 'utf8'),
    readFile(path.join(HERE, 'src', 'styles.css'), 'utf8'),
    readFile(mermaidDist, 'utf8'),
    readFile(appOut, 'utf8'),
  ]);

  const html = tpl
    .replace('/*__CSS__*/', () => css)
    .replace('/*__MERMAID__*/', () => safeInline(mermaidJs))
    .replace('/*__VENDOR__*/', () => '')
    .replace('/*__APP__*/', () => safeInline(appJs));

  const outFile = path.join(OUT_DIR, 'mermaid-local-editor.html');
  await writeFile(outFile, html, 'utf8');
  const s = await stat(outFile);
  process.stdout.write(`\nbuilt ${outFile}  ${(s.size / 1048576).toFixed(2)} MB\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
