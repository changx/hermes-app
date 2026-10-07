# DESK-FIX-MARKDOWN-SPACING

- Baseline: `eefad6c`; candidate branch: `fix/desktop-markdown-spacing`.
- Scope: desktop Markdown whitespace only. No mobile, shared protocol, plugin, Hermes core, gateway, Expo service or release changes.

## Cause and change

The desktop `.message` container uses `white-space: pre-wrap`. ReactMarkdown emits newline text nodes between block elements and list items; these inherited preserved newlines generate anonymous line boxes in addition to paragraph/list margins. A dedicated `.message-markdown` wrapper resets whitespace to `normal` without rewriting stored text or stripping renderer output. Existing fenced code (`pre`) and tool command (`pre-wrap`) whitespace rules remain intact. Final-row margins, background, type size and line height are unchanged.

## Executed verification

`HERMES_TEST_CHROME=/usr/bin/google-chrome npm run desktop:check` passed: TypeScript, build, **75 tests passed, zero skipped**. The Chromium test renders the actual MessageContent component and current desktop CSS, compares inherited legacy whitespace against the candidate, and checks paragraphs, tight/loose/nested lists, headings, tables and code. No private chat or credentials are used.

At 16px type size and 600px content width:

| Metric | Before | After |
| --- | --- | --- |
| Paragraph → unordered list gap | 42.390625px | 8.796875px |
| Adjacent unordered list item gap | 24.796875px | 0px |
| Adjacent ordered list item gap | 24.796875px | 0px |
| Mixed fixture content height | 1460.03125px | 668.953125px |
| Text line height | 24.8px | 24.8px |
| Fenced code whitespace | `pre` | `pre` |
| Final background | `rgb(247, 245, 239)` | unchanged |

A zero item gap means no extra spacer line between item boxes, not zero baseline separation. Code text and indentation compare exactly equal.

Re-run browser layout coverage with `HERMES_TEST_CHROME` pointing to a Chrome/Chromium binary; without it the browser test is explicitly skipped, not reported as layout evidence.

## Remaining gates

- Mac native visual review and user confirmation: pending. Linux Chromium layout is not Mac Retina acceptance.
- New macOS install package, main merge and GitHub release: not performed. Candidate is isolated; the installed app is unchanged.
- Mobile / cross-device / backend checks: N/A for this desktop-only presentation correction.
