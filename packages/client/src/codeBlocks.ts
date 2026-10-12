// Plain-text code blocks (no language, or text/txt/plaintext/plain) usually hold
// prose, logs or command output, so their lines wrap. Blocks in a programming
// language keep their lines and scroll sideways.
const PLAIN_TEXT_LANGUAGES = new Set(['', 'text', 'txt', 'plaintext', 'plain']);

export function wrapsCodeLines(language?: string | null): boolean {
  return PLAIN_TEXT_LANGUAGES.has((language ?? '').trim().toLowerCase());
}
