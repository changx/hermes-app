import { trimBareLink } from "../../../../packages/client/src/bareLinks";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/**
 * Cut each GFM bare link where `trimBareLink` says (`https://my.telegram.org，进入`)
 * and keep the rest as text. `<…>` and `[…](…)` links are not changed.
 */
export function remarkCjkAutolinks() {
  return (tree: MarkdownNode, file: { value?: unknown }): void => {
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    const visit = (node: MarkdownNode): void => {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "link") { visit(child); return [child]; }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        const text = child.children?.length === 1 && child.children[0].type === "text" ? child.children[0].value : undefined;
        if (start === undefined || end === undefined || !text || !child.url) return [child];
        const raw = source.slice(start, end);
        if (raw !== text || !child.url.endsWith(raw)) return [child];
        const kept = trimBareLink(raw);
        if (kept === raw) return [child];
        if (kept === null) return [{ type: "text", value: raw }];
        const prefix = child.url.slice(0, child.url.length - raw.length);
        return [{ ...child, url: prefix + kept, children: [{ type: "text", value: kept }] }, { type: "text", value: raw.slice(kept.length) }];
      });
    };
    visit(tree);
  };
}
