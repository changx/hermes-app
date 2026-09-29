# DESK-D0-05 verification

Status: Done

## Target

- source commit: `b76eeaa6cb444dfa9cbc4cbfa8b3c9c96ca9b1e8`
- hardware architecture: Apple Silicon `arm64`
- macOS: 26.5
- Node: 24.14.1, installed under the acceptance directory without a system-level package installation
- npm: 11.11.0
- Electron: 40.10.2

The source was transferred with `git archive` from the pushed commit into an isolated checkout. No credentials or local uncommitted files were transferred.

## Build and automated checks

Commands:

```text
npm ci --no-audit --no-fund
npm run desktop:check
```

Results:

- clean install: 84 packages installed
- TypeScript: passed
- desktop main/preload/renderer build: passed
- tests: 11 passed, 0 failed
- npm emitted the existing non-fatal `boolean@3.2.0` deprecation warning

## Native process and visible window

The launched executable was reported as:

```text
Mach-O 64-bit executable arm64
```

Window enumeration found an onscreen `com.github.Electron` window at 1280×820. Its screenshot is [`../DESK-D0-03/mac/1280px.png`](../DESK-D0-03/mac/1280px.png). OCR recovered the Channels, Threads, Conversation, connection state and empty-state text, ruling out a blank renderer.

The renderer was also launched in complete app windows at 900×820 and the configured minimum 720×820. Those screenshots and checks are recorded in [`DESK-D0-03`](../DESK-D0-03/verification.md).

## Permissions and cleanup

- Accessibility remained disabled.
- Input Monitoring remained disabled.
- No TCC or system security setting was changed.
- Screen capture succeeded through the existing window-capture service despite its permission preflight reporting `false`; no permission prompt or setting change was attempted.
- The application was terminated normally after testing.
- A final window query returned zero `com.github.Electron` windows.
- Every recorded launcher/main PID was absent after shutdown.
- The temporary screenshot harness and generated application test-data directory were removed.
- The modified ignored build output used to select test widths was rebuilt from source and restored to the committed 1280 px default.
- The isolated checkout, pinned Node toolchain and command logs remain under `~/hermes-desktop-acceptance/` for reproducibility; they contain no credentials or real chat data.