# Desktop release builds and retention

Jamie authorized this policy on 2026-10-06: old desktop builds have no value at the current iteration speed.

## Workflow

- Branch and pull request runs (`desktop-release.yml`, job `build-macos-arm64`) run checks, audit and packaging with a read-only token. They do not store an Actions artifact.
- A `v*` tag run (job `release`) runs the same checks and packaging, then publishes the GitHub Release from the same job. No Actions artifact is uploaded, so the Actions storage quota cannot block a release.
- `desktop-direct-release.yml` stays available for a manual, source-pinned publication of an existing tag.

## Retention

- After a successful publication, `scripts/prune-releases.sh` keeps the newest **2** published Releases: the new one and the one before it, for rollback. It deletes older Releases and their files. The just-published tag is always protected. Drafts are not counted or deleted.
- Git tags stay. To rebuild an old version, run Desktop Direct Release for that tag.
- Repository setting: Actions artifact and log retention is **1 day** (Settings → Actions → General). It applies only to new artifacts and logs.
- npm caches from `actions/setup-node` are keyed by the lockfile. Old caches can be deleted; GitHub also evicts caches that are unused for 7 days.

Manual check: `bash scripts/prune-releases.sh changx/hermes-app 2 --dry-run`.

References: [repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [Actions billing and storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
