type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };

const BLOCKS_WITH_TEXT = new Set(["code", "inlineCode", "math", "inlineMath", "html"]);

/**
 * Chat surfaces show a single newline as a line break, as the mobile renderer
 * (apps/mobile/src/messageMarkdown.ts) and chat platforms do. Each `\n` left in
 * a text node is a CommonMark soft break; it becomes a `break` node. Code and
 * math keep their own text.
 */
export function remarkLineBreaks() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children || BLOCKS_WITH_TEXT.has(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text" || !child.value?.includes("\n")) { visit(child); return [child]; }
        return child.value.split(/\r?\n/).flatMap((value, index): MarkdownNode[] =>
          [...(index ? [{ type: "break" }] : []), ...(value ? [{ type: "text", value }] : [])]);
      });
    };
    visit(tree);
  };
}

/**
 * Direct (native command) replies: each line of a top-level paragraph becomes
 * its own paragraph, so ordinary paragraph spacing separates the lines. Runs
 * after `remarkLineBreaks`; only top-level `break` nodes split a paragraph.
 */
export function remarkLineBlocks() {
  return (tree: MarkdownNode): void => {
    if (!tree.children) return;
    tree.children = tree.children.flatMap(node => {
      if (node.type !== "paragraph" || !node.children?.some(child => child.type === "break")) return [node];
      const lines: MarkdownNode[][] = [[]];
      for (const child of node.children) {
        if (child.type === "break") lines.push([]);
        else lines[lines.length - 1].push(child);
      }
      return lines.filter(line => line.length).map(children => ({ type: "paragraph", children }));
    });
  };
}
