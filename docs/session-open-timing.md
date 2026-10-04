# Temporary session-open measurement

## Removal candidate

The mobile timing feature has been removed in `fix/remove-mobile-timing`, at the user's request. The removal includes the Agent settings switch, result panel, copy action, navigation trace, SDK observer registration and independent FlashList measurement callback. Normal page ownership, early content release, receipt viewability and shared SDK APIs remain unchanged. The previous build flag no longer enables mobile collection.

Verification: mobile tests report 547 passed, 1 skipped and 0 failed. Mobile TypeScript and iOS/Android exports pass. This candidate has not been merged or deployed. iPhone acceptance is not verified. Test evidence is in the Channel workspace under `remove-mobile-timing/tests.log`.

## Historical measurement instructions

The instructions below describe the previous build, not the removal candidate.

This is an opt-in mobile measurement build, not a performance optimization or a production telemetry service. It does not change requests, history windows, authentication, resource limits or page ownership. Desktop has no measurement UI in this candidate.

## Run the candidate

From this branch's `apps/mobile` directory:

```sh
EXPO_PUBLIC_SESSION_TIMING=1 npx expo start --no-dev
```

Keep the normal published entry unchanged until deployment is authorized. `EXPO_PUBLIC_SESSION_TIMING` is compiled into the mobile bundle. Setting it after Metro starts does not update an existing bundle. Start a new Metro process for a different value.

The measurement build starts with timing enabled. Agent settings contains **Temporary session timing: On/Off**. This switch is in-memory only and affects newly mounted session pages. Ordinary builds omit the control and panel and allocate no trace. To remove the feature, unset the build flag and reload the app; the isolated commit can also be reverted.

1. Open a session that has no living page in the navigation stack.
2. Keep that page focused until the result appears.
3. Read the yellow timing panel.
4. Select **Details** to see the phase and observed request timings.
5. Select **Copy result** to share only the numeric report.
6. Return through the native back stack to remove the page before measuring the same session again.

Measure several plain-text sessions and several sessions with heavy content separately. Do not use returns to living pages as first-opening samples. A page acquired from a direct link without the navigation marker labels its origin **page acquisition**, not **tap**. Focus loss, backgrounding, cancellation and failed opening are incomplete samples. Empty pages are identified separately.

## Boundaries

- Tap to SDK open: navigation, native route setup, React mount and page acquisition.
- SDK open to history start: connection/hello/watch readiness and scheduling.
- History start to ready: decoded HTTP request plus local validation, merge and callbacks.
- State start to ready: decoded HTTP request plus local state processing.
- History ready to UI release: scheduling before `setLocated(true)`. The account-network candidate removes the state gate.
- UI release to first viewable-row callback: client presentation and callback scheduling.
- Decoded history/state response to local ready: remaining local work after the final response.

The measurement uses an independent FlashList viewability pair with zero minimum dwell and 1% item visibility. The existing receipt/source-highlight callback and its default dwell remain unchanged. No helper is added when timing is disabled. FlashList may defer callbacks when JS is busy; this is not a native pixel-paint timestamp. Empty pages end one animation frame after release. Images, mathematical formulas and diagrams may finish later; this probe does not claim they are ready.

HTTP spans observe requests started after the SDK opening marker. A capability request already started during page acquisition is not retroactively measured. HTTP duration includes network, server, transport and response-body decoding; it cannot identify server processing alone. Parallel request durations overlap, so the report does not add them to the total. Local response timings are not a measure of all client CPU.

With the account-network candidate, page opening does not issue its own capabilities/catalogue requests. History and state overlap, and the first-row callback can precede state completion. Pending requests are labelled explicitly; their incomplete duration is not reported as a completed zero-duration request. State stages may remain `not measured` when the sample ends first. The measurement itself adds no new detailed connection instrumentation.

The conclusion states whether elapsed time is mostly before or after UI release. A result mostly before release is **not** automatically a server bottleneck. Inspect the request timings, connection wait, local processing and post-history gate together. If requests dominate, measure server processing separately before changing server code. If presentation dominates, measure parsing/layout/heavy engines next.

## Privacy and overhead

Only relative monotonic times, stage names, request categories and numeric counts enter reports. Navigation matching uses a thread ID in one private in-memory slot, never in the report. No text, message IDs, request paths, URLs, tokens or connection values are recorded. There is no storage, automatic upload, polling or telemetry dependency.

The panel subscribes to the completed result, not to every timing marker. The result is captured before the completion panel update. Measurement still has some overhead: timestamps, a small pending panel and one temporary viewability helper. It does not measure or guarantee CPU, native memory, image readiness or device frame rate.
