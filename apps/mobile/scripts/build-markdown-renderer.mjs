import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('katex/package.json'));
const katexScript = readFileSync(resolve(root, 'dist/katex.min.js'), 'utf8');
const css = readFileSync(resolve(root, 'dist/katex.min.css'), 'utf8').replace(/url\((fonts\/[^)]+)\)/g, (_, path) => {
  const ext = path.split('.').at(-1);
  const mime = ext === 'ttf' ? 'font/ttf' : `font/${ext}`;
  return `url(data:${mime};base64,${readFileSync(resolve(root, 'dist', path)).toString('base64')})`;
});
// Do not copy Mermaid's prebaked dist/mermaid.min.js: it embeds its own old
// lodash-es. Bundle the module graph from the installed, audited lockfile.
const lodashVersion = require('lodash-es/package.json').version;
if (!/^4\.(?:1[89]|[2-9]\d)\./.test(lodashVersion)) {
  throw new Error(`Unsafe lodash-es ${lodashVersion}; regenerate the mobile lockfile`);
}
const result = await build({
  entryPoints: [require.resolve('mermaid')], bundle: true, platform: 'browser',
  format: 'iife', globalName: 'messageMermaid', target: 'es2020', minify: true,
  write: false, legalComments: 'none', metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
if (!inputs.some(path => path.includes('/lodash-es/')) || inputs.some(path => path.endsWith('/mermaid.min.js'))) {
  throw new Error('Mermaid must bundle installed lodash-es modules, not its prebaked dist bundle');
}
const mermaidScript = result.outputFiles[0].text + '\nvar mermaid=messageMermaid.default;';
const output = `// Generated from installed pinned KaTeX/Mermaid packages. Never edit by hand.\n` +
  `export const KATEX_CSS = ${JSON.stringify(css)};\n` +
  `export const KATEX_SCRIPT = ${JSON.stringify(katexScript)};\n` +
  `export const MERMAID_SCRIPT = ${JSON.stringify(mermaidScript)};\n`;
writeFileSync(new URL('../src/markdownRenderer.generated.ts', import.meta.url), output);
console.log(`Bundled offline KaTeX CSS/fonts, KaTeX JS and Mermaid JS with lodash-es ${lodashVersion}`);
