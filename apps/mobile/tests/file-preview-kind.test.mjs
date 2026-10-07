import test from 'node:test';
import assert from 'node:assert/strict';
import { previewKind, previewSuffix } from '../src/filePreviewKind.ts';

const bytes = text => new TextEncoder().encode(text);

test('common file types map to an in-app viewer by name, then MIME', () => {
  const cases = [
    ['photo.JPG', undefined, 'image'], ['scan', 'image/png', 'image'], ['shot.heic', undefined, 'image'],
    ['report.pdf', undefined, 'pdf'], ['download', 'application/pdf', 'pdf'],
    ['README.md', 'text/plain', 'markdown'], ['notes', 'text/markdown', 'markdown'],
    ['page.html', undefined, 'html'], ['index.htm', 'text/plain', 'html'], ['gen', 'text/html; charset=utf-8', 'html'],
    ['clip.mp4', undefined, 'video'], ['screen.MOV', undefined, 'video'], ['stream', 'video/webm', 'video'],
    ['voice.m4a', undefined, 'audio'], ['song.mp3', undefined, 'audio'], ['memo', 'audio/ogg', 'audio'],
    ['plan.docx', undefined, 'document'], ['sheet.xlsx', undefined, 'document'], ['deck.key', undefined, 'document'], ['letter.rtf', undefined, 'document'],
    ['data.csv', undefined, 'text'], ['config.yaml', undefined, 'text'], ['main.py', undefined, 'text'], ['run.log', undefined, 'text'],
    ['payload', 'application/json', 'text'], ['logo.svg', 'image/svg+xml', 'text'], ['plain', 'text/plain', 'text'],
    ['archive.zip', 'application/zip', 'other'], ['binary', 'application/octet-stream', 'other'], ['', undefined, 'other'],
  ];
  for (const [name, mime, kind] of cases) assert.equal(previewKind(name, mime), kind, `${name} ${mime ?? ''}`);
});

test('a declared PDF must carry the PDF signature once the bytes are known', () => {
  assert.equal(previewKind('report.pdf', 'application/pdf', bytes('%PDF-1.7\n')), 'pdf');
  assert.equal(previewKind('report.pdf', 'application/pdf', bytes('<html>not a pdf')), 'other');
  assert.equal(previewKind('page.html', undefined, bytes('%PDF-1.7')), 'html');
});

test('cache files keep the original extension for native decoders', () => {
  assert.equal(previewSuffix('Clip.MOV'), '.mov');
  assert.equal(previewSuffix('archive.tar.gz'), '.gz');
  assert.equal(previewSuffix('no-extension'), '');
  assert.equal(previewSuffix('../evil/x.pdf'), '.pdf');
  assert.equal(previewSuffix('weird.$x'), '');
});
