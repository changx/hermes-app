import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultImportSummary } from '../src/vaultPresentation.ts';

const none = { not_login: 0, no_website: 0, no_username: 0, no_password: 0 };

test('import summary names every outcome in plain words', () => {
  assert.equal(vaultImportSummary({ added: 1, updated: 0, unchanged: 0, otp_skipped: 0, skipped: none }), 'Imported 1 login.');
  assert.equal(vaultImportSummary({ added: 120, updated: 3, unchanged: 2, otp_skipped: 1, skipped: { ...none, no_username: 4, not_login: 1 } }),
    'Imported 120 logins. Updated 3 saved logins with a new password. 2 logins were already saved. '
    + 'Skipped 4 without a username, 1 that are not logins (notes, cards). 1 authenticator key could not be used; Hermes will ask for those codes.');
  assert.equal(vaultImportSummary({ added: 0, updated: 0, unchanged: 1, otp_skipped: 0, skipped: none }), 'No new logins. 1 login was already saved.');
});
