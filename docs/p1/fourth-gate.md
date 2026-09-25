# P1-05 fourth gate: shared client and package lane

Status: independent 03-backed implementation in this worktree. Parent integration with P1-04 remains pending. No overall P1 completion claim.

- Shared pure TS module: `packages/client/src/index.ts`; desktop and Expo/RN target transport adapters: `tests/client/desktop/transport.mjs`, `tests/client/mobile/transport.js`.
- Pinned root `package-lock.json` and copied P0 Expo lock; no new UI framework. Metro Android JS export includes the new module. It is not an APK or device test.
- `scripts/p1-regression.sh` runs existing full Python suite, strict gate, client type and unit checks, real isolated GatewayRunner adapters, Metro export and deterministic plugin packaging. Logs and JSON evidence are written outside the repo under `P105_EVIDENCE_DIR` and `P1_EVIDENCE_DIR`.
- Server P1-04 capabilities and routes must be reviewed after its branch is integrated. This gate currently covers only P1-03. No production profile, phone device, signer, paid model or public push was used.

The final complete one-command 03-backed run used external evidence at `/home/hermes/.hermes/profiles/jamie/cache/scratch/hermes-app-p1-05-regression-ErOvzV` and `/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1-05`. It reported `39 passed in 168.94s`, strict gate `passed: true` and `failures: []`, 9 TS unit tests, real GatewayRunner restart replay and offline execution for both client adapters, Android Metro JS export (572 modules, 2.7 MB), and plugin archive SHA-256 `ed9867f96d4dc88d0134ce2df152d53e66aa95efa6891ac4129e0069c5f16517`. A prior complete run also passed; an intermediate run passed Python tests but was interrupted when the regression script itself was edited while executing. Neither interrupted run nor earlier client code is used as the final gate result.
