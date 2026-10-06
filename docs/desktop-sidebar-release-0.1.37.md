# Desktop sidebar release v0.1.37

## Authorized scope

Jamie authorized merging `feat/desktop-sidebar` into main and publishing it ("合并主分支，发布", 2026-10-06). Source: `99b5153` on main `ec21215`. Main also carries the previously authorized, not yet pushed commits `c5682a9`, `b7a96a0`, `a276496` (unified Settings) and `ec21215` (docs).

Publication: desktop tag `v0.1.37` through the existing release workflow. Version metadata changes to `0.1.37`.

Not included: Expo runtime change (this change is desktop-only plus a shared icon font whose existing glyphs are unchanged), plugin installation, Gateway restart, Hermes core, signing.

Details of the change: [tree navigation](desktop/tree-navigation.md#multi-connection-sidebar-redesign).

## Results

- `main` moved to `cfa672f` and was pushed atomically with annotated tag `v0.1.37`.
- The normal tag run passed checks, audit, packaging and archive validation, then failed only at artifact upload (Actions storage quota). The source-pinned Desktop Direct Release run `37478553414` succeeded.
- Release `v0.1.37` is not a draft or prerelease. Downloaded ZIP checksum passed: `4bac1729c62ed05a4874bfd6a8a368aa4836097bb44be7c54fa20e45f18de84a`. Info.plist and ASAR report `0.1.37`; executable is Mach-O arm64; the renderer contains the new sidebar; the packaged icon font is byte-identical to `assets/work-icons.ttf`.
- No Expo restart, Gateway restart, plugin or core change.
