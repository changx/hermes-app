# DESK-D0-04 verification

Status: Done

## Gate coverage

`apps/desktop/tests/security-baseline.test.mjs` adds blocking checks for:

- dangerous BrowserWindow preferences, including Node integration, disabled isolation/sandbox/web security, enabled webviews and insecure mixed content
- CSP weakening through remote scripts, inline scripts or evaluated scripts
- the exact `hermesDesktop.getRuntimeInfo` preload surface
- broad `ipcRenderer`, shell, web frame, filesystem, child-process and environment access from preload
- Node, Electron, CommonJS or remote URL usage in renderer source
- unexpected runtime files in the built main, preload or renderer output

The negative tests inject representative `nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`, remote-script, evaluated-script and broad IPC mutations and assert that the corresponding gate rejects each one.

## Verification

Run from the repository root:

```text
npm run desktop:check
git diff --check
```

Results:

- TypeScript: passed
- main/preload/renderer build: passed
- desktop tests: 16 passed, 0 failed
- whitespace validation: passed

This is an automated regression gate, not an OS permission penetration test or third-party security audit.