# Keyboard foreground capture v2

Continuation of `t_6d9ddce9`, within Jamie's authorized temporary mobile data-collection deployment. Baseline main `654c6a8` includes the separate desktop v0.1.5 release; do not revert or deploy desktop changes as part of this work.

## Actual third-party record

Read and parsed attachment `att_f88c66d55e2a4b88a791f83de10ba0ba` as JSON, build `keyboard-resume-capture-v1`, category third-party. No assumption from its document label or filename.

- 1200 retained entries, sequence 2057–3256, elapsed 12587–25046ms; declared dropped 2056.
- 1170 retained form layout callbacks; 1169 omit height. Keyboard-active samples also omit storedBottom/paddingBottom and measuredHeight.
- v1 numeric filter only serialized finite values with absolute value <=100000. Missing values therefore do NOT distinguish nonfinite, >100000 or unavailable state. Do not claim a measured oversized or NaN padding from this report.
- No original foreground or show trigger events survive in the retained tail: the layout storm evicted them.
- Report opened at 13506ms; hide/frame events at 13517ms; sample at 13532ms records padding/storedBottom=0 and measured host height=806. Window/screen height=956, header=116, bottom inset=34. Native editor normal height=806, message-area height=711.67, topic-actions height=58.33.
- Opening the report Modal itself precedes native keyboard hiding. The captured hide is not proof Jamie manually dismissed it. Earlier user testimony independently establishes keyboard dismissal restores the original layout.

This narrows the observation to repeated layout activity while keyboard-visible, followed by ordinary zero-padding/full-height recovery. An unstable avoidance/layout feedback loop is a hypothesis; exact trigger and numeric failure remain unconfirmed. The v1 recorder's own data-loss defects must be corrected before asking for another trace.

## v2 changes (diagnostics only)

- Fixed marker `keyboard-resume-capture-v2`, also visible in Report panel to distinguish a real reload.
- Preserve larger finite numerical geometry up to +/-1e12; mark clamping explicitly. Encode allowlisted missing/not-number/NaN/positive-infinity/negative-infinity status without serializing raw values or arbitrary strings. Restore preserves these statuses. Privacy remains geometry/lifecycle only, no raw events/text/IDs/credentials.
- Separate retention budgets: up to 400 geometry (layout/sample) entries and 800 lifecycle/keyboard/control entries, total <=1200. Geometry flood cannot evict the show/foreground trigger events.
- Throttle each route/part's layout recording to one per100ms and retain suppressedLayouts count; suppressed callbacks do not schedule cache writes. This throttles the observer, NOT application layout, keyboard events or avoidance updates. Existing baseline KAV, editor styles, drafts/identity and creation/network behavior are unchanged.
- Starting a fresh recording resets throttling/counters and still only replaces diagnostic data. User must reload, check v2 label, select Third-party keyboard/Start before reproduction, then share after the problem. Save the previous report before starting another.

## Verification

Actual mobile serial suite391/391, no failures/skips; TypeScript, iOS and Android Expo exports and git diff check passed. Seven capture tests now include a 5000-layout/5000-sample flood proving trigger retention and layout throttling, and finite/NaN/infinity/missing/clamped JSON and safe-restore differentiation. Native UIKit/File/Share are substitutes in component tests; this does not prove the underlying device bug or v2 capture passed.

Private evidence `/home/hermes/.hermes/profiles/hermes-app-dev/workspace/hermes-app/keyboard-resume-capture-v2/`: checks/exports and public release verifier/state. Publishing only the Expo client; no dependencies/lockfile, plugin, core, Gateway, desktop release or other profile changes. Exact public manifests/launchAssets and service/plugin fingerprints must pass before claiming deployment. Original defect remains open; native v2 report pending.
