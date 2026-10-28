# macOS desktop signing and notarization

Requested by Jamie (2026-10-27): downloaded Mac builds must open without `xattr -r -d com.apple.quarantine`. Every macOS desktop release is signed with Developer ID and notarized by Apple. An unsigned or un-notarized package is not a release.

## Rule

- Every macOS desktop release (tag `v0.1.N`, workflow `desktop-release.yml`, or the fallback `scripts/macmini-desktop-release.sh`) is signed with the Developer ID Application identity, uses hardened runtime, is notarized, and has the notarization ticket stapled.
- The workflow publishes only when all checks in "Verify and archive app" pass: `codesign --verify --deep --strict`, the Developer ID authority, the hardened runtime flag, `stapler validate`, and `spctl` with `source=Notarized Developer ID`. A failed check stops the release; do not publish an unsigned build instead.
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
- The workflow then checks the result and zips the stapled app with `ditto`.

## Timing

- Signing takes about a minute.
- Notarization uploads the ~130 MB zip to Apple and waits for the scan. The job timeout is 45 minutes. The first submission of a new team can take much longer than later ones.
- To follow a slow submission: `xcrun notarytool history --keychain-profile hermes-notary --keychain <keychain>` and `xcrun notarytool info <id> ...` (unlock the keychain first). After a rejection, `xcrun notarytool log <id> ...` names each file and the reason.

## Verification for each release

1. The tag run passes "Verify and archive app" (signature, hardened runtime, stapler, `spctl` Notarized Developer ID).
2. After `gh release download`: SHA-256 check, Info.plist version, and the existing byte comparison of `dist/`. The signature does not change the files in `app.asar`.
3. Jamie's Mac: the downloaded zip opens with a double-click and no `xattr` step.

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

- Change: branch `feat/desktop-signing`. First real build: signing passed; notarization submission `aee3576f-9dac-4c09-833a-1a4a61a99539` (2026-10-28 04:29 UTC) was still in progress at the time of writing.
- Not yet released.
