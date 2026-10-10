# Desktop release builds and retention

Jamie authorized this policy on 2026-10-06: old desktop builds have no value at the current iteration speed.

## Workflow

- Since 2026-10-09, releases are built on the project Mac mini. GitHub Actions cannot start jobs because of an account payment problem. Push the `vX.Y.Z` tag, then run `scripts/macmini-desktop-release.sh vX.Y.Z` on the Hermes host. The script runs the desktop checks, audit and packaging, then publishes the Release with `gh` and prunes old Releases.
- The GitHub Actions macOS workflows (`desktop-release.yml`, `desktop-direct-release.yml`) were removed on 2026-10-09. The repository has no GitHub Actions workflow.

## Retention

- After a successful publication, `scripts/prune-releases.sh` keeps the newest **2** published Releases: the new one and the one before it, for rollback. It deletes older Releases and their files. The just-published tag is always protected. Drafts are not counted or deleted.
- Git tags stay. To rebuild an old version, run `scripts/macmini-desktop-release.sh` for that tag.

Manual check: `bash scripts/prune-releases.sh changx/hermes-app 2 --dry-run`.

References: [repository Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [Actions billing and storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
