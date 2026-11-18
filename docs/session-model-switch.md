# Switch model in a session

Requested by Jamie (2026-11-18): change the model of an existing session from the session page. Jamie approved the minimal design: the client sends the native Hermes `/model` command. No plugin, protocol or core change.

## Behavior

- Desktop: the Session status bar has a `Switch model` tool button, before `Archive`. A click opens the `Switch model` dialog. It reads the models of the Session's connection and lists all of them: `Default (<primary model>)` first, then each other model with its provider. A search field filters by model or provider name; Enter picks the first match. Escape or `Cancel` closes the dialog without a change. A failed send keeps the dialog open with a short message.
- Mobile: Session options has a `Switch model` row, after `Copy session link`. It opens the same model list that a new conversation uses (`ThreadModelPicker`, hint "Applies to this conversation only."). No row is marked as current. After a choice the page returns to the session.
- A choice sends `/model <model> --provider <provider> --session` as a normal message of that session. `Default` sends the primary model and provider.
- Hermes does the switch: lock, busy policy, session override, persistence across a Gateway restart, and a new agent on the next turn. Its reply shows in the timeline like any native command reply (see [m1-native-command-output.md](m1-native-command-output.md)). A cost or data-policy warning uses the native confirmation (`/approve` or `/cancel`).
- `--session` is required. Without it, a server with `model.persist_switch_by_default: true` writes the switch to `config.yaml`.
- The model of each reply already shows on the reply ([reply-models.md](reply-models.md)). The App does not store or show a separate current model.
- The control shows only when the server reports `thread_model` (the model list endpoint). Desktop disables the button while the connection is not online or the dialog is open.
- A server can list hundreds of models (the dev server lists 494 in 12 providers). Both clients therefore use a scrolling list with search, not a menu.

## Implementation

- `packages/client/src/threadModel.ts`: `threadModelSwitchCommand(settings, choice)` builds the command. It refuses provider and model text outside the plugin's ID rules (no spaces, `--`, `//`).
- Desktop: `ModelSwitch` and `ModelDialog` in `src/renderer/session-status-bar.tsx` (portal to `document.body`, `modal-backdrop` / `editor-dialog` styles). It calls `getModelSettings(connectionKey)` and `sendMessage`. No IPC or main-process change.
- Mobile: `src/SessionOptions.tsx` loads the list when the picker opens and enqueues the command in the outbox (`newSend`, same ID on every retry), like the `/retry` action. `ThreadModelPicker` accepts no `selected` value.

## Verification

- Shared client: `tests/new-topic.test.mjs` (command text, Default, refused values). Client check: 153 pass.
- Mobile: `tests/session-options.test.mjs` (row order, lazy load, outbox record, return, hidden without support). TypeScript passes. Mobile tests: 284, 283 pass, 1 skipped.
- Desktop: `tests/session-status-bar.test.mjs` in Chromium with 303 models: tool order, connection, all rows, the dialog fits the window and the list scrolls, search focus and filter, Enter, Default, a model deep in the list, no match, Escape, Cancel, failed send, no support, offline. TypeScript and build pass. Full desktop tests: 325, 307 pass, 10 skipped, 8 fail. The same 8 Chromium tests (Settings focus and layout, font settings, history loading, auto bottom, message focus, composer focus, tab status) also fail on unchanged `main` `cc29dd7` in this environment.
- Real server (2026-11-18, dev `agent.tuly.space`, temporary thread `th_8716a677f1b74d1bad81f02f`, archived): the exact client text `/model claude-haiku-5-5 --provider anthropic --session` completed with the native reply "Model switched to `claude-haiku-5-5` … (session only)". The next reply's model was `claude-haiku-5-5`. `config.yaml` SHA-256 was the same before and after.
- Not yet verified: Mac and iPhone hand checks.

## Release record

- 2026-11-18 (authorized by Jamie: "合并发布"): `main` `7498dcb` (merge `debdceb`, tag `v0.1.143`). Mobile: only `hermes-app-expo.service` restarted (PID 1054361 → 2952299); the iOS and Android manifests return 200 with SDK 58, and both launchAssets return 200 with the new markers. TestFlight update `c24c8c91-3009-4e26-a42f-d1b141ebd9a3` (runtime `b32a4b59…`) is published; the public update manifest offers it and its bundle has the new text. Gateway PID 2898973 unchanged; plugin unchanged.
- Desktop v0.1.143 was stopped before publication: it used a native menu that showed only 60 of the 494 dev models. The Mac mini build was stopped during signing; no Release or update exists for `v0.1.143`. The dialog fix ships as desktop v0.1.144.
- 2026-11-18, desktop **v0.1.144** (fix `d953e20`, merge `699fe06`, release commit `70b773c`, tag `v0.1.144`), built with `scripts/macmini-desktop-release.sh`. Mac mini tests: 261 pass, 0 fail, 64 skipped; `npm audit` 0 vulnerabilities. Signing: `valid on disk`, `Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`, DMG and app `source=Notarized Developer ID`, staple validated. All 10 `App code SHA-256` lines match a local `npm run build` of `70b773c`. The Release has the DMG and `.sha256` only. The update feed offers 0.1.144 to 0.1.142 (200) and answers 204 to 0.1.144. Releases kept: v0.1.144 and v0.1.142. Mobile, Expo, plugin and Gateway were not changed by this step.
