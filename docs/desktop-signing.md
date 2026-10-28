# macOS desktop signing and notarization

Requested by Jamie (2026-10-27): downloaded Mac builds must open without `xattr -r -d com.apple.quarantine`. Every macOS desktop release is signed with Developer ID and notarized by Apple. An unsigned or un-notarized package is not a release.

## Rule

- Every macOS desktop release (tag `v0.1.N`, workflow `desktop-release.yml`, or the fallback `scripts/macmini-desktop-release.sh`) is signed with the Developer ID Application identity, uses hardened runtime, is notarized, and has the notarization ticket stapled.
- The download is one DMG (Jamie, 2026-10-28: "只发 dmg", plain window). The Release has `Hermes-<version>-macOS-arm64.dmg` and its `.sha256`, no zip. The DMG holds `Hermes.app` and an `Applications` shortcut, with no background image.
- The DMG is signed with the same identity, notarized and stapled too.
- The workflow publishes only when all checks in "Verify app and build DMG" pass. On the app: `codesign --verify --deep --strict`, the Developer ID authority, the hardened runtime flag, `stapler validate`, and `spctl --type execute` with `source=Notarized Developer ID`. On the DMG: `codesign --verify`, `stapler validate`, and `spctl --type open --context context:primary-signature` with `source=Notarized Developer ID`; then the same app checks again inside a read-only mount. A failed check stops the release; do not publish an unsigned build or a zip instead.
- Notarization is Apple's automated security scan. It is not App Store review, and the app is not distributed through the App Store.
- Local and Linux builds (`npm run package:mac` without `HERMES_MAC_SIGN_IDENTITY`) stay unsigned. They are for tests only.

## Signing material (Mac mini, user `aws`)

| Item | Value or place |
|---|---|
| Apple team | Nan Zhang, Team ID `4R5932XFRV` (individual account; Account Holder) |
| Identity | `Developer ID Application: Nan Zhang (4R5932XFRV)`, issued by Developer ID Certification Authority G2 |
| Certificate | created 2026-10-28, **expires 2027-11-27** (Apple portal ID `57SR6YW28U`) |
| Keychain | `~/Library/Keychains/hermes-signing.keychain-db` (only the identity, the G2 intermediate and the notary profile); no auto-lock; in the user search list after `login.keychain-db` |
| Keychain password | `~/.hermes-signing/keychain-password` (mode 600). The runner unlocks the keychain with it. |
| Private key backup | `~/.hermes-signing/devid.key` with `devid.cer` and the CSR (folder mode 700) |
| Notary credential | notarytool keychain profile `hermes-notary` in the same keychain: App Store Connect Team API key "Hermes Notarization", Key ID `78Q88H73H6`, role Developer, issuer `145d06ea-54ba-4c8b-ae49-d32284984c29`. The `.p8` file was deleted after storing; Apple allows only one download. |

Never print, copy off the Mac mini, or commit the key, the keychain password or the API key. A new API key is cheap: revoke the old one in App Store Connect → Users and Access → Integrations → Team Keys, create a new one and run `xcrun notarytool store-credentials hermes-notary --key <p8> --key-id <id> --issuer <issuer> --keychain <keychain>`.

## How the build signs

- `apps/desktop/package.mjs` passes `osxSign` and `osxNotarize` to `@electron/packager` when these variables are set (the workflow sets them in the job `env`):
  - `HERMES_MAC_SIGN_IDENTITY`, `HERMES_MAC_SIGN_KEYCHAIN`, `HERMES_MAC_NOTARY_PROFILE`.
- `@electron/osx-sign` (2.7.1) signs every binary inside out, enables hardened runtime, and uses Electron's default entitlements per helper: JIT for all; camera, microphone and the other device entitlements for the main app (pages in the built-in browser can ask for them).
- Info.plist has `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`. A hardened app that opens the camera or microphone without them is stopped by macOS.
- `@electron/notarize` (3.1.1) zips the app, runs `notarytool submit --wait`, and staples the ticket.
- The workflow then checks the app and runs `scripts/macos-dmg.sh <app> <dmg>`: `hdiutil create` (HFS+, UDZO, volume name Hermes), `codesign` the image, `notarytool submit --wait` (the script reads the JSON status, because notarytool exits 0 for a rejected submission, and prints `notarytool log` on failure), `stapler staple`, the DMG checks, and the checks inside a read-only mount. It ends by printing the SHA-256 of every `.js`/`.cjs`/`.css` file under `dist/` in the app's ASAR.
- `scripts/macos-dmg.sh` comes from the tagged source, so a rerun of a tag older than the DMG change fails at that step.

## Timing

- Signing takes about a minute.
- Notarization uploads the ~130 MB zip to Apple and waits for the scan. The first submission of this team took 34 minutes in total (2,027 s for package + notarize). Later submissions are expected to be faster; the release records will show it. The job timeout is 60 minutes.
- To follow a slow submission: `xcrun notarytool history --keychain-profile hermes-notary --keychain <keychain>` and `xcrun notarytool info <id> ...` (unlock the keychain first). After a rejection, `xcrun notarytool log <id> ...` names each file and the reason.

## Verification for each release

