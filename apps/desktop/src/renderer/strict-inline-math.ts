type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/**
 * `remark-math` pairs any two single `$` signs, so prose prices such as
 * `（$59）和官方价格（$69.99）` become a formula. Apply the same delimiter rule as
 * the mobile renderer (apps/mobile/src/messageMarkdown.ts): no space after the
 * opening `$`, no space before the closing `$`, no line break inside, and no digit
 * right after the closing `$`. A rejected span is shown as its original text.
 */
export function remarkStrictInlineMath() {
  return (tree: MarkdownNode, file: { value?: unknown }): void => {
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    const visit = (node: MarkdownNode): void => {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (child.type !== "inlineMath") { visit(child); return child; }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (start === undefined || end === undefined) return child;
        const raw = source.slice(start, end);
        if (!raw.startsWith("$") || raw.startsWith("$$") || !raw.endsWith("$")) return child;
        const valid = raw.length > 2 && !/\s/.test(raw[1]) && !/\s/.test(raw[raw.length - 2])
          && !raw.includes("\n") && !/\d/.test(source[end] ?? "");
        return valid ? child : { type: "text", value: raw };
      });
    };
    visit(tree);
  };
}
