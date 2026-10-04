import { KATEX_CSS, KATEX_SCRIPT, MERMAID_SCRIPT } from './markdownRenderer.generated';

export { KATEX_CSS };
const scripts: Partial<Record<'math' | 'diagram', string>> = {};

/** Escape public immutable engine code once, not once per message/article.
 * Each WebView still owns a separate JS execution environment. */
export function markdownEngineScript(kind: 'math' | 'diagram'): string {
  return scripts[kind] ??= (kind === 'math' ? KATEX_SCRIPT : MERMAID_SCRIPT).replace(/<\/script/gi, '<\\/script');
}
