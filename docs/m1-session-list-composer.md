# Mobile session-list inline composer

Task: `t_b9cc89a8`. Isolated branch: `feat/mobile-list-composer`, baseline `68f0706`. Jamie requested replacing the mobile session-list creation FAB/full-screen editor with a bottom input and complete attachment menu, then authorized implementation. This candidate is local-only; main, Expo, Gateway, plugin and Hermes core remain unchanged.

## Implemented interaction

- Channel topic/session list now has a bottom, non-shrinking composer. No creation FAB and no navigation through the full-screen editor from that list. The legacy editor route remains available for existing deep links; channel creation is unchanged.
- No auto-focus on entry. Multiline input uses the chat field's bounded sizing (120pt field / 102pt native input); English placeholder is `Start a new conversation…`, Send is an upward arrow with an accessible hint.
- Reuse `AttachmentComposer` for file, photo library, camera, paste and previews. Files remain local until Send; attachment-only messages are allowed; whitespace-only messages without files are not.
- Create using a stable client thread ID, hydrate its summary, upload local files, then enqueue the first message using `newSend` and the existing `MobileOutbox`/SecureStore path. Enter the native thread route after enqueue commits, not after the Agent completes or an extra network read.
- A synchronous work guard rejects double taps. Creation acknowledgment loss retries the same thread ID. Queue retries use the same message ID and exact sealed text/files; editing and attachment removal are disabled once the queue commit has been attempted, so an uncertain storage outcome cannot reuse an identity with different content.
- Successful enqueue clears the draft and rotates IDs for the next conversation. Late completion while another route is visible does not navigate away from it. Unmount before creation/upload completes cannot enqueue through the old route.
- Native Stack retention preserves text/input identity and selected attachments while an existing topic or viewer covers the list. Channel-keyed composers plus connection-keyed list ownership prevent draft leakage across channels/connections.
- Reuse the existing focus-aware `FormKeyboardAvoidingView`; no second keyboard avoider or custom navigation. Composer is a layout sibling below a flex list, not an overlay; remove old FAB clearance. List remains inverted/newest-at-bottom and uses native visible-position maintenance without a programmatic scroll-to-bottom on keyboard/input resize.

## Attachment recovery fix

Locally staged upload failures previously remained busy and `uploadTo` refused failed sources, while their Retry control did nothing with `threadId=null`. Local staging now retries unfinished sources, retains successful upload metadata, allows a send retry after failure, and implements the file Retry control. Staged files cannot be rebound to another thread. Explicit removal deletes only that item's unattached upload from its actual owner; clear/unmount still never deletes an upload that may already belong to an outbox record. Existing chat upload behavior is preserved.

## Actual checks

Private evidence: active-profile `workspace/hermes-app/mobile-list-composer/`.

- Mobile TypeScript passed.
- Final serial mobile suite: **401 passed, 0 failed, 0 skipped**. Production-component regression covers list placement/channel creation, empty/text/attachment-only sending, duplicate tap, durable enqueue gate, acknowledgment loss, same-ID/payload retry, retained drafts, cross-channel isolation, blur/unmount races, selection-aware paste. Actual outbox/storage classes are exercised with synthetic in-memory storage, not a real device's SecureStore.
- Production attachment regression covers local staging, partial failure, Retry, no re-upload of successful files, wrong-target rejection and explicit-remove ownership.
- Final iOS and Android Expo exports passed; exported bundle markers and hashes are recorded privately. These are JS bundle artifacts, not independent signed installation packages.
- First full-suite attempt failed because this fresh worktree lacked generated `packages/client/dist/index.js`. Built it using the existing workspace build command, then reran successfully. No dependency/lockfile/source workaround; original failure log is retained.

## Boundaries and acceptance still pending

- Entirely offline **new-thread creation** is not added: creating the thread and uploading files still need network, as in the old creation flow. After the message reaches the existing durable outbox, existing offline recovery owns it.
- Pre-enqueue drafts/files are route-local, not persisted to disk. Popping the Channel route, changing connection or terminating the app can discard an unsent draft; returning from a covered thread preserves it. Persistent channel drafts after popping/cold startup are a separate capability, not claimed here.
- A creation that reaches the server before a pre-enqueue failure may leave an empty topic visible. The retained draft reuses that topic rather than creating another. No uncertain send/queued topic is archived by route cleanup.
- RN host, picker, transport and storage substitutes are automated checks, not iPhone acceptance. Real device: Chinese nine-key multiline entry, long-input internal scrolling, keyboard show/hide/background/return, attachment menu/pickers/previews, list reading position, opening an existing session and returning to the retained draft, sending and entering the created conversation, dropped network during creation/upload/after enqueue.
- Merge/publication needs authorization. After authorized Expo publication, read public iOS/Android manifests and their exact launchAssets; do not restart Gateway/install plugins for this client-only change. Independent install packages/signing are outside this task.
