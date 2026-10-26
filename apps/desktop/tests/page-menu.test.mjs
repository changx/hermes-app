import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(file) {
  const out = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
const { pageMenuEntries, webSearchUrl, searchText, PAGE_SHORTCUTS } = await load('../src/main/page-menu.ts');
const labels = entries => entries.map(entry => 'separator' in entry ? '—' : entry.label);

test('page menu: selected text gives Copy, then web, page and Hermes search with their shortcuts', () => {
  const entries = pageMenuEntries({ selectionText: '  OceanPay\n compliance  ' }, true);
  assert.deepEqual(labels(entries), ['Copy', '—', 'Search the Web for “OceanPay compliance”', 'Find “OceanPay compliance” in Page', 'Search Hermes for “OceanPay compliance”']);
  assert.deepEqual(entries.filter(entry => entry.action).map(entry => [entry.action, entry.accelerator]),
    [['copy', 'CmdOrCtrl+C'], ['search-web', PAGE_SHORTCUTS.searchWeb], ['find', PAGE_SHORTCUTS.findSelection], ['search-app', PAGE_SHORTCUTS.searchApp]]);
});

test('page menu: no selection offers Find in Page and Search Hermes only; no find without a page', () => {
  assert.deepEqual(labels(pageMenuEntries({ selectionText: '' }, true)), ['Find in Page…', 'Search Hermes…']);
  assert.deepEqual(labels(pageMenuEntries({ selectionText: '   ' }, false)), ['Search Hermes…']);
  assert.deepEqual(labels(pageMenuEntries({ selectionText: 'word' }, false)), ['Copy', '—', 'Search the Web for “word”', 'Search Hermes for “word”']);
});

test('page menu: text fields get Cut, Copy, Paste and Select All with the edit state', () => {
  const empty = pageMenuEntries({ isEditable: true, selectionText: '', editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }, true);
  assert.deepEqual(labels(empty), ['Cut', 'Copy', 'Paste', 'Select All', '—', 'Find in Page…', 'Search Hermes…']);
  assert.deepEqual(empty.slice(0, 4).map(entry => entry.enabled), [false, false, true, true]);
  const selected = pageMenuEntries({ isEditable: true, selectionText: 'draft', editFlags: { canCut: true, canCopy: true, canPaste: false, canSelectAll: true } }, true);
  assert.deepEqual(selected.slice(0, 4).map(entry => entry.enabled), [true, true, false, true]);
  assert.equal(selected.at(-1).label, 'Search Hermes for “draft”');
});

test('page menu: web links add Copy Link; other schemes do not', () => {
  assert.deepEqual(labels(pageMenuEntries({ linkURL: 'https://example.com/a' }, true)), ['Copy Link', '—', 'Find in Page…', 'Search Hermes…']);
  assert.deepEqual(labels(pageMenuEntries({ linkURL: 'hermesapp://session/th_x' }, true)), ['Find in Page…', 'Search Hermes…']);
});

test('page menu: long selections are shortened in the label and the query', () => {
  const long = 'a'.repeat(30);
  assert.equal(pageMenuEntries({ selectionText: long }, true)[2].label, `Search the Web for “${'a'.repeat(23)}…”`);
  assert.equal(searchText('x'.repeat(600)).length, 500);
  assert.equal(searchText(42), '');
});

test('web search URL: Google with the encoded one-line query; nothing for empty text', () => {
  assert.equal(webSearchUrl(' 寻汇 费率 &x=1\n'), 'https://www.google.com/search?q=%E5%AF%BB%E6%B1%87%20%E8%B4%B9%E7%8E%87%20%26x%3D1');
  assert.equal(webSearchUrl('  '), undefined);
  assert.equal(webSearchUrl(undefined), undefined);
});

test('Cmd+click: background-tab requests open http and https links without credentials in the system browser', async () => {
  const { isSystemBrowserUrl, opensInSystemBrowser } = await load('../src/main/security.ts');
  assert.equal(opensInSystemBrowser('background-tab'), true);
  for (const disposition of ['foreground-tab', 'new-window', 'default', 'other']) assert.equal(opensInSystemBrowser(disposition), false);
  assert.equal(isSystemBrowserUrl('https://example.com/a?b=1'), true);
  assert.equal(isSystemBrowserUrl('http://example.org/'), true);
  for (const url of ['https://user:pw@example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'hermesapp://session/th_x', 'mailto:a@b.c', 'not a url']) assert.equal(isSystemBrowserUrl(url), false, url);
});
