import MarkdownIt from 'markdown-it';
import { isSessionLinkHref, sessionLinksInText } from '../../../packages/client/src/sessionLinks.ts';
import type Token from 'markdown-it/lib/token.mjs';

type InlineKind = 'em' | 'strong' | 'strike' | 'link';
export type Inline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'image'; text: string; src: string | null }
  | { kind: 'video'; text: string; src: string | null }
  | { kind: 'math'; text: string }
  | { kind: 'break' }
  | { kind: InlineKind; children: Inline[]; href?: string | null };
export type TableCell = { align: 'left' | 'center' | 'right' | null; children: Inline[] };
export type Block =
  | { kind: 'paragraph' | 'heading'; children: Inline[]; level?: number }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'diagram' | 'math'; text: string }
  | { kind: 'video'; text: string; src: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][]; checks: (boolean | null)[] }
  | { kind: 'table'; header: TableCell[]; rows: TableCell[][] }
  | { kind: 'rule' };

// markdown-it handles CommonMark and its built-in GFM tables/strikethrough.
// HTML remains inert; linkify covers bare URLs but the URL gate still applies.
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
markdown.linkify.add('hermesapp:', {
  validate(text, pos) {
    const candidate = sessionLinksInText('hermesapp:' + text.slice(pos))[0];
    return candidate?.start === 0 ? candidate.url.length - 'hermesapp:'.length : false;
  },
});

// Chat prose commonly closes bold after CJK punctuation with no following space.
// Add only those delimiter flags; markdown-it still owns pairing and nesting.
markdown.inline.ruler.before('emphasis', 'cjk_strong', (state, silent) => {
  if (silent || state.src.slice(state.pos, state.pos + 2) !== '**') return false;
  const scanned = state.scanDelims(state.pos, true);
  if (scanned.length !== 2) return false;
  const cjkPunctuation = /[。、，：；！？（）《》〈〉【】「」『』〔〕［］｛｝]/u;
  const open = scanned.can_open || cjkPunctuation.test(state.src[state.pos + 2] || '');
  const close = scanned.can_close || cjkPunctuation.test(state.src[state.pos - 1] || '');
  if (open === scanned.can_open && close === scanned.can_close) return false;
  for (let i = 0; i < 2; i++) {
    state.push('text', '', 0).content = '*';
    state.delimiters.push({ marker: 0x2A, length: 2, token: state.tokens.length - 1, end: -1, open, close });
  }
  state.pos += 2;
  return true;
});

// Delimiters are recognized here; KaTeX (not this tokenizer) interprets math.
markdown.inline.ruler.before('escape', 'message_math', (state, silent) => {
  const start = state.pos;
  if (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || '')) return false;
  let end = start + 1;
  while (end < state.posMax) {
    if (state.src[end] === '\\') { end += 2; continue; }
    if (state.src[end] === '\n' || state.src[end] === '`') return false;
    if (state.src[end] === '$' && state.src[end - 1] !== '$' && !/\s/.test(state.src[end - 1])) break;
    end++;
  }
  if (end >= state.posMax || (state.src[end + 1] && /\d/.test(state.src[end + 1]))) return false;
  if (!silent) state.push('message_math', '', 0).content = state.src.slice(start + 1, end);
  state.pos = end + 1;
  return true;
});

markdown.block.ruler.before('fence', 'message_display_math', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  if (!first.startsWith('$$')) return false;
  let close = start;
  let last = first;
  let delimiter = first.indexOf('$$', 2);
  while (delimiter < 0 && ++close < end) {
    last = state.src.slice(state.bMarks[close] + state.tShift[close], state.eMarks[close]);
    delimiter = last.indexOf('$$');
  }
  if (delimiter < 0) return false;
  if (silent) return true;
  const lines = [first.slice(2, close === start ? delimiter : undefined)];
  for (let line = start + 1; line < close; line++) {
    lines.push(state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]));
  }
  if (close !== start) lines.push(last.slice(0, delimiter));
  state.push('message_display_math', '', 0).content = lines.join('\n').trim();
  // A closing delimiter may share its line with ordinary prose. Keep that prose.
  const remainder = last.slice(delimiter + 2).trim();
  if (remainder) {
    state.push('paragraph_open', 'p', 1);
    const inline = state.push('inline', '', 0);
    inline.content = remainder;
    inline.children = [];
    state.push('paragraph_close', 'p', -1);
  }
  state.line = close + 1;
  return true;
});

