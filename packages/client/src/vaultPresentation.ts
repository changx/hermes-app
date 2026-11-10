import type { VaultImportResult } from './index';

const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;

/** One plain sentence group for a finished password import, the same on mobile and desktop. */
export function vaultImportSummary(result: VaultImportResult): string {
  const parts: string[] = [];
  parts.push(result.added ? `Imported ${plural(result.added, 'login')}.` : 'No new logins.');
  if (result.updated) parts.push(`Updated ${plural(result.updated, 'saved login')} with a new password.`);
  if (result.unchanged) parts.push(`${plural(result.unchanged, 'login was', 'logins were')} already saved.`);
  const reasons = [
    [result.skipped.no_website, 'without a website'],
    [result.skipped.no_username, 'without a username'],
    [result.skipped.no_password, 'without a password'],
    [result.skipped.not_login, 'that are not logins (notes, cards)'],
  ].filter(([count]) => (count as number) > 0).map(([count, why]) => `${count} ${why}`);
  if (reasons.length) parts.push(`Skipped ${reasons.join(', ')}.`);
  if (result.otp_skipped) parts.push(`${plural(result.otp_skipped, 'authenticator key')} could not be used; Hermes will ask for those codes.`);
  return parts.join(' ');
}

/** Shown before and after an import: the export file holds every password in plain text. */
export const VAULT_IMPORT_DELETE_HINT = 'Delete the exported file now. It holds your passwords in plain text.';

/** Where to get an export, by source. */
export const VAULT_IMPORT_SOURCES = 'Export a CSV file from the Passwords app on a Mac (File > Export All Passwords to File), Bitwarden (Tools > Export vault, .csv), Chrome, Firefox or 1Password. Then pick the file here.';
