# Queued-message Cancel in the time line

## Problem

When a message waits in the queue, both clients show Cancel. The button was in a separate row under the message. That row appeared when Hermes confirmed the message and disappeared when the task started. The message grew and shrank, and the timeline moved.

## Behavior

- Cancel sits in the message's time line, left of the copy icon and the time. It uses the time's small text size.
- Cancel appears and disappears without changing the message height, and the time does not move.
- Warnings (failed, outcome unknown) and Retry safely stay in their own row. These states are final, so the row does not come and go.
- Desktop: `.user-message-cancel` in `apps/desktop/src/renderer/shell.tsx`. Mobile: `testID="user-message-cancel"` in `apps/mobile/src/ChatTimeline.tsx`.

## Redraws during a send

A probe of the desktop service recorded the states of one sent message:

| Step | Text color | Cancel |
| --- | --- | --- |
| Saved on this device | light gray | no |
| Received by Hermes, queued | light gray | yes |
| Original confirmed | solid | yes |
| Task running | solid | no |
| Task finished | solid | no |

Each step is a real state change. The desktop sends only changed rows to the page (`shared/snapshot-delta.ts`), and unchanged rows keep their objects, so other messages do not redraw. Mobile `MessageRow` has a field-by-field memo comparator with the same result. Before this change, the visible jump came from the Cancel row, not from extra redraws.

Tests: `apps/desktop/tests/send-cancel-inline.test.mjs` (source placement on both clients; Chromium geometry: height and time position are unchanged in all four states).

Status: candidate, not released. iPhone and Mac visual checks are open.
