type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** CJK and full-width punctuation never ends a real URL: `，。、；：！？（）「」【】“”…—`. */
const cjkPunctuation = /[\u2014\u2018-\u201f\u2026\u3000-\u303f\ufe10-\ufe1f\ufe30-\ufe4f\uff00-\uffef]/u;
const cjkLetter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** GFM drops these from the end of a literal autolink; repeat that after a cut. */
const trailing = /[?!.,:*_~]+$/;

/** Index where a bare URL stops: at CJK punctuation, or at CJK text glued to an ASCII host. */
export function bareUrlEnd(raw: string): number {
  const hostStart = raw.indexOf("//") + 2;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (cjkPunctuation.test(char)) return i;
    const inHost = i >= hostStart && !/[/?#]/.test(raw.slice(hostStart, i));
    if (inHost && cjkLetter.test(char) && /[A-Za-z0-9]/.test(raw[i - 1] ?? "")) return i;
  }
  return raw.length;
}

/**
 * GFM bare links run until whitespace, so `https://my.telegram.org，进入` links the
 * comma and the following Chinese words. Cut each bare link where `bareUrlEnd`
 * says, and keep the rest as text. `<…>` and `[…](…)` links are not changed.
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
        const cut = bareUrlEnd(raw);
        if (cut === raw.length) return [child];
        const kept = raw.slice(0, cut).replace(trailing, "");
        const prefix = child.url.slice(0, child.url.length - raw.length);
        const rest: MarkdownNode = { type: "text", value: raw.slice(kept.length) };
        if (!/[A-Za-z0-9]/.test(kept.slice(kept.indexOf("//") + 2))) return [{ type: "text", value: raw }];
        return [{ ...child, url: prefix + kept, children: [{ type: "text", value: kept }] }, rest];
      });
    };
    visit(tree);
  };
}