/** Web URLs and strict App session links. Media uses a separate web-only gate. */
export function safeLinkUrl(href: string): string | null {
  if (isSessionLinkHref(href)) return href;
  if (!/^https?:\/\//i.test(href) || /[\s\p{Cc}\p{Cf}\\]/u.test(href)) return null;
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeMediaUrl(href: string): string | null {
  return href.length <= 2048 && /^https?:\/\//i.test(href) ? safeLinkUrl(href) : null;
}

export function isVideoUrl(href: string): boolean {
  try { return /\.(mp4|m4v|mov|webm)$/i.test(new URL(href).pathname); }
  catch { return false; }
}

function inlineNodes(tokens: Token[]): Inline[] {
  const root: Inline[] = [];
  const stack: Inline[][] = [root];
  for (const token of tokens) {
    const current = stack[stack.length - 1];
    if (['em_open', 'strong_open', 's_open', 'link_open'].includes(token.type)) {
      const kind = ({ em_open: 'em', strong_open: 'strong', s_open: 'strike', link_open: 'link' } as const)[token.type as 'em_open' | 'strong_open' | 's_open' | 'link_open'];
      const node: Inline = { kind, children: [], ...(kind === 'link' ? { href: safeLinkUrl(token.attrGet('href') || '') } : {}) };
      current.push(node);
      stack.push(node.children);
    } else if (['em_close', 'strong_close', 's_close', 'link_close'].includes(token.type)) {
      if (stack.length > 1) stack.pop();
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      current.push({ kind: 'break' });
    } else if (token.type === 'image') {
      const src = safeMediaUrl(token.attrGet('src') || '');
      current.push({ kind: src && isVideoUrl(src) ? 'video' : 'image', text: token.content, src });
    } else if (token.type === 'message_math') {
      current.push({ kind: 'math', text: token.content });
    } else if (token.type === 'code_inline') {
      current.push({ kind: 'code', text: token.content });
    } else if (token.content) {
      // html is disabled: literal <script> becomes an inert text node.
      current.push({ kind: 'text', text: token.content });
    }
  }
  return root;
}

function tableCell(tokens: Token[], cursor: { index: number }): TableCell {
  const open = tokens[cursor.index++];
  const align = /text-align:(left|center|right)/.exec(open.attrGet('style') || '')?.[1] as TableCell['align'] | undefined;
  const inline = tokens[cursor.index++];
  cursor.index++; // th_close or td_close
  return { align: align || null, children: inline?.type === 'inline' ? inlineNodes(inline.children || []) : [] };
}

function table(tokens: Token[], cursor: { index: number }): Block {
  const header: TableCell[] = [];
  const rows: TableCell[][] = [];
  let inHead = false;
  while (cursor.index < tokens.length && tokens[cursor.index].type !== 'table_close') {
    const token = tokens[cursor.index++];
    if (token.type === 'thead_open') inHead = true;
    if (token.type === 'thead_close') inHead = false;
    if (token.type === 'tr_open') {
      const cells: TableCell[] = [];
      while (cursor.index < tokens.length && tokens[cursor.index].type !== 'tr_close') {
        if (['th_open', 'td_open'].includes(tokens[cursor.index].type)) cells.push(tableCell(tokens, cursor));
        else cursor.index++;
      }
      cursor.index++; // tr_close
      if (inHead) header.push(...cells);
      else rows.push(cells);
    }
  }
  cursor.index++; // table_close
  return { kind: 'table', header, rows };
}

function blocks(tokens: Token[], cursor: { index: number }, end?: string): Block[] {
  const result: Block[] = [];
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index++];
    if (token.type === end) break;
    if (token.type === 'paragraph_open' || token.type === 'heading_open') {
      const inline = tokens[cursor.index++];
      const video = token.type === 'paragraph_open' && inline?.type === 'inline'
        ? /^<video src="([^"<>]+)" controls><\/video>$/i.exec(inline.content.trim()) : null;
      const videoSrc = video ? safeMediaUrl(video[1]) : null;
      if (videoSrc && isVideoUrl(videoSrc)) result.push({ kind: 'video', text: 'Video', src: videoSrc });
      else result.push({ kind: token.type === 'heading_open' ? 'heading' : 'paragraph',
        level: token.type === 'heading_open' ? Number(token.tag.slice(1)) : undefined,
        children: inline?.type === 'inline' ? inlineNodes(inline.children || []) : [] });
      cursor.index++; // matching paragraph_close / heading_close
    } else if (token.type === 'inline') {
      result.push({ kind: 'paragraph', children: inlineNodes(token.children || []) });
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const language = token.info.trim().split(/\s+/)[0].slice(0, 32);
      result.push(language.toLowerCase() === 'mermaid' ? { kind: 'diagram', text: token.content } : { kind: 'code', text: token.content, language });
    } else if (token.type === 'message_display_math') {
      result.push({ kind: 'math', text: token.content });
    } else if (token.type === 'blockquote_open') {
      result.push({ kind: 'quote', children: blocks(tokens, cursor, 'blockquote_close') });
    } else if (token.type === 'table_open') {
      result.push(table(tokens, cursor));
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const ordered = token.type === 'ordered_list_open';
      const items: Block[][] = [];
      const checks: (boolean | null)[] = [];
      const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
      while (cursor.index < tokens.length && tokens[cursor.index].type !== close) {
        if (tokens[cursor.index].type === 'list_item_open') {
          cursor.index++;
          const first = tokens[cursor.index]?.type === 'paragraph_open' ? tokens[cursor.index + 1] : undefined;
          const raw = first?.type === 'inline' ? /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content) : null;
          const text = first?.children?.[0];
          const rendered = text?.type === 'text' ? /^\[([ xX])\](?:[ \t]+|$)/.exec(text.content) : null;
          const check = raw && rendered ? raw[1].toLowerCase() === 'x' : null;
          if (check !== null && text) text.content = text.content.slice(rendered![0].length);
          checks.push(check);
          items.push(blocks(tokens, cursor, 'list_item_close'));
        } else cursor.index++;
      }
      cursor.index++; // matching list close
      result.push({ kind: 'list', ordered, start: Number(token.attrGet('start') || '1'), items, checks });
    } else if (token.type === 'hr') {
      result.push({ kind: 'rule' });
    }
  }
  return result;
}

export function parseMessageMarkdown(text: string): Block[] {
  return blocks(markdown.parse(text, {}), { index: 0 });
}

/** Scroll/media surfaces need a definite viewport; normal text sizes intrinsically. */
export function messageNeedsViewport(text: string): boolean {
  const inline = (nodes: Inline[]): boolean => nodes.some(node =>
    ['image', 'video', 'math'].includes(node.kind) || ('children' in node && inline(node.children)));
  const visit = (items: Block[]): boolean => items.some(block => {
    if (block.kind === 'paragraph' || block.kind === 'heading') return inline(block.children);
    if (block.kind === 'quote') return visit(block.children);
    if (block.kind === 'list') return block.items.some(visit);
    return true;
  });
  return visit(parseMessageMarkdown(text));
}
