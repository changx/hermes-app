# Temporary keyboard foreground capture

Jamie authorized publishing a temporary data-collection build to the existing Expo Go entry, following the unresolved New topic foreground keyboard issue (`default / t_6d9ddce9`). This is diagnostic instrumentation, not a keyboard fix or an independent installation package.

## Scope and data

Only New topic and New channel opt into capture. Their native navigation headers expose a temporary **Report** button (explicitly requested diagnostics exception to the usual no-diagnostics UI rule). Existing RN KAV padding behavior, focus/visibility guard, offsets, editor styles, input identities, drafts, attachments and creation APIs are unchanged. No dependency, lockfile, shared protocol, plugin, Gateway, core or other profile change.

Capture records all six RN show/hide/frame keyboard event types, AppState changes, controller visibility/header/insets, window/screen dimensions, existing native editor layout callbacks, and bounded delayed samples of RN KAV state and its host's measured window bounds. It reads `state.bottom` and the pinned RN class's `viewRef` for diagnosis only; it does not mutate/wrap/replace the native component. Event callbacks and queued samples are gated by route focus; listeners/timers are released on unmount. Measurements are asynchronous and are not proof of exact UIKit frame timing. Capture overhead may itself affect timing; this is not intended for permanent use.

Strict output allowlist: numerical geometry/timing, booleans, fixed lifecycle/part/route/keyboard-category strings. No raw native event serialization, input text, selection, message contents, attachment metadata, Channel/Thread IDs, connection URLs or credentials. No upload/telemetry endpoint. At most 1200 entries, with dropped count; one local cache report file, debounced writes and best-effort synchronous background flush. Safe cached restore is limited to 24 hours; starting a recording replaces only the report. The export is a separate frozen cache snapshot so share-sheet lifecycle cannot rewrite the file being shared. iOS uses RN Share's file URL; Android shares JSON text. Cache is not authoritative data or guaranteed to survive OS eviction/termination. Storage/share failures are surfaced.

## User procedure

1. Reload the existing Expo Go project at `exps://agent.tuly.space` and open New topic.
2. Tap **Report**, choose **Third-party keyboard**, confirm **Start**, then **Close**.
3. Open the affected keyboard, type any draft, switch away and return. Wait until the layout becomes wrong. Do not start another recording at this point.
4. Tap **Report → Share report**. Save `hermes-keyboard-export.json` to Files and attach it in this conversation; send the keyboard name/version separately if available. The fixed navigation header should remain accessible even if the editor is compressed. If necessary, dismiss the keyboard first: the report retains the earlier events and includes the hide recovery.
5. Optional comparison: save/share the first report before starting separate System Chinese and System English recordings, since Start replaces the previous recording.

## Actual verification

Private evidence: `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/keyboard-resume-capture/`.

- Executed five new tests covering strict data/privacy allowlist, bounded/immutable report and reset/restore/expiry, production capture-hook lifecycle and synthetic delayed keyboard frames/retained padding with one draft mount and listener/timer cleanup, iOS file persistence/share and frozen export/storage failure, Android text export. Native hosts, file APIs and share UI are substitutes, not device validation.
- Targeted form/editor/router/capture tests passed; full serial mobile suite **389/389**, no failures/skips. Mobile TypeScript and iOS/Android Expo exports passed; diff check passed.
- First targeted run failed two exact source assertions for the formerly prop-free form boundary; updated them to require diagnostics opt-in. First full suite lacked the existing generated client dist in the new worktree, causing nine module-not-found files; built the unchanged client with its normal build command and reran successfully. Initial logs retained. Fresh worktree reused a private copy of installed mobile dependencies, root dependency symlink and normal Markdown generator; no npm ci or dependency/config changes.

Public manifests and exact launchAsset verification is recorded separately in the private release-verification file. Device capture, native file sharing and the keyboard defect itself remain unverified until Jamie tests; do not close the defect from build/resource checks.

Rollback: explicitly revert this diagnostic code commit and restart only `hermes-app-expo.service`, then verify public assets. Baseline is main `5121775`; never reset chat data or restart Gateway for this client-only change.
