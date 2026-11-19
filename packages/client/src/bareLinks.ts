/** CJK and full-width punctuation never ends a real URL: `，。、；：！？（）「」【】“”…—`. */
const cjkPunctuation = /[\u2014\u2018-\u201f\u2026\u3000-\u303f\ufe10-\ufe1f\ufe30-\ufe4f\uff00-\uffef]/u;
const cjkLetter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** GFM drops these from the end of a bare link; repeat that after a cut. */
const trailing = /[?!.,:*_~]+$/;

/**
 * Bare-link scanners (GFM, linkify-it) run a link up to whitespace, so
 * `https://my.telegram.org，进入` links the comma and the Chinese words. Return the
 * visible link text to keep, or null when the link has nothing left. The link stops at
 * CJK punctuation, or at CJK text glued to an ASCII host. CJK text in a path is kept.
 */
export function trimBareLink(raw: string): string | null {
  const hostStart = raw.indexOf("//") + 2;
  let end = raw.length;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (cjkPunctuation.test(char)) { end = i; break; }
    const inHost = i >= hostStart && !/[/?#]/.test(raw.slice(hostStart, i));
    if (inHost && cjkLetter.test(char) && /[A-Za-z0-9]/.test(raw[i - 1] ?? "")) { end = i; break; }
  }
  if (end === raw.length) return raw;
  const kept = raw.slice(0, end).replace(trailing, "");
  return /[A-Za-z0-9]/.test(kept.slice(kept.indexOf("//") + 2)) ? kept : null;
}
