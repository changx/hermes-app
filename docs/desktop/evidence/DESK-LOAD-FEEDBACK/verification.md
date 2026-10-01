# DESK-LOAD-FEEDBACK — first-load feedback

Status: In progress. User reports v0.1.3 eventually loads after a long wait and explicitly requires user-facing loading feedback, not technical network diagnostics.

Scope: on the latest desktop candidate (including the read-loop fix), show natural English first-load feedback while saved access and the first authoritative conversation snapshot are loading. Suppress misleading empty-list/conversation copy during that wait. Do not expose technical states or create manual reconnect work. No transport, server, mobile, identity, credential, deployment or unrelated UI changes.

Acceptance:
- Startup waiting visibly says `Loading your conversations…` and provides an accessible status.
- Loading ends on real initial snapshot completion, not a timer, socket availability or a nonempty list guess.
- A successful empty snapshot displays normal empty content rather than remaining in loading forever.
- Actionable permanent errors remain visible and are not masked by a loading screen.
- Once data exists, transient reconnect does not replace it with first-load feedback.
- Desktop typecheck/build/regressions pass; native Mac package demonstrates cold startup loading and actual data arrival.
- Full network diagnosis and the original white-window cause are out of scope.
