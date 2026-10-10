# Desktop release builds and retention

Jamie authorized this policy on 2026-10-06: old desktop builds have no value at the current iteration speed.

## Workflow

- Since 2026-10-10, a tag push (`v*`) runs `.github/workflows/desktop-release.yml` on the self-hosted runner `macmini-m4` (labels `self-hosted, macOS, ARM64, macmini`). The job runs the desktop checks, audit and packaging, publishes the Release from the Mac mini with the job's `GITHUB_TOKEN`, and prunes old Releases. GitHub-hosted runners still cannot start jobs because of an account payment problem; self-hosted jobs are not blocked.
- Manual build without publishing: `gh workflow run desktop-release.yml -f tag=vX.Y.Z -f publish=false` leaves a draft Release; publish that same package with `gh release edit vX.Y.Z --draft=false`. Workflow artifacts are not used: the account billing problem also blocks artifact storage. Use `-f publish=true` to publish an existing tag directly. The workflow refuses a tag that already has a Release or draft.
- Fallback when the runner is offline: `scripts/macmini-desktop-release.sh vX.Y.Z` on the Hermes host. It copies the package back over `ssh macmini` (Cloudflare Access, about 2 Mbps; about 9 minutes for 130 MB) before publishing.
- The workflow has no `pull_request` trigger. Do not add one: the runner executes jobs directly as the Mac mini user `aws`.

## Runner maintenance (Mac mini)

- Install: `~/actions-runner` (actions/runner, osx-arm64, SHA-256 checked), registered to `changx/hermes-app` only, work directory `~/actions-runner/_work`.
- Service: launchd agent `actions.runner.changx-hermes-app.macmini-m4`, managed with `cd ~/actions-runner && ./svc.sh status|start|stop`. It needs the `aws` console login session.
- Toolchain: `~/actions-runner/.path` puts `~/.local/node-v24.14.1/bin` and `~/.local/bin` (gh) first. Update `.path` and restart the service when Node changes.
- The runner updates itself. Remove it with `./svc.sh uninstall` and `./config.sh remove --token <removal token>` (`gh api -X POST repos/changx/hermes-app/actions/runners/remove-token`).

## Retention

- After a successful publication, `scripts/prune-releases.sh` keeps the newest **2** published Releases: the new one and the one before it, for rollback. It deletes older Releases and their files. The just-published tag is always protected. Drafts are not counted or deleted.
- Git tags stay. To rebuild an old version, run the workflow manually for that tag.

Manual check: `bash scripts/prune-releases.sh changx/hermes-app 2 --dry-run`.

References: [repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [Actions billing and storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
