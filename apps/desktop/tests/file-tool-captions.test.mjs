import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

test('desktop file rows show filenames despite server path captions, preserving safe details in titles', async () => {
  const calls = [
    { id: 'one', name: 'functions.patch', label: 'Edit file', caption: 'Editing /opt/projects/jamie/_worktrees/hermes...', detail: 'path=/opt/projects/jamie/_worktrees/hermes-app/task/EditorScreens.tsx' },
    { id: 'two', name: 'patch', label: 'Edit file', caption: 'Editing path=/repo/...', detail: 'path=/repo/a.ts · path=/repo/b.ts' },
  ];
  const snapshot = { revision: 1, phase: 'connected', selectedThreadId: 'thread', connectionState: 'online', connectionLabel: 'Connected', channels: [], threads: [], interactions: [], canLoadOlder: false, messages: [{ id: 'message', role: 'assistant', text: '', attachments: [], toolCalls: calls }] };
  const bundle = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname, loader: 'tsx', contents: `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { DesktopShellView } from './src/renderer/shell';
    export const html = renderToStaticMarkup(createElement(DesktopShellView, { snapshot: ${JSON.stringify(snapshot)} }));
  ` }, bundle: true, external: ['react', 'react/jsx-runtime', 'react-dom/server'], format: 'cjs', platform: 'node', write: false });
  const out = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), out, out.exports);
  const html = out.exports.html;
  const labels = [...html.matchAll(/<span class="tool-label"[^>]*>([^<]*)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Editing EditorScreens.tsx', 'Editing a.ts · b.ts']);
  assert.ok(html.includes(calls[0].detail));
  assert.ok(html.includes(calls[1].detail));
});
