import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

type InlineKind = 'em' | 'strong' | 'strike' | 'link';
export type Inline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'image'; text: string; src: string | null }
  | { kind: 'break' }
  | { kind: InlineKind; children: Inline[]; href?: string | null };
export type TableCell = { align: 'left' | 'center' | 'right' | null; children: Inline[] };
export type Block =
  | { kind: 'paragraph' | 'heading'; children: Inline[]; level?: number }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][]; checks: (boolean | null)[] }
  | { kind: 'table'; header: TableCell[]; rows: TableCell[][] }
  | { kind: 'rule' };

// markdown-it handles CommonMark and its built-in GFM tables/strikethrough.
// HTML remains inert; linkify covers bare URLs but the URL gate still applies.
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

/** Only web URLs may be opened or loaded; reject userinfo and controls. */
export function safeLinkUrl(href: string): string | null {
  if (!/^https?:\/\//i.test(href) || /[\s\p{Cc}\p{Cf}\\]/u.test(href)) return null;
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
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
      current.push({ kind: 'image', text: token.content, src: safeLinkUrl(token.attrGet('src') || '') });
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
      result.push({ kind: token.type === 'heading_open' ? 'heading' : 'paragraph',
        level: token.type === 'heading_open' ? Number(token.tag.slice(1)) : undefined,
        children: inline?.type === 'inline' ? inlineNodes(inline.children || []) : [] });
      cursor.index++; // matching paragraph_close / heading_close
    } else if (token.type === 'inline') {
      result.push({ kind: 'paragraph', children: inlineNodes(token.children || []) });
    } else if (token.type === 'fence' || token.type === 'code_block') {
      result.push({ kind: 'code', text: token.content, language: token.info.trim().split(/\s+/)[0].slice(0, 32) });
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
