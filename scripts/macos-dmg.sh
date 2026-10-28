#!/usr/bin/env bash
# Build, sign, notarize and staple the macOS DMG from a signed and notarized Hermes.app,
# then check the result from a read-only mount (docs/desktop-signing.md).
#
# Usage: scripts/macos-dmg.sh <Hermes.app> <out.dmg>
# Needs (macOS, unlocked keychain): HERMES_MAC_SIGN_IDENTITY, HERMES_MAC_SIGN_KEYCHAIN,
# HERMES_MAC_NOTARY_PROFILE. The window is the plain default: the app and an
# Applications shortcut, no background image.
set -euo pipefail

app="${1:?usage: scripts/macos-dmg.sh <Hermes.app> <out.dmg>}"
dmg="${2:?usage: scripts/macos-dmg.sh <Hermes.app> <out.dmg>}"
: "${HERMES_MAC_SIGN_IDENTITY:?}" "${HERMES_MAC_SIGN_KEYCHAIN:?}" "${HERMES_MAC_NOTARY_PROFILE:?}"
test -d "$app"

work="$(mktemp -d)"
mnt="$work/mnt"
mounted=false
# Never delete the work folder while the image is still mounted inside it.
cleanup() {
  if $mounted; then
    /usr/bin/hdiutil detach -quiet "$mnt" || /usr/bin/hdiutil detach -quiet -force "$mnt" || {
      echo "Could not detach $mnt; leaving $work in place." >&2; return; }
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# 1. Disk image: Hermes.app plus a shortcut to /Applications.
mkdir "$work/root"
/usr/bin/ditto "$app" "$work/root/Hermes.app"
ln -s /Applications "$work/root/Applications"
rm -f "$dmg"
/usr/bin/hdiutil create -quiet -volname Hermes -srcfolder "$work/root" -fs HFS+ -format UDZO -ov "$dmg"

# 2. Sign the image with the same Developer ID identity.
/usr/bin/codesign --sign "$HERMES_MAC_SIGN_IDENTITY" --keychain "$HERMES_MAC_SIGN_KEYCHAIN" --timestamp "$dmg"

# 3. Notarize and staple. notarytool exits 0 for a rejected submission, so read the status.
result="$(/usr/bin/xcrun notarytool submit "$dmg" --keychain-profile "$HERMES_MAC_NOTARY_PROFILE" \
  --keychain "$HERMES_MAC_SIGN_KEYCHAIN" --wait --output-format json)"
echo "$result"
status="$(/usr/bin/plutil -extract status raw - <<<"$result")"
if [[ "$status" != "Accepted" ]]; then
  id="$(/usr/bin/plutil -extract id raw - <<<"$result" || true)"
  echo "Notarization of the DMG ended with status '$status'." >&2
  [[ -n "$id" ]] && /usr/bin/xcrun notarytool log "$id" --keychain-profile "$HERMES_MAC_NOTARY_PROFILE" --keychain "$HERMES_MAC_SIGN_KEYCHAIN" >&2 || true
  exit 1
fi
/usr/bin/xcrun stapler staple "$dmg"

# 4. Checks on the image.
/usr/bin/codesign --verify --strict --verbose=2 "$dmg"
/usr/bin/codesign -dvv "$dmg" 2>&1 | /usr/bin/grep -F "Authority=$HERMES_MAC_SIGN_IDENTITY"
/usr/bin/xcrun stapler validate "$dmg"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg" 2>&1 | tee /dev/stderr \
  | /usr/bin/grep -q 'source=Notarized Developer ID'

# 5. Checks on the app inside the read-only mount, and hashes of the app code for the release record.
mkdir "$mnt"
/usr/bin/hdiutil attach -quiet -readonly -nobrowse -mountpoint "$mnt" "$dmg"
mounted=true
test -L "$mnt/Applications"
/usr/bin/codesign --verify --deep --strict "$mnt/Hermes.app"
/usr/bin/xcrun stapler validate "$mnt/Hermes.app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$mnt/Hermes.app" 2>&1 | tee /dev/stderr \
  | /usr/bin/grep -q 'source=Notarized Developer ID'
asar_tool="$(cd "$(dirname "$0")/.." && pwd)/node_modules/@electron/asar/bin/asar.mjs"
if [[ -f "$asar_tool" ]]; then
  node "$asar_tool" extract "$mnt/Hermes.app/Contents/Resources/app.asar" "$work/asar"
  echo "App code SHA-256 (compare with a local build of the same commit):"
  (cd "$work/asar/dist" && find . \( -name '*.js' -o -name '*.cjs' -o -name '*.css' \) -print0 | sort -z | xargs -0 /usr/bin/shasum -a 256)
fi
/usr/bin/hdiutil detach -quiet "$mnt"
mounted=false
echo "DMG ready: $dmg"
