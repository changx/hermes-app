# Deployment gate

Candidate implementation and tests are complete; runtime activation is pending.

- Plugin source installed in `hermes-app-dev` only, with backup and metadata snapshot in the private workspace. Files were read back and hashed.
- Scoped service drop-in sets `HERMES_APP_PUBLIC_BASE_URL=https://agent.tuly.space`; it contains no credential.
- Normal `systemctl --user daemon-reload && systemctl --user restart hermes-gateway-hermes-app-dev.service` was blocked by the in-Gateway self-restart safety guard. No alternate signal, delayed restart or other bypass was attempted.
- Readback: development Gateway PID remains 174959, started 2026-10-01 09:29:39 PDT; `NeedDaemonReload=yes`. The public nonexistent media-route probe still returns the old authenticated-route response 401, not the new route's 404.
- External activation is required after the active turn is finished:
  ```sh
  systemctl --user daemon-reload
  systemctl --user restart hermes-gateway-hermes-app-dev.service
  ```
- After activation, verify authenticated new capabilities, HTTP/WS, a real model media delivery, source-file cleanup, cold history, same-ID replay and exact public screenshot bytes. This task does not yet have that deployed evidence or a working public screenshot URL.
- App changes remain on an isolated candidate branch; no main merge/push, Expo deployment or new desktop Release. iPhone image viewing and deployed Mac package acceptance remain separate.
- No Hermes core, other profiles or shared ingress modified. No sandbox disabled. Candidate source and artifacts retained for review; task-specific loopback test server/SSH forwarding must be stopped before handoff.
