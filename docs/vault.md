# Passwords & Logins (Hermes vault)

Status: candidate. Branch `feat/vault` in this repository and in `hermes-app-plugin`. Not released.

## Requirement

Jamie asked to bring the Hermes vault ("Passwords & Logins") to the Hermes App desktop and mobile apps, without changes to Hermes core.

Confirmed scope:

1. **Settings (P1):** list, add and remove the saved logins and addresses of the connected Hermes profile.
2. **In-chat prompts (P2):** when the agent reaches a sign-in page with no saved login, the App shows a masked "Save login" form. When a site sends a one-time code, the App shows a "Verification code" form. The agent never sees the password or the code.

Out of scope (Jamie's decision):

- Payment cards. The App does not list, add, remove or fill cards.
- Password managers (1Password, Bitwarden). The App never asks for a master password and never unlocks a manager. The host has no `op` or `bw` CLI, so core detects no manager.

## How Hermes core works (checked against `~/.hermes/hermes-agent` at `local/main`)

- `agent/vault_store.py`: encrypted store under `<profile>/vault/` (Fernet key and vault file, `0600`, folder `0700`). Item metadata (label, origin, login identifier, `has_otp`) is visible; passwords, authenticator keys and address fields are secret.
- `tools/browser_vault_tool.py`: tool `browser_vault` (toolset `browser`) with actions `list`, `fill`, `save_login`, `enter_code`, `unlock`. Fills go over the supervised browser's CDP socket and only on the exact saved origin.
- `agent/vault_backends/unlock.py`: `save_login` and `enter_code` ask the user through per-thread surface callbacks (`set_save_login_prompt_callback`, `set_code_prompt_callback`). `can_prompt_here()` also needs the unlock callback. Only the CLI and `tui_gateway` (official desktop) install these callbacks. A messaging gateway session gets `prompt_unavailable`.
- `tui_gateway/methods_vault.py`: the official desktop's settings RPC (`vault.list/add/remove/...`). Hermes App does not use `tui_gateway`.

## Design

All server code is in the `hermes_app` plugin (`plugins/hermes_app/vault.py`). No core change.

### Settings routes

| Route | Result |
| --- | --- |
| `GET /v1/vault/items` | `{items: [...]}` metadata of `login` and `address` items |
| `POST /v1/vault/items` | add one item; `{item}` metadata |
| `DELETE /v1/vault/items/{id}` | `{removed: true}`; 404 for unknown or payment items |

- Add body: `{kind: "login", label, origin, secret: {identifier, password, otp_secret?}}` or `{kind: "address", label, origin?, secret: {address_line1, address_line2?, city, state?, postal_code, country}}`. An origin without a scheme gets `https://`. The server derives `identifier_type` the same way core does.
- The routes call `VaultStore(<adapter profile home>/vault)` directly, so the profile is always the adapter's own profile.
- Responses never contain a password, authenticator key or address field. Errors are scrubbed with core `scrub_secret_from_text`. The HTTP server has no access log.
- Capability: `vault: true`.

### In-chat prompts

1. The plugin registers tool `app_vault` (actions `save_login`, `enter_code`) **in core toolset `browser`**. Core merges plugin tools into a built-in toolset (`toolsets.get_toolset`), so `app_vault` is present exactly when `browser_vault` is.
2. A `pre_tool_call` hook blocks `browser_vault` `save_login`/`enter_code` in Hermes App sessions, with a message that names `app_vault`. `list` and `fill` stay on `browser_vault`.
3. `app_vault` sets the three core surface callbacks on its own thread, then runs `registry.dispatch("browser_vault", ...)` on the same thread, then restores the previous callbacks. Core keeps all of its own logic: origin binding, encrypted save, CDP fill, redaction and the Bot Desktop fence. The unlock callback always returns an empty string (decline).
4. Each callback opens one prompt in the plugin's in-memory broker (`PromptBroker`, one per profile, shared with the adapter) and waits up to 10 minutes (180 s before 0.2.59). The wait ends early on an answer, a decline, Stop (core interrupt), a change of the Thread's active receipt, or a Gateway stop.
5. The App reads open prompts from the Thread live state, field `vault_prompts`: `{id, kind: "save_login" | "code", thread_id, receipt_id, generation, site, origin, hint, expires_at}`. An `interaction` sync event wakes live subscribers when a prompt opens or closes.
6. The App answers with `POST /v1/threads/{id}/vault-prompts/{prompt_id}/answer`: `{generation, decision: "submit" | "decline", identifier?, password?, code?}`. The first answer wins; later answers get 404 or 409.

Why a separate field: the client rejects an unknown kind in `pending_interactions` (`validInteraction`), so a new kind there would break the live state of installed older apps.

Secrets: a submitted password or code is held in process memory only until the waiting tool takes it. It is not written to the plugin database, sync events, history, logs or the client cache. Core then stores the password encrypted and fills it.

### Enabling (configuration, needs Jamie's authorization)

`app_vault` and `browser_vault` are available in an App session only when `platform_toolsets.hermes_app` includes `browser`. On `hermes-app-dev` it does not today. The server browser is the profile's `browser.cdp_url`. The vault cannot fill the user's own browser (`desktop_browser_*` tools on the Mac).

### Clients

- Shared client (`packages/client`): `vaultItems()`, `addVaultItem()`, `removeVaultItem()`, `vaultPrompts` from the live state, `answerVaultPrompt()`. Gated by capability `vault`.
- Settings: connection page, group *On this Hermes · all your devices*, row **Passwords & Logins**. The page lists logins and addresses, and has Add login, Add address and Remove (with confirmation).
- Chat: a card above the composer, like approvals. *Save login*: site, identifier field, masked password field, **Save & sign in**, **Don't save**. *Verification code*: site, hint, code field, **Enter code**, **Cancel**.
- Mobile: password fields use `secureTextEntry` and `textContentType="password"` (iCloud Keychain can fill them); code fields use `textContentType="oneTimeCode"` (iOS offers the SMS code). Fields are cleared after submit.
- Desktop: the renderer sends values to the main process over IPC; the main process sends them to the server. Nothing is stored.

## Limits and risks

- The plan depends on three core details: the callback setter names, `can_prompt_here()` checking the unlock callback, and `browser_vault` running on the caller's thread. Plugin tests pin all three against the running core; run them after every core sync.
- A prompt needs a running Thread and an open App. With all Apps closed, the prompt times out and the agent gets "declined". Cron and other headless sessions never prompt.
- Headless 2FA works without the App when the login has an authenticator key (`has_otp`).

## Ease of use (plugin 0.2.59, capability `vault_manage`)

Jamie's priority: the vault must be easy to use; security comes second. Everything below is plugin and client code. Hermes core is unchanged: the plugin uses only the public `VaultStore` calls (`list_items`, `get_meta`, `resolve_secret`, `add_item`, `remove_item`). Core has no update call, so every change adds the new item and then removes the old one; the item gets a new ID.

- **Longer wait.** A card waits 10 minutes (was 180 s), the same as `agent.clarify_timeout` on `jamie` and below the Gateway's 15-minute inactivity warning. On desktop the composer status says "Waiting for your response" while a vault card is open.
- **Stale password.** When a login is already saved for the page's address, the save card says "Update your <site> login" and prefills the account (when only one account is saved there). After the save, the plugin removes older logins for the same address and account. The `app_vault` description tells the Agent to call `save_login` once when a filled password is rejected.
- **Same site, other address.** Core fills only on the exact saved origin. When nothing is saved for the page's address but logins exist for the same site (`www.amazon.com` vs `amazon.com`, by a registrable-domain guess in `vault.site_key`), the card lists them with **Use**. One tap copies that login to the page's address on the server; no typing. The App can only name logins the card offered.
- **Authenticator key at save time.** The save card has "Add authenticator key". The server checks the key with core's own parser; a bad key returns 400 and the card stays open with a message. With a key, the Agent's later `enter_code` makes the code itself.
- **Edit.** Settings > Passwords & Logins has **Edit** for logins: website, account, name, new password (empty keeps the saved one), new authenticator key or remove it. Route `PUT /v1/vault/items/{id}`.
- **Import.** **Import passwords** takes one CSV export (Passwords app on a Mac: File > Export All Passwords to File; Bitwarden: Tools > Export vault, .csv; Chrome, Firefox, 1Password). Route `POST /v1/vault/import {csv}`, up to 4 MB and 5000 rows. Rows without a website, account or password, non-login rows and app-only addresses are skipped and counted. The same address and account as a saved login is unchanged when password and key match, otherwise replaced; a file without keys keeps the saved key. The reply has counts only. The App tells the user to delete the export file. Mobile deletes its cached copy after reading; desktop reads the file in the main process, so the text never enters a renderer.
- **Older clients and servers.** Old clients ignore the new prompt fields and keep the old card. New clients show Edit and Import only when the server reports `vault_manage`.
- **Profiles.** `browser` was added to `platform_toolsets.hermes_app` on `hermes-app-dev` and `sites-dev` (Jamie's choice, through `hermes -p <p> tools enable browser --platform hermes_app`); `jamie` had it already.

Not in this batch: push notifications for a waiting card (separate feature), passkeys and "Sign in with Apple/Google" (core fills passwords only).

## Release record (2026-11-09)

Authorized by Jamie ("合并发布").

- Plugin 0.2.58: `main` `88d949d`, tag `v0.2.58` (the first tag since `v0.2.51`; 0.2.52–0.2.57 shipped untagged). Installed at `~/.hermes/plugin-releases/hermes-app/releases/0.2.58` (equal to `git archive v0.2.58`); `current` points to it for every linked profile (emma, hermes-app-dev, jamie, nan, sites-dev, wangyu). No schema change. Plugin P1: `test_vault.py` 64 passed on the running core; the full suite has the 20 test-setup failures that `main` already had, plus one flaky runner test that passes alone.
- App: `main` `1e2b003` (feature), `d454140` (v0.1.127), tag `v0.1.127`. Client 122/122, desktop 269 (208 pass, 0 fail, 61 skipped), mobile 251 (250 pass, 1 skipped); type checks pass.
- Expo Go: `hermes-app-expo.service` restarted (PID 1874302 → 1991113). The public iOS and Android bundles contain `Save & sign in` (0 → 1), `vault-prompts` (0 → 1) and `Passwords & Logins` (0 → 6).
- TestFlight: iOS update `222a0899-d4e6-48e9-9898-c5f22cf3425e`, runtime `b32a4b59…` (unchanged), commit `d454140`, bundle 13789532 bytes; the bundle contains `Save & sign in` and `vault-prompts`.
- Desktop v0.1.127: run 42630716760. Attempts 1 and 2 failed at staple (Error 68, CloudKit `-1005`) after notarization; attempt 3 passed. Checks: tests 269 (208 pass, 0 fail, 61 skipped), audit 0, `valid on disk`, `Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`, `The validate action worked!`, notarytool `"status":"Accepted"`, `source=Notarized Developer ID`. `Hermes-0.1.127-macOS-arm64.dmg` (146981379 bytes) passes `sha256sum -c`; all 9 app code hashes equal a clean `npm ci` build of `v0.1.127`.
- Rollback: plugin `current` back to `releases/0.2.57` and a Gateway restart; App `git revert 1e2b003`, restart Expo, TestFlight `rollback --to ca8e951d-7ecc-407e-b51d-adc440dbab05`; desktop reinstall v0.1.126.
- Pending: Jamie restarts the Gateway. The feature needs the `browser` toolset for `hermes_app` (on `jamie` today, not on `hermes-app-dev`). Real model calls and Mac (v0.1.127) and iPhone acceptance are open.
