# Desktop tree navigation

Task: desktop-tree-navigation (isolated branch)

Scope: replace permanent Channel/Thread columns with an activity rail and collapsible Channel → Thread tree panel. No mobile, server, credentials or release changes.

Acceptance:
- Channels are expandable parents; Threads are children, sorted by descending last message activity with deterministic ties.
- Initially render at most 24 children active within the trailing 24 hours. Each Load more reveals at most 24 additional children, including older activity. No full list rendered at once.
- Current older Thread stays identifiable in the conversation header, without silently widening the recent activity filter.
- Panel can collapse independently of channel branches; rail and Cmd+K/header switcher remain usable while collapsed.
- Cross-channel switching selects the thread's parent; no draft/send/history semantics changed.
- Narrow layout uses an overlay panel, not hidden unreachable navigation.
- Automated desktop checks pass. Mac visual/interaction acceptance remains separate.

Verification:
- `npm run desktop:check`: typecheck/build and 44 tests passed.
- Shared client typecheck/build plus unit/reliability/package tests: all passed (24, 20 and 24 respectively).
- `npm audit`: 0 vulnerabilities; `git diff --check`: passed.
- `npm run desktop:package:mac`: generated unsigned arm64 Hermes.app on Linux; expected codesign/ASAR integrity warning. This is not Mac launch or UI acceptance.
- Root `client:check` wrapper requires an explicit fixed Hermes baseline and could not run in this checkout; underlying shared client checks above were executed directly.
- Fresh Electron installation raced on the first concurrent test invocation; after installation completed, the full desktop gate was rerun successfully.
- Changes remain on isolated desktop-tree-navigation branch; no deployment or new Release performed.

## Native sidebar indentation and hover candidate

Branch: `fix/sidebar-tree-hover`; card: `t_6cd23e5f`.

The native-sidebar override removed the original child indent and branch border. The existing Session hover used the same color as the sidebar, so it had no visible contrast.

- Restore a 24px child-container inset, 10px internal gutter and 1px branch guide. Actual Session titles sit 17px to the right of Channel titles.
- Give Channel rows and Session rows a visible neutral hover background. Keep selected Sessions blue; retain keyboard focus outlines and existing actions.
- No changes to navigation logic, ordering, mobile, shared protocol, backend or dependencies.
- Regression uses production React and CSS with real Chromium pointer input through DevTools. It failed on the baseline with -14px title indentation and no guide, then passed at 230px and 280px sidebar widths.
- Desktop TypeScript and build passed. Browser-enabled full desktop tests: 37 passed, 1 native Electron test skipped, no failures. Tests cover collapse/reopen, Session click, status retention, labels, drafts, selection and narrow layouts.
- Private computed-style evidence and screenshot: Channel workspace `sidebar-tree-hover/`.
- Candidate only. Not merged or published. Installed macOS visual acceptance remains open.

This iteration windows already-synchronized thread summaries for display. It does not replace the shared client's synchronization protocol with a server-side 24-hour query; the current list API exposes cursor/limit, not an activity cutoff.
