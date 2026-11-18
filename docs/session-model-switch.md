# Switch model in a session

Requested by Jamie (2026-11-18): change the model of an existing session from the session page. Jamie approved the minimal design: the client sends the native Hermes `/model` command. No plugin, protocol or core change.

## Behavior

- Desktop: the Session status bar has a `Switch model` tool button, before `Archive`. A click reads the models of the Session's connection and opens a native menu: `Default (<primary model>)` first, then each other model as `<model> · <provider>`.
- Mobile: Session options has a `Switch model` row, after `Copy session link`. It opens the same model list that a new conversation uses (`ThreadModelPicker`, hint "Applies to this conversation only."). No row is marked as current. After a choice the page returns to the session.
- A choice sends `/model <model> --provider <provider> --session` as a normal message of that session. `Default` sends the primary model and provider.
- Hermes does the switch: lock, busy policy, session override, persistence across a Gateway restart, and a new agent on the next turn. Its reply shows in the timeline like any native command reply (see [m1-native-command-output.md](m1-native-command-output.md)). A cost or data-policy warning uses the native confirmation (`/approve` or `/cancel`).
- `--session` is required. Without it, a server with `model.persist_switch_by_default: true` writes the switch to `config.yaml`.
- The model of each reply already shows on the reply ([reply-models.md](reply-models.md)). The App does not store or show a separate current model.
- The control shows only when the server reports `thread_model` (the model list endpoint). Desktop disables the button while the connection is not online or a menu is open.

## Implementation

- `packages/client/src/threadModel.ts`: `threadModelSwitchCommand(settings, choice)` builds the command. It refuses provider and model text outside the plugin's ID rules (no spaces, `--`, `//`).
- Desktop: `ModelSwitch` in `src/renderer/session-status-bar.tsx`; it calls `getModelSettings(connectionKey)`, `showContextMenu` and `sendMessage`. `src/main/context-menu.ts` allows up to 64 menu items (was 16); the menu lists at most 60 models.
- Mobile: `src/SessionOptions.tsx` loads the list when the picker opens and enqueues the command in the outbox (`newSend`, same ID on every retry), like the `/retry` action. `ThreadModelPicker` accepts no `selected` value.

## Verification

- Shared client: `tests/new-topic.test.mjs` (command text, Default, refused values). Client check: 153 pass.
- Mobile: `tests/session-options.test.mjs` (row order, lazy load, outbox record, return, hidden without support). TypeScript passes. Mobile tests: 284, 283 pass, 1 skipped.
- Desktop: `tests/session-status-bar.test.mjs` in Chromium (tool order, connection, menu rows, sent text, Default, cancel, no support, offline) and `tests/session-menu.test.mjs` (menu limit). TypeScript and build pass. Full desktop tests: 325, 307 pass, 10 skipped, 8 fail. The same 8 Chromium tests (Settings focus and layout, font settings, history loading, auto bottom, message focus, composer focus, tab status) also fail on unchanged `main` `cc29dd7` in this environment.
- Not yet verified: a real `/model` switch on the dev server from each client, and Mac and iPhone hand checks.
