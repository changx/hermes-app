# Desktop release builds and retention

Jamie authorized this policy on 2026-10-06: old desktop builds have no value at the current iteration speed.

## Workflow

- Since 2026-10-09, releases are built on the project Mac mini. GitHub Actions cannot start jobs because of an account payment problem. Push the `vX.Y.Z` tag, then run `scripts/macmini-desktop-release.sh vX.Y.Z` on the Hermes host. The script runs the same checks, audit and packaging as the `release` job, then publishes the Release with `gh` and prunes old Releases.
- `desktop-release.yml` now runs only on demand (`workflow_dispatch`); push, tag and pull request triggers are removed. A manual run on a tag ref still uses the `release` job. A manual run on a branch uses the `build-macos-arm64` job, which runs checks, audit and packaging with a read-only token and stores no Actions artifact.
- `desktop-direct-release.yml` stays available for a manual, source-pinned publication of an existing tag.

## Retention

- After a successful publication, `scripts/prune-releases.sh` keeps the newest **2** published Releases: the new one and the one before it, for rollback. It deletes older Releases and their files. The just-published tag is always protected. Drafts are not counted or deleted.
- Git tags stay. To rebuild an old version, run Desktop Direct Release for that tag.
- Repository setting: Actions artifact and log retention is **1 day** (Settings → Actions → General). It applies only to new artifacts and logs.
- npm caches from `actions/setup-node` are keyed by the lockfile. Old caches can be deleted; GitHub also evicts caches that are unused for 7 days.

Manual check: `bash scripts/prune-releases.sh changx/hermes-app 2 --dry-run`.

References: [repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [Actions billing and storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
