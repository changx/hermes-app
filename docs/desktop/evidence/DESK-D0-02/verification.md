# DESK-D0-02 verification

Status: Done

This task verifies the Electron main/preload security boundary with automated checks. Real macOS launch remains assigned to `DESK-D0-05`.

## Implemented boundary

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `webviewTag: false`
- `allowRunningInsecureContent: false`
- permission checks and requests deny by default
- webview attachment is prevented
- renderer navigation and redirects are prevented
- new windows are always denied
- only credential-free HTTPS URLs may be passed to the system browser
- preload exposes one frozen, read-only runtime information method
- preload does not expose IPC, shell, filesystem or process execution
- renderer CSP has no remote, inline or evaluated script capability

## Verification

Run from the repository root:

```text
npm run desktop:check
git diff --check
```

Results:

- TypeScript: passed
- main/preload/renderer build: passed
- desktop tests: 6 passed, 0 failed
- security cases: required BrowserWindow flags, permission denial, webview denial, minimal preload, URL protocol/credential validation and CSP
- diff whitespace check: passed

## Not covered

- macOS process/window launch
- system browser observation
- OS permission prompts
- Keychain, files, notifications or other future IPC

These require later tasks and must preserve this default-deny baseline.
