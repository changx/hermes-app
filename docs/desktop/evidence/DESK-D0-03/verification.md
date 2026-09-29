# DESK-D0-03 verification

Status: Review

Automated renderer acceptance is complete. This card remains in Review until `DESK-D0-05` can launch the app and capture the required real-Mac widths.

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

## Remaining manual evidence

After `DESK-D0-05` starts the app on the Mac mini, capture the same commit at:

1. normal three-column width
2. medium two-column width
3. narrow single-content width

The screenshots must contain no credentials, internal IDs or real chat data.
