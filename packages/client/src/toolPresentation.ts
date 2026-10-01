// Presentation only; never infer execution outcomes. File rules mirror the
// Discord path: gateway/run_turn_runner.py + agent/display.py (read-only source).
export function toolPresentation(rawName = ''): { icon: string; command: boolean } {
  const name = rawName.replace(/^functions\./, '');
  const icons: Record<string, string> = {
    read_file: '📖', skill_view: '📚', search_files: '🔎', web_search: '🔍',
    web_extract: '📄', browser: '🌐', browser_exec: '🌐', write_file: '✍️', patch: '🔧',
    terminal: '💻', execute_code: '🐍', tool_describe: '📖',
    hermes_tool_search: '🔎', process_manage: '⚙️',
  };
  return { icon: icons[name] ?? '⚙️', command: name === 'terminal' };
}

export function toolDisplayLabel(rawName = '', fallback: string): string {
  const name = rawName.replace(/^functions\./, '');
  const labels: Record<string, [string, string]> = { read_file: ['Read file', 'Reading'], write_file: ['Write file', 'Writing'], patch: ['Edit file', 'Editing'], terminal: ['Run command', 'terminal'] };
  return labels[name]?.[0] === fallback ? labels[name][1] : fallback;
}

const previewCap = (text: string) => {
  const chars = Array.from(text);
  return chars.length > 40 ? chars.slice(0, 37).join('') + '...' : text;
};

// Parse only already-safe known file summaries, never raw tool arguments.
// Basename + Lstart-end matches _preview_read_file/_read_file_line_label;
// writes/edits use the Discord default 40-character preview budget.
export function compactFileDetail(rawName: string, detail: string): string {
  const name = rawName.replace(/^functions\./, '');
  if (!['read_file', 'write_file', 'patch'].includes(name)) return detail;
  const fields = detail.split(' · ');
  if (name === 'read_file' && fields[0] && !fields[0].includes('://')) {
    const path = fields[0].replace(/^path=/, '');
    const file = path.endsWith('…') ? 'Path truncated' : path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
    const offset = fields.find(field => /^offset=\d+$/.test(field));
    const limit = fields.find(field => /^limit=\d+$/.test(field));
    const start = offset ? Number(offset.slice(7)) : 0;
    const count = limit ? Number(limit.slice(6)) : 0;
    const lines = start > 0 && Number.isSafeInteger(start) ? count > 1 && Number.isSafeInteger(count) && Number.isSafeInteger(start + count - 1) ? ` L${start}-${start + count - 1}` : ` L${start}` : '';
    return previewCap(file + lines);
  }
  return previewCap(detail);
}
