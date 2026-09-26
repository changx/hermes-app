import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

type InlineKind = 'em' | 'strong' | 'strike' | 'link';
export type Inline =
  | { kind: 'text' | 'code' | 'image'; text: string }
  | { kind: 'break' }
  | { kind: InlineKind; children: Inline[]; href?: string | null };
export type Block =
  | { kind: 'paragraph' | 'heading'; children: Inline[]; level?: number }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { kind: 'rule' };

// No HTML rendering or automatic remote-image loading. Keep linkify off to avoid
// turning untrusted plain text into an action without explicit Markdown syntax.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Only explicit web URLs may reach Linking.openURL; reject userinfo and controls. */
export function safeLinkUrl(href: string): string | null {
  if (!/^https?:\/\//i.test(href) || /[\s\u0000-\u001f\u007f\\]/u.test(href)) return null;
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
      current.push({ kind: 'image', text: token.content });
    } else if (token.type === 'code_inline') {
      current.push({ kind: 'code', text: token.content });
    } else if (token.content) {
      // html is disabled: literal <script> becomes an inert text node.
      current.push({ kind: 'text', text: token.content });
    }
  }
  return root;
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
      // Tight list items still carry inline tokens, even with hidden paragraphs.
      result.push({ kind: 'paragraph', children: inlineNodes(token.children || []) });
    } else if (token.type === 'fence' || token.type === 'code_block') {
      result.push({ kind: 'code', text: token.content, language: token.info.trim().split(/\s+/)[0].slice(0, 32) });
    } else if (token.type === 'blockquote_open') {
      result.push({ kind: 'quote', children: blocks(tokens, cursor, 'blockquote_close') });
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const ordered = token.type === 'ordered_list_open';
      const items: Block[][] = [];
      const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
      while (cursor.index < tokens.length && tokens[cursor.index].type !== close) {
        if (tokens[cursor.index].type === 'list_item_open') {
          cursor.index++;
          items.push(blocks(tokens, cursor, 'list_item_close'));
        } else cursor.index++;
      }
      cursor.index++; // matching list close
      result.push({ kind: 'list', ordered, start: Number(token.attrGet('start') || '1'), items });
    } else if (token.type === 'hr') {
      result.push({ kind: 'rule' });
    }
  }
  return result;
}

export function parseMessageMarkdown(text: string): Block[] {
  return blocks(markdown.parse(text, {}), { index: 0 });
}