1. The tag run passes "Verify app and build DMG" (app and DMG: signature, stapler, `spctl` Notarized Developer ID; app: hardened runtime).
2. Compare the app-code SHA-256 lines in that step's log with `sha256sum` of the same files from `npm run build` of the release commit; all must match. This host cannot unpack a DMG, so this replaces the old ASAR extraction of the zip.
3. After `gh release download`: `sha256sum -c` of the DMG.
4. Jamie's Mac: open the downloaded DMG, drag Hermes to Applications, and open it with a double-click, with no `xattr` step.

## Effects for users

- The first launch of the first signed version can show a macOS keychain prompt for "Hermes Safe Storage" (Electron `safeStorage`: connection credentials and drafts). Choose **Always Allow**. Later versions signed with the same Team ID do not ask again.
- macOS privacy grants are tied to the signature. They stay valid across later signed versions.

## Renewal (before 2027-11-27)

The certificate is valid for about 13 months. Apps signed before expiry keep opening; new releases need a valid certificate. Before it expires:
1. On the Mac mini, create a new key and CSR in `~/.hermes-signing/`.
2. In developer.apple.com → Certificates, create a Developer ID Application certificate (G2 Sub-CA) from the CSR. Only the Account Holder can do this.
3. Import key and certificate into `hermes-signing.keychain-db` (`security import ... -T /usr/bin/codesign`) and run `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <password> <keychain>`.
4. Check `security find-identity -v -p codesigning <keychain>`. If the identity name is unchanged, the workflow needs no change.

## How the material was set up (2026-10-27)

- The key and CSR were made with `openssl` on the Mac mini; the certificate and the API key were created in the Mac mini Chrome, where Jamie's developer account is signed in, through Chrome's remote debugging (CDP) after Jamie allowed it. Cua Driver 0.38.0 (`/Applications/CuaDriver.app`, Accessibility and Screen Recording granted) is installed on the Mac mini for native dialogs.
- A test signing over SSH (no GUI) gave the full chain and a secure timestamp, without any keychain prompt.

## Status

- Change: branch `feat/desktop-signing`.
- First real build on the Mac mini (branch code, 2026-10-27): all checks passed.
  - `codesign --verify --deep --strict`: valid on disk, satisfies its Designated Requirement; `flags=0x10000(runtime)`; Authority chain Developer ID Application: Nan Zhang (4R5932XFRV) → Developer ID Certification Authority → Apple Root CA; secure timestamp.
  - Notarization submission `aee3576f-9dac-4c09-833a-1a4a61a99539`: `Accepted`. `stapler validate`: "The validate action worked!".
  - `spctl --assess --type execute`: accepted, `source=Notarized Developer ID`.
  - Download simulation (zip with a Safari quarantine flag, unpacked with `ditto`, flag present on the app): accepted, `source=Notarized Developer ID`.
  - Info.plist has the camera usage description.

## Release: desktop v0.1.114 (first signed and notarized build)

- Commits `525b62b` (signing), `4f680d3` (docs), `e115a13` (60-minute job timeout); release commit `9bee5c3`, tag `v0.1.114`. No app code change since v0.1.113; Info.plist gains the camera and microphone descriptions.
- Candidate check: on Linux, `node package.mjs` without the signing variables still builds an unsigned package; Info.plist has both descriptions.
- Tag run `40642203322`: 256 tests, 198 pass, 0 fail, 58 skipped, audit 0. "Package, sign and notarize" took 4 min 17 s (06:10:24 to 06:14:41 UTC). "Verify and archive app": valid on disk, satisfies its Designated Requirement, `Authority=Developer ID Application: Nan Zhang (4R5932XFRV)`, hardened runtime, "The validate action worked!", `accepted`, `source=Notarized Developer ID`.
- Downloaded zip: SHA-256 OK; Info.plist 0.1.114; the stapled ticket (`Contents/CodeResources`) and `_CodeSignature` are present; all 9 `.js`/`.cjs`/`.css` files under `dist/` in the ASAR are byte-identical to the local build. Release notes say signed and notarized.
- Rollback: reinstall v0.1.113 (unsigned; needs `xattr` again).
- Open: Jamie downloads v0.1.114 on his Mac and opens it with a double-click, without `xattr`; one possible keychain prompt for "Hermes Safe Storage" (choose Always Allow).

## DMG (branch `feat/desktop-dmg`, not yet released)

- Jamie (2026-10-28): publish only a DMG, with the plainest window. Changes: `scripts/macos-dmg.sh`; the workflow step "Verify app and build DMG"; the fallback script; Release assets `Hermes-<version>-macOS-arm64.dmg` and `.sha256`.
- Test on the Mac mini (branch code, 2026-10-28):
  - App package + notarization 258 s; DMG build + notarization + checks 110 s (submission `733b9fe7-76a2-457c-846d-07cb0e16c3bc`, `Accepted`). The DMG is about 147 MB.
  - DMG: valid on disk, Developer ID authority, staple and validate OK, `spctl --type open` accepted, `source=Notarized Developer ID`. Inside the mount: `Hermes.app` and `Applications -> /Applications`; the app is accepted as Notarized Developer ID.
  - Download simulation: the DMG with a Safari quarantine flag is accepted; the app copied out of it with a quarantine flag is accepted.
  - App-code SHA-256 printed by the script: all 9 files match a local `npm run build` of the same commit.
  - No volume stays mounted after the script. The first run showed a cleanup fault (the mount check missed the `/private` path, and `rm -rf` reached the read-only mount); the script now detaches explicitly and never deletes while mounted.
