# DESK-D0-03 verification

Status: Done

Automated renderer acceptance and the required real-Mac width checks are complete.

## Implemented shell

- semantic Channels, Threads and Conversation regions
- explicit disconnected and empty states with natural English UI text
- disabled, labelled placeholders for actions that are not implemented
- 720 px BrowserWindow minimum
- three columns at normal width
- Channels hidden at 1024 px and below
- Threads hidden at 760 px and below
- responsive changes use CSS only, so pane content is not conditionally unmounted
- top-level redacted error boundary that does not display raw exceptions
- no renderer Node or Electron imports
- local fonts/styles only; no CDN or remote scripts

## Verification

Run from the repository root:

```text
npm run desktop:check
git diff --check
```

Results:

- TypeScript: passed
- main/preload/renderer build: passed
- desktop tests: 11 passed, 0 failed
- static renderer render verifies all three labelled regions
- placeholders are labelled and disabled
- responsive breakpoints and reduced-motion policy are present
- top-level error boundary uses user-safe copy

## Mac mini evidence

Commit `b76eeaa6cb444dfa9cbc4cbfa8b3c9c96ca9b1e8` was built and launched with Electron `40.10.2` on an Apple Silicon Mac mini running macOS 26.5. The application was captured at three real BrowserWindow widths:

| Window | Expected visible panes | Evidence | SHA-256 |
| --- | --- | --- | --- |
| 1280×820 | Channels, Threads, Conversation | [`mac/1280px.png`](mac/1280px.png) | `90065f820e5c1e93f480e603a82f6cab3e41918424f328a454f36153e75f7298` |
| 900×820 | Threads, Conversation | [`mac/900px.png`](mac/900px.png) | `1bd7ed657b474b0bbf747d2c8f36f7eb58f6a15a24be8769b1ae0a413b82c9a6` |
| 720×820 | Conversation | [`mac/720px.png`](mac/720px.png) | `2c425b49cc73f96576bd0e25ee0aae73290d4b43c2308e9153646f78771037cd` |

Window enumeration confirmed each requested logical width. OCR confirmed that hidden pane headings were absent at their respective breakpoints while the Conversation empty state remained visible. The screenshots contain only static placeholder content—no credentials, internal IDs or real chat data.
