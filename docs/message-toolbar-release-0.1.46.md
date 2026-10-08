# Message toolbar, Thread branch and short session links — release 0.1.46

## Authorized scope

Jamie authorized merging all code and publishing it ("全部合并代码，发布", 2026-10-07):

- Hermes App plugin `changx/hermes-app-plugin` main `62aaafb`, tags `v0.2.8` (native `/branch` opens a new App Thread) and `v0.2.9` (branch with copied history, message sources, conversation export, short links).
- Client: local `main` and `origin/main` reconciled with `feat/message-toolbar` on `integrate/message-toolbar`; desktop tag `v0.1.46`; Expo test entry republished.
- Core `local/main` `8735238716` (plugin adapters opt in to `/branch` sibling threads) was already in place.

Design, decisions and limits: [Thread branch](thread-branch.md). Link format: [session links](session-links.md).

## Changes

- Shared client: `branchThread`, `messageSources`, `exportThread`, `HttpError.code`, notice kind, capability flags; short `hermesapp://session/<thread-id>` links resolved against the content's connection.
- Mobile: always-visible toolbar under final replies (Branch, Copy, References, Export, Retry on the latest reply only); tappable links in branch notices; Session options "Export conversation"; fixed a recursion when tapping ordinary web links in native inline text.
- Desktop: the same toolbar; "Export conversation" in the Session toolbar; Markdown save dialogs; short links resolved by the main process against the tab's Session.

## Activation

- Plugin 0.2.9 files are installed in hermes-app-dev. Activation needs a Gateway restart by Jamie with a stopped-state backup of `metadata.sqlite`, because the plugin rebuilds the `system_notices` table once (operator script in the private workspace `…/20261007-181114-plugin-0.2.9/activate.sh`).
- Until then the server reports no branch/sources/export capability; clients show Copy and Export only.

## Verification

Recorded below after publication.
