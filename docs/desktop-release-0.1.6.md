# Desktop v0.1.6 — core dataflow release

Jamie authorized merging the verified core-dataflow branch into main and publishing a new Release. Existing v0.1.5 assets must remain unchanged. Release source includes the concurrent mobile session-list composer baseline, without changing its implementation.

## Included

- Equal-session synchronization with page/entity coalescing, independent hydration and safe checkpoint acknowledgement; no foreground/background priorities.
- Selective desktop delta IPC, stable row identities, memoized message rendering and a bounded entry window.
- Owner-isolated SQLite projection cache in a worker, atomic cache/checkpoint writes, cold recovery and bounded worker lifecycle. Credentials and the encrypted outbox retain their existing storage.
- Staged resync preserving readable timelines on failures; stale response fencing, automatic IPC recovery and callback-aware sidebar running status with independent unread counts.
- Previously integrated Markdown spacing and attachment preview/static-link metadata changes. Client release does not activate or alter server capabilities.

## Gates and release method

Candidate evidence is in `docs/core-dataflow.md`: Linux desktop 104/104, SDK 24/24 + 20/20 + 55/55, actual Electron cache 10/10, integrated mobile 401/401, TypeScript and both exports; 100-session synthetic traffic over real loopback HTTP/WS; native Mac candidate launch and app.asar worker cold-read smoke. These are not genuine multi-session model traffic or full MacBook/iPhone interaction acceptance.

Version-only preparation updates root/desktop/lockfile version metadata to 0.1.6 without dependency changes. Release uses the existing `desktop-release.yml` macOS arm64 workflow, including locked install, desktop checks, audit, unsigned native packaging and checksum verification. Publish only after its gates pass; download the exact published assets and verify their SHA-256 and packaged version/source markers before announcing the link.

Unsigned, not notarized, not App Store distribution. Do not rename the older v0.1.5 candidate as the new Release. No Gateway/plugin/core/other-profile changes or service restarts are part of this desktop Release. Private release evidence records commits, workflow runs, assets/checksum and relevant services before/after. Rollback is explicit Git revert and/or reinstalling the intact previous Release, without overwriting chat data.
