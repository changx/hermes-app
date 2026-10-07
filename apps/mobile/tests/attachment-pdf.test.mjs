import test from 'node:test';
import assert from 'node:assert/strict';
import { isPdf } from '../src/filePreviewKind.ts';

const bytes = text => new TextEncoder().encode(text);

test('PDF is recognised by name or MIME and confirmed by signature', () => {
  assert.equal(isPdf('application/pdf', 'report'), true);
  assert.equal(isPdf(undefined, 'Report.PDF'), true);
  assert.equal(isPdf('application/pdf', 'report.pdf', bytes('%PDF-1.7\n')), true);
  assert.equal(isPdf('application/pdf', 'report.pdf', bytes('<html>')), false);
  assert.equal(isPdf('application/pdf', 'report.pdf', bytes('%PD')), false);
  assert.equal(isPdf('text/plain', 'notes.txt', bytes('%PDF-1.7')), false);
});
