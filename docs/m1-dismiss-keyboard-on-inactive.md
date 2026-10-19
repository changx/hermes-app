# Dismiss keyboard when leaving foreground

> Withdrawn (2026-10-18). Jamie cancelled this design. The App no longer calls `Keyboard.dismiss()` when it leaves foreground; the keyboard and input focus stay as iOS/Android keep them. The composer dock still resets after a missed hide ([mobile-composer-tap-collapse.md](mobile-composer-tap-collapse.md)). The text below is the historical record.

Jamie chose the simple workaround: end input when the App leaves foreground instead of retaining third-party keyboards or expanding keyboard-position recovery. Authorized scope is the existing mobile Expo test entry; independent signed packages and the original device defect acceptance remain separate.

## Minimal change

The existing connection-independent AppProvider lifecycle effect now calls RN `Keyboard.dismiss()` exactly once when its tracked state changes from active to non-active (iOS inactive, or Android/direct background). It runs before the existing pairing abort. Active resume does not call focus or reopen input. No timer, frame calculation, KAV/library replacement, input key/remount, draft/attachment reset, navigation, model execution or network lifecycle change.

Inactive includes app switching and some system overlays; keyboard closing there is intentional. User must tap the field after returning. Existing pairing and transport suspension/reconnection remain unchanged. Native endEditing/third-party extension behavior and first-tap reopening still require iPhone acceptance; local substitutes cannot establish that the third-party keyboard stops emitting bogus events after dismissal.

Temporary Report UI, listeners, measurements, cache writer and format are removed via explicit local reversion of diagnostic commits998b417 and563601f, preserving the intervening desktop release654c6a8 and earlier client layout work. Existing phone cache/report files and received evidence are not deleted or uploaded. Prior diagnostic documentation is retained in Git history and private evidence, not shipped as an ongoing diagnostic feature.

## Evidence and checks

Confirmed trigger from real third-party v2 report: zero-width/height/screenY show notifications while background cause RN padding922 then runaway root/padding233502; hide returns padding0/root806. Actual captured coordinates replay through pinned RN KAV plus compiled pinned Yoga reproduce +116pt feedback. That analysis lives in private `workspace/hermes-app/keyboard-resume-confirmed/`; no keyboard-position fix is implemented here.

Five new executed regressions use the production AppProvider effect and production editor components: active->inactive/background single dismissal; direct background; no automatic resume dismissal/focus; background initial mount; repeated foreground exits retain Chinese multiline drafts, same input identities and local attachment fixture; listener cleanup and capture UI removal. Native Keyboard/AppState/attachment hosts are substitutes, not device acceptance.

Actual full serial mobile suite389/389, no failures/skips; TypeScript, iOS/Android Expo exports and staged/unstaged diff checks passed. No dependency/lockfile install/change. Worktree reused installed dependencies and normal Markdown/client generated artifacts.

Private release evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/dismiss-keyboard-on-inactive/`. Before/after Git, Expo/Gateway PID/start fingerprints and plugin hashes, public SDK57 manifests and exact launchAssets are verified there. Publish/restart only Expo; no plugin installation, Gateway restart, Hermes core, desktop or other profile change.

## iPhone acceptance

Reload existing Expo Go project, open New topic with the affected third-party keyboard and a draft/attachment, switch away and return. Keyboard should be closed, page normal, draft/attachment retained. First input tap should reopen keyboard normally. Repeat New channel and ordinary chat; check switching keyboard and system overlays. Do not close the keyboard defect solely from bundle verification.

Rollback uses an explicit revert of this client commit, followed by only Expo restart and exact public resource verification. Baseline998b417 is retained; do not reset repository or chat data.
