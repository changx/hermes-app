import { graphemeRanges } from './graphemeRanges';

export const MAX_LABELS = 10;
export const MAX_LABEL_GRAPHEMES = 30;
export const MAX_LABEL_BYTES = 1024;
export interface LabelMetadata { markers: string[]; markers_updated_at: number }
export interface LabelDetail extends LabelMetadata { thread_id: string; project_id: string }
export class LabelValidationError extends Error {}

const contains = (property: string, cp: number): boolean => {
  const spans = graphemeRanges[property];
  let lo = 0, hi = spans.length / 2;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid * 2 + 1] < cp) lo = mid + 1; else hi = mid; }
  return lo * 2 < spans.length && spans[lo * 2] <= cp;
};
const properties = ['CR', 'LF', 'Control', 'Extend', 'ZWJ', 'Regional_Indicator', 'Prepend', 'SpacingMark', 'L', 'V', 'T'];
const property = (cp: number): string => cp >= 0xac00 && cp <= 0xd7a3 ? ((cp - 0xac00) % 28 ? 'LVT' : 'LV') : properties.find(p => contains(p, cp)) ?? 'Other';

/** Unicode 17 UAX #29 extended graphemes; independent of native Intl support. */
export function labelGraphemes(value: string): string[] {
  const chars = Array.from(value), cps = chars.map(c => c.codePointAt(0)!), props = cps.map(property);
  const groups: string[] = [];
  let group = '';
  for (let i = 0; i < chars.length; i++) {
    const a = props[i - 1], b = props[i];
    let join = false;
    if (i) {
      if (a === 'CR' && b === 'LF') join = true;
      else if (['CR', 'LF', 'Control'].includes(a) || ['CR', 'LF', 'Control'].includes(b)) join = false;
      else if (a === 'L' && ['L', 'V', 'LV', 'LVT'].includes(b) || ['LV', 'V'].includes(a) && ['V', 'T'].includes(b) || ['LVT', 'T'].includes(a) && b === 'T') join = true;
      else if (['Extend', 'ZWJ', 'SpacingMark'].includes(b) || a === 'Prepend') join = true;
      else if (contains('InCB_Consonant', cps[i])) {
        let j = i - 1, linker = false;
        while (j >= 0 && (contains('InCB_Extend', cps[j]) || contains('InCB_Linker', cps[j]))) { linker ||= contains('InCB_Linker', cps[j]); j--; }
        join = linker && j >= 0 && contains('InCB_Consonant', cps[j]);
      }
      if (!join && b !== 'Control' && a === 'ZWJ' && contains('Extended_Pictographic', cps[i])) {
        let j = i - 2; while (j >= 0 && props[j] === 'Extend') j--;
        join = j >= 0 && contains('Extended_Pictographic', cps[j]);
      }
      if (!join && a === 'Regional_Indicator' && b === 'Regional_Indicator') {
        let n = 0; for (let j = i - 1; j >= 0 && props[j] === 'Regional_Indicator'; j--) n++;
        join = n % 2 === 1;
      }
    }
    if (!join && group) { groups.push(group); group = ''; }
    group += chars[i];
  }
  if (group) groups.push(group);
  return groups;
}

// An explicit Unicode White_Space set keeps Python and JS validation identical.
const onlyWhitespace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
export function validateLabel(value: unknown): string {
  if (typeof value !== 'string' || onlyWhitespace.test(value)) throw new LabelValidationError('Enter a label.');
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new LabelValidationError('Labels must use plain text on one line.');
  let bytes = 0;
  for (const ch of value) { const cp = ch.codePointAt(0)!; if (cp >= 0xd800 && cp <= 0xdfff) throw new LabelValidationError('This label contains an invalid character.'); bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4; }
  if (bytes > MAX_LABEL_BYTES || labelGraphemes(value).length > MAX_LABEL_GRAPHEMES) throw new LabelValidationError('Use 30 characters or fewer per label.');
  return value; // Preserve spaces, spelling, case and normalization exactly.
}
export function validateLabels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_LABELS) throw new LabelValidationError('Use up to 10 labels.');
  const labels = Array.from(value, validateLabel);
  if (new Set(labels).size !== labels.length) throw new LabelValidationError('That label is already in this list.');
  return labels;
}
export function labelTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new LabelValidationError('Invalid label save time.');
  return value;
}
export function parseLabelMetadata(value: Record<string, unknown>, optional = false): LabelMetadata {
  if (optional && value.markers === undefined && value.markers_updated_at === undefined) return { markers: [], markers_updated_at: 0 };
  return { markers: validateLabels(value.markers), markers_updated_at: labelTimestamp(value.markers_updated_at) };
}

export interface LabelFilter { labels: readonly string[]; noLabels: boolean }
export const emptyLabelFilter = (): LabelFilter => ({ labels: [], noLabels: false });
export const labelFilterActive = (filter: LabelFilter): boolean => filter.noLabels || filter.labels.length > 0;
export function matchesLabels(markers: readonly string[] | undefined, filter: LabelFilter): boolean {
  return !labelFilterActive(filter) || (!(markers?.length) && filter.noLabels) || !!markers?.some(label => filter.labels.includes(label));
}
export function labelCandidates(rows: readonly { markers?: readonly string[] }[]): string[] {
  return [...new Set(rows.flatMap(row => row.markers ?? []))].sort((a, b) => a.localeCompare(b) || (a < b ? -1 : a > b ? 1 : 0));
}
/** Widths are measured by each platform's actual rendered text, never guessed. */
export function labelPillLayout(width: number, natural: readonly number[], overflowWidths: readonly number[], gap = 4): { widths: number[]; hidden: number } {
  for (let count = natural.length; count >= 1; count--) {
    const hidden = natural.length - count, reserve = hidden ? (overflowWidths[hidden] ?? Infinity) + gap : 0;
    const room = width - reserve - gap * (count - 1);
    if (room < 32 * count) continue;
    const cap = count === 1 ? Math.min(140, room) : 140, widths = natural.slice(0, count).map(n => Math.min(n, cap));
    if (widths.reduce((sum, n) => sum + n, 0) <= room) return { widths, hidden };
  }
  return { widths: [], hidden: natural.length };
}
