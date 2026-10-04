import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cache from '../src/renderResourceCache.ts';

export const noRenderResources = { useRenderResources: () => null, RenderResourceContext: { Provider: ({ children }) => children }, RenderResourceProvider: ({ children }) => children };
export function compile(file, modules, suffix = '', globals = {}) {
  const output = { exports: {} };
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8') + suffix;
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module: output, exports: output.exports, console, URL, queueMicrotask, ...globals, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; } });
  return output.exports;
}
export const loadMarkdownEngines = engines => compile('markdownEngines.ts', { './markdownRenderer.generated': engines });
export const loadReducedMotion = native => compile('reducedMotion.ts', { 'react-native': native });
export const loadRenderResources = React => compile('RenderResources.tsx', { react: React, './renderResourceCache': cache }, '\nexport const testBudget = budget;');
