# API keys (profile .env)

Status: released 2026-11-10. Plugin v0.2.61 (`hermes-app-plugin` `ab83c09`), App v0.1.132 (`011b39e`). See [Release record](#release-record).

## Requirement

Team members on a shared Hermes host (team01) cannot log in to the server. Jamie asked for a way to change their own profile `.env` from Hermes App.

Confirmed rules (Jamie):

1. Use a **blacklist**, not a whitelist. Nobody knows which keys the `.env` will need in the future.
2. The blacklist hides the keys that must stay fixed. The App does not show them and cannot change them.
3. Every other key is the member's. The API keys that the administrator wrote (for example `EXA_API_KEY`, `TYPESAFE_API_KEY`) are only initial values. The member can change or remove them.
4. `ADSPOWER_API_KEY` and `ADSPOWER_DEFAULT_PROFILE_ID` belong to the member. Only the AdsPower sidecar address is locked.
5. Keys that a member adds must reach the commands that the agent runs for that member (the Docker sandbox).

## How Hermes core works (checked against `~/.hermes/hermes-agent` at `local/main` 272c0ccea4)

- A multiplexing gateway rebuilds each profile's secret scope on every turn: `agent/secret_scope.build_profile_secret_scope()` reads `<profile>/.env` and caches it by file signature. A changed file applies on the next turn without a restart.
- `hermes_cli/config.save_env_value()` and `remove_env_value()` write `get_env_path()`, which follows the profile-home override. Under multiplexing, `_publish_env_value()` updates only the installed scope, never the shared `os.environ`. Both writers refuse the core writer denylist (`LD_*`, `PATH`, `PYTHON*`, `EDITOR` and similar) and keys that a managed scope owns.
- The plugin does not use `credential_lifecycle.save_provider_env_credential()`, which the dashboard uses. That function also changes `auth.json`, the credential pool and `config.yaml`. On a shared host these can hold accounts that all members share.
- Sandboxes get only declared names: `terminal.env_passthrough`, skill `required_environment_variables`, `docker_forward_env`, or names registered with the public `tools.env_passthrough.register_env_passthrough()` (the bundled `raft` platform plugin uses it). The registry holds names for the whole process; each value comes from the profile's own scope, and a profile without the key gets it unset. `/new` clears the registry.
- Core never passes Hermes-managed credentials (`OPENAI_API_KEY`, `EXA_API_KEY`, `GITHUB_TOKEN`, `TAVILY_API_KEY`, bot tokens and others in its blocklist) to a sandbox through passthrough. Only an operator's `docker_forward_env` can do that. Hermes' own tools still read these keys on the next turn.
- `terminal.env_passthrough` is cached per profile for the life of the process and has no public refresh. A plugin that edits `config.yaml` would need a gateway restart, so the plugin uses `register_env_passthrough()` instead.

## Design

Server code: `plugins/hermes_app/env_keys.py`. No core change. Capability `env_keys`.

### Blacklist

A key is locked (hidden, cannot be set or removed) when any rule matches:

| Rule | Protects |
| --- | --- |
| Prefix `TERMINAL_` | Sandbox backend, `TERMINAL_DOCKER_EXTRA_ARGS`, CPU and memory limits, user mapping |
| Prefix `HERMES_` | `HERMES_APP_TOKEN`, `HERMES_APP_ALLOWED_USERS`, the operator list below, Hermes runtime settings |
| Prefix `LCM_` | LCM and memory settings |
| Prefix `GATEWAY_`, `API_SERVER_` | Gateway access, relay and listener settings |
| `ADSPOWER_API_URL`, `ADSPOWER_CDP_PORT`, `ADSPOWER_CDP_URL` | The profile's AdsPower sidecar address |
| Core `is_profile_gate_env()` | Platform authorization gates: `*_ALLOWED_USERS`, `*_ALLOW_ALL_USERS`, allowed channels and similar |
| Core `_is_global_env()` | Process-wide names (`PATH`, `HOME`, `TMPDIR` and similar) |
| Core writer denylist and managed scope | Names that core refuses to write |
| `HERMES_APP_ENV_LOCKED` in the profile `.env` | The operator's own list: names, or prefixes that end in `*`, separated by commas or spaces |
| Name is not `[A-Z_][A-Z0-9_]*` | Lower-case and invalid names |

All other keys are editable. When the administrator adds a fixed key in the future, the administrator uses a locked prefix for its name, or adds the name to `HERMES_APP_ENV_LOCKED`. No plugin release is necessary.

Risk: a fixed key that has no locked prefix and is not in `HERMES_APP_ENV_LOCKED` is editable. A blacklist cannot remove this risk.

### Routes

| Route | Result |
| --- | --- |
| `GET /v1/env-keys` | `{keys: [{name, set, preview, sandbox, description?, url?}], suggestions: [{name, description, url?}]}` |
| `PUT /v1/env-keys/{name}` with `{value}` | `{key: {...}}`; 403 for a locked key |
| `DELETE /v1/env-keys/{name}` | `{removed: true}`; 404 when the key is not set; 403 for a locked key |

- The routes use the adapter's own profile home (`profile_settings.for_adapter(owner).home`). A body that names a profile gets 403.
- Writes run in a worker thread inside core `gateway.run._profile_runtime_scope(home)` when multiplexing is active, the same scope that `model_settings` uses. A single-profile gateway must run as that profile. Otherwise the request fails closed (503).
- After a write the plugin reads the file again and compares the value. A silent core refusal is an error.
- A value must be one line of ASCII text, at most 8192 characters. Display previews (`«redacted…`) are refused.
- `preview` is `…` plus the last four characters, and only for values of 12 characters or more. Responses never contain a value. Errors are fixed texts; logs contain no names or values.
- `sandbox` is core `is_env_passthrough(name)` after registration: true when commands that the agent runs can read the key.
- `suggestions` are the core `OPTIONAL_ENV_VARS` entries of category `tool` or `skill` that are not advanced, not set and not locked.

### Sandbox passthrough

- The plugin registers the editable key names of a profile with `register_env_passthrough()` after each write, after each list, and in a `pre_tool_call` hook before each `terminal` and `execute_code` call. The hook acts only for profiles that have `HERMES_APP_TOKEN` (Hermes App profiles).
- Core refuses Hermes-managed credentials, so those names never reach a sandbox this way.
- Effect on other profiles in the same process: they see the same names. A profile without the key gets the name unset. A profile with its own value of the same name (for example the administrator's `TYPESAFE_API_KEY`) passes that value to its own commands.

### Clients

- Shared client (`packages/client`): `supportsEnvKeys`, `envKeys()`, `setEnvKey()`, `removeEnvKey()`, and `ENV_KEY_NAME` / `ENV_KEY_MAX_VALUE` in `envKeys.ts`. Invalid names never reach the server. Only `https:` links are kept.
- Desktop: connection page, group *On this Hermes · all your devices*, section **API keys** under Passwords & Logins. The renderer sends a value to the main process over IPC (`desktop:set-env-key`), which checks it (`src/main/env-keys-ipc.ts`) and sends it to the server. Nothing is stored.
- Mobile: connection page, row **API keys**, page `settings/env-keys`. Value fields use `secureTextEntry`. Removing the connection closes the page (`routeOwnership.ts`).
- List: name, description, `Ends in …`, and *Commands can read it* when `sandbox` is true. Actions: **Add API key** (name with suggestions, value), **Change**, **Remove** with confirmation.

## Limits

- Model provider keys: the member can set them. A running conversation can keep its provider client; a new conversation uses the new key.
- MCP servers and messaging adapters read their keys when they start. A change applies after the gateway restarts.
- A Hermes-managed credential (for example `GITHUB_TOKEN`) reaches a sandbox only when the administrator adds it to that profile's `docker_forward_env`.
- No in-chat key entry. Core skill secret capture uses one process-wide callback (`tools.skills_tool._secret_capture_callback`) and needs `HERMES_INTERACTIVE` in a gateway, which is not safe in a multiplexing gateway.

## Verification

- Plugin: `tests/p1/test_env_keys.py` with core at `local/main` (`HERMES_BASELINE=/opt/projects/jamie/_worktrees/hermes-agent/vault-test`): blacklist rules, list without values, set and remove through core writers with mode 0600 kept, next-turn scope rebuild, refusals that leave the file unchanged, a multiplex write that changes only the adapter's profile and not `os.environ`, and passthrough registration that also works after `/new`.
- Shared client: `packages/client/tests/env-keys.test.mjs`. Desktop: `apps/desktop/tests/env-keys-ipc.test.mjs`. Mobile: `apps/mobile/tests/env-keys-settings.test.mjs` and the route test in `multi-connection.test.mjs`.
- Real device acceptance on team01 is a separate step.

## Release record

- Plugin v0.2.61: tag `v0.2.61` (`ab83c09`). Installed from `git archive v0.2.61` to `releases/0.2.61`; file hash `e4f94bf9…` on both hosts.
- This host: `current` points to 0.2.61. The profiles that link to `current` load it at the next Gateway restart (Jamie). Before the switch the Gateway was PID 2756236, started 2026-11-09 22:39:35 PST.
- team01: `current` points to 0.2.61; Gateway restarted (PID 75462, 2026-11-10 12:16:19 UTC). Loopback check on `jamie`, `wangsheng`, `zhaozhidan`, `guojingyu`: no token gives 401; capability `env_keys` is true; each list has `EXA_API_KEY` and `TYPESAFE_API_KEY` only, with no `.env` value in the response; `TYPESAFE_API_KEY` reaches the sandbox. A test key on `jamie` was saved and removed.
- Mobile: `hermes-app-expo.service` restarted. Public iOS and Android manifests: HTTP 200, SDK 58.0.0; both launch bundles contain the API keys page.
- Desktop v0.1.132: built on the Mac mini (third attempt; the first two lost the connection to Apple's ticket and timestamp services). Developer ID signed, notarized (`Accepted`), stapled; `spctl` accepted for the DMG and the app. DMG SHA-256 `95e05b55a4ec992df29ee98f93adb74dd0e6fead51f80e5cf678ee793c149795`. GitHub Release `v0.1.132`.
- Rollback: point `current` back to `releases/0.2.60` and restart the Gateway; install desktop v0.1.131. Clients hide the page when the capability is absent.
- Open: real device check on a member's phone and Mac.
