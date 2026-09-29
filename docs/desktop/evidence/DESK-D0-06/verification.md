# DESK-D0-06 verification

## Scope

This evidence covers the reproducible Apple Silicon development package only. It does not claim Developer ID signing, notarization, DMG distribution, or automatic updates.

## Source and environment

- Source commit: `de6bc0be562522dedb562daf964d7d361ae46416`
- Host: Apple Silicon Mac mini (`arm64`), macOS 26.5
- Node: `v24.14.1`
- npm: `11.11.0`
- Electron: `44.4.5`
- Packager: `@electron/packager@20.3.0`
- Application: `Hermes`
- Bundle ID: `com.changx.hermes.desktop`
- Minimum macOS: `12.0`

The source was exported from the exact commit into `~/hermes-desktop-acceptance/checkouts/de6bc0b`; no dirty Linux working tree was copied.

## Automated verification

On the Mac mini:

```bash
npm ci --no-audit --no-fund
npm run desktop:check
npm run desktop:package:mac
npm audit --json
```

Results:

- clean install completed with 65 packages;
- TypeScript and all three runtime bundles built;
- 18 tests passed, 0 failed;
- npm audit reported 0 vulnerabilities;
- the package command produced `Hermes-darwin-arm64/Hermes.app`;
- the main executable is a native `Mach-O 64-bit executable arm64`;
- the Mac-built plist contains Electron's SHA-256 asar integrity entry.

The packaged `app.asar` contains only the generated main, preload, renderer runtime files and a minimal package manifest. Source maps, TypeScript source, tests, documentation, `.env` files, logs, workspace dependencies, and evidence are excluded by staging from `dist/` alone and filtering `*.map`.

## Artifact manifest

The app was copied with `ditto` to a fresh directory before launch:

```text
~/hermes-desktop-acceptance/installed/de6bc0b/Hermes.app
```

Observed metadata:

```text
CFBundleIdentifier: com.changx.hermes.desktop
LSMinimumSystemVersion: 12.0
Installed app size: 295116 KiB
Main executable SHA-256: e06891704834df56f24489e1f971428161ae17312143624af13736255cc0ab34
app.asar SHA-256: 089afc939233cc63ca6b6b368a5188da71ce0316b8306cd799167482538d9d5f
```

A transport archive was created on the Mac with `ditto -c -k --keepParent`:

```text
Name: Hermes-arm64-unsigned.zip
Size: 127115001 bytes
SHA-256: 4d77b77a65a0ee462b9a0f1f6c94717adc1d3f86295006724c0faec2d9df6b72
```

The artifact has no Developer ID or Team ID. The Mach-O carries only linker-generated ad-hoc metadata, and strict deep signature verification fails as expected for this untrusted development build. This is not a signed or notarized distribution artifact.

## Launch, copy, restart, and cleanup

The copied app was launched directly from the fresh install directory. The first run produced one visible `1280 x 820` window owned by `com.changx.hermes.desktop`, with no white screen. It exited after `SIGTERM`; no matching main or helper process remained. The same copied app was launched a second time, remained alive for ten seconds, exited, and again left zero matching processes and zero windows. Both application logs were empty.

Screenshot:

- [`mac/packaged-app.png`](mac/packaged-app.png)
- PNG dimensions: `2560 x 1640` (Retina capture of a `1280 x 820` window)
- SHA-256: `90065f820e5c1e93f480e603a82f6cab3e41918424f328a454f36153e75f7298`

No Accessibility, Input Monitoring, Automation, or TCC settings were changed.

## Rollback

The development artifact is self-contained. After the app exits, rollback is deletion of the isolated test directory and archive:

```bash
rm -rf "$HOME/hermes-desktop-acceptance/installed/de6bc0b"
```

No system package, login item, privileged helper, Keychain item, or background service is installed by this card. The retained directory is acceptance evidence only and is not a production installation.
