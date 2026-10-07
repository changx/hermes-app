# Mobile battery: connection checks and retries

## Confirmed request

Jamie asked to reduce phone battery use and approved the proposed design (A + B with NetInfo + C). The design keeps the reliability rules in [m1-network-reliability.md](m1-network-reliability.md). It changes only foreground connection timing. Background behavior is unchanged: the app already pauses the connection, animations and timers in the background.

## Behavior

### A. Adaptive connection check

- Active: the phone sends a WebSocket `ping` every 10 s, as set in [m1-network-time.md](m1-network-time.md).
- Idle: the phone sends a `ping` every 30 s. This matches the server's own WebSocket heartbeat (`heartbeat=30`).
- The pong deadline stays 10 s in both modes. With no error, an idle silent disconnect is detected in at most about 40 s. An active one is still detected in about 20 s.
- A connection is active when any of these is true:
  - an outbox message is not confirmed (any status except `blocked`);
  - a Thread in the directory is running, or a receipt is running;
  - the user touched the app, or returned it to the foreground, in the last 2 minutes.
- When a connection becomes active, the next ping moves forward to 10 s after the last ping. A change to idle takes effect after the next ping.
- Sending uses HTTP, so the idle interval does not delay sends. Idle only delays detection of a silent drop, and with it updates from other devices.
- Touch capture uses `onStartShouldSetResponderCapture` at the root and always returns `false`. It never takes a touch. Repeated touches do not re-render; only the start and end of the 2-minute window re-evaluate.

### B. Retry backoff and network changes

- Ordinary backoff is now 0.2, 0.5, 1, 2, 5, 10 and then 20 s, with ±20% jitter. The old schedule stopped at 5 s and retried every 5 s for as long as the phone had no network.
- `@react-native-community/netinfo` (12.0.1, the version bundled with Expo SDK 57) reports device network changes. In the foreground, a change of network type or connected state calls `networkChanged()` on each connection:
  - during an ordinary backoff wait, the SDK retries at once and starts the schedule again;
  - on an open socket, the SDK sends a `ping` at once, so a socket that a network switch broke is found within 10 s.
- The first NetInfo report is only the starting state. A report of no connection does nothing. Background reports do nothing; returning to the foreground already reconnects.
- A server `Retry-After` wait (HTTP 429) is never shortened. Authentication failures still stop retries.

### C. Retry countdown

`Connection interrupted. Retrying in Ns…` updates once per second at the second boundary. It used to update every 250 ms.

## Shared SDK

`LiveSessionClient` adds `idleLivenessMs`, `backoffJitter`, `setLivenessIdle()` and `networkChanged()`. Their defaults keep the previous behavior, so desktop is unchanged. Pages delegate both methods to the account connection.

## Verification and limits

- Automatic tests cover the active/idle interval, bringing the ping forward, the fixed pong deadline, the open-socket probe, waking an ordinary backoff, not shortening `Retry-After`, jitter bounds, suspend during a wakeable wait, the idle rules, the activity window, the NetInfo rules and the countdown timer.
- These tests prove the timing logic only. They do not measure battery use. iOS reports battery use for the whole "Expo Go" app. Compare it with the same use pattern before and after.
- iPhone checks not yet done: a network switch (Wi-Fi ↔ cellular) recovers quickly; airplane mode on and off reconnects at once; a quiet chat still receives a reply from another device.
