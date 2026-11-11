#!/usr/bin/env bash
# Build the signed and notarized Apple Silicon desktop package for a pushed tag on the Mac mini,
# then publish it as a GitHub Release from this host, and as the automatic update of installed
# apps (docs/desktop-auto-update.md).
#
# Usage: scripts/macmini-desktop-release.sh vX.Y.Z [--no-publish | --publish-built]
#
# --no-publish     build and copy the package to tmp/release/<tag>/ only.
# --publish-built  skip the build; publish the package already in tmp/release/<tag>/
#                  (use after checking a --no-publish build).
#
# This is the release path for every desktop version (Jamie, 2026-11-09). The GitHub Actions
# workflow .github/workflows/desktop-release.yml is disabled. The package crosses the slow
# Cloudflare Access SSH link (~9 min).
# Steps: npm ci, desktop:check, npm audit, desktop:package:mac, signed and notarized DMG (scripts/macos-dmg.sh),
# update zip of the same app (checked after unpacking), SHA-256 of both.
# Publication: the GitHub Release has only the DMG and its .sha256. The update zip goes to the update
# store of this host (DESKTOP_UPDATES_STORE) after the Release is published; installed apps download it.
# The source is `git archive` of the tag commit, so the Mac mini needs no GitHub login.
# Prerequisites:
# - `ssh macmini` works (override with MACMINI_HOST).
# - Node v24.14.1 is in ~/.local/node-v24.14.1 on the Mac mini (official tarball).
# - `gh` on this host can write Releases to the repository.
# - The update service (hermes-app-mobile-updates.service) serves DESKTOP_UPDATES_STORE.
set -euo pipefail

tag="${1:?usage: scripts/macmini-desktop-release.sh vX.Y.Z [--no-publish | --publish-built]}"
publish=true; build=true
case "${2:-}" in
  "") ;;
  --no-publish) publish=false ;;
  --publish-built) build=false ;;
  *) echo "Unknown option: $2" >&2; exit 2 ;;
esac
host="${MACMINI_HOST:-macmini}"
node_version="v24.14.1"
root="$(git rev-parse --show-toplevel)"
cd "$root"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

git fetch -q origin "refs/tags/$tag:refs/tags/$tag"
sha="$(git rev-parse "$tag^{commit}")"
remote_sha="$(git ls-remote origin "refs/tags/$tag^{}" | cut -f1)"
[[ -n "$remote_sha" ]] || remote_sha="$(git ls-remote origin "refs/tags/$tag" | cut -f1)"
if [[ "$remote_sha" != "$sha" ]]; then
  echo "Tag $tag on origin ($remote_sha) does not match local ($sha)." >&2; exit 1
fi
version="$(git show "$sha:apps/desktop/package.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"
if [[ "$tag" != "v$version" ]]; then
  echo "Release tag $tag must match desktop version v$version." >&2; exit 1
fi
if $publish && gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "Release $tag already exists; refusing to replace published assets." >&2; exit 1
fi

archive="Hermes-$version-macOS-arm64.dmg"
update_zip="Hermes-$version-macOS-arm64.zip"
store="${DESKTOP_UPDATES_STORE:-$HOME/.hermes/profiles/jamie/workspace/hermes-app/mobile-updates/store}"
node_bin="${NODE_BIN:-/home/hermes/.asdf/installs/nodejs/24.14.1/bin/node}"
remote_dir="hermes-desktop-build/$tag"
out="$root/tmp/release/$tag"

if $build; then
# Build on the Mac mini (the heredoc below must stay unindented).
echo "Building $tag ($sha) on $host in ~/$remote_dir"

ssh "$host" "rm -rf ~/$remote_dir && mkdir -p ~/$remote_dir"
git archive --format=tar "$sha" | ssh "$host" "tar -x -C ~/$remote_dir"
ssh "$host" bash -s -- "$remote_dir" "$node_version" "$archive" "$update_zip" <<'REMOTE'
set -euo pipefail
cd ~/"$1"
export PATH="$HOME/.local/node-$2/bin:/usr/bin:/bin:/usr/sbin:/sbin"
test "$(uname -m)" = "arm64"
test "$(node --version)" = "$2"
test "$(npm --version)" = "11.11.0"
npm ci --no-audit --no-fund
node -p 'require("electron")' >/dev/null
npm run desktop:check
npm audit
# Developer ID signing and notarization (docs/desktop-signing.md).
export HERMES_MAC_SIGN_IDENTITY="Developer ID Application: Nan Zhang (4R5932XFRV)"
export HERMES_MAC_SIGN_KEYCHAIN="$HOME/Library/Keychains/hermes-signing.keychain-db"
export HERMES_MAC_NOTARY_PROFILE=hermes-notary
security unlock-keychain -p "$(cat "$HOME/.hermes-signing/keychain-password")" "$HERMES_MAC_SIGN_KEYCHAIN"
# stapler talks to Apple's CloudKit ticket service, which sometimes drops the connection from the
# Mac mini (NSURLErrorDomain -1005, "Error 68"). Retry only that error, as scripts/macos-dmg.sh does.
validate() {
  local out rc attempt
  for attempt in 1 2 3 4 5; do
    rc=0; out="$(/usr/bin/xcrun stapler validate "$1" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    [[ $rc -eq 0 ]] && return 0
    if [[ "$out" != *NSURLErrorDomain* ]] || [[ $attempt -eq 5 ]]; then return "$rc"; fi
    echo "stapler validate: network error from Apple's ticket service, retry $attempt of 4 in 15 s" >&2
    sleep 15
  done
}
npm run desktop:package:mac
app="apps/desktop/artifacts/Hermes-darwin-arm64/Hermes.app"
test -f "$app/Contents/Resources/app.asar"
/usr/bin/file "$app/Contents/MacOS/Hermes" | /usr/bin/grep -q arm64
/usr/bin/codesign --verify --deep --strict "$app"
validate "$app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app" 2>&1 | /usr/bin/grep -q 'source=Notarized Developer ID'
mkdir -p release
bash scripts/macos-dmg.sh "$app" "release/$3"
# Update zip for Squirrel.Mac: the same signed, notarized and stapled app. Unpack it and check it again.
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "release/$4"
check="$(mktemp -d)"
/usr/bin/ditto -x -k "release/$4" "$check"
/usr/bin/codesign --verify --deep --strict "$check/Hermes.app"
validate "$check/Hermes.app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$check/Hermes.app" 2>&1 | /usr/bin/grep -q 'source=Notarized Developer ID'
rm -rf "$check"
cd release
for file in "$3" "$4"; do
  /usr/bin/shasum -a 256 "$file" > "$file.sha256"
  /usr/bin/shasum -a 256 -c "$file.sha256"
done
REMOTE

rm -rf "$out"; mkdir -p "$out"
scp -q "$host:$remote_dir/release/$archive" "$host:$remote_dir/release/$archive.sha256" \
  "$host:$remote_dir/release/$update_zip" "$host:$remote_dir/release/$update_zip.sha256" "$out/"
fi
(cd "$out" && sha256sum -c "$archive.sha256" && sha256sum -c "$update_zip.sha256")
echo "Package: $out/$archive"
echo "Update:  $out/$update_zip"

if $publish; then
  gh release create "$tag" "$out/$archive" "$out/$archive.sha256" \
    --repo "$repo" --verify-tag --draft --generate-notes \
    --title "Hermes Desktop $tag" \
    --notes "Apple Silicon macOS build, signed with Developer ID and notarized by Apple, packaged on the project Mac mini. Open the DMG and drag Hermes to Applications; it opens without removing the quarantine flag. It is not an App Store distribution."
  gh release edit "$tag" --repo "$repo" --draft=false
  bash scripts/prune-releases.sh "$repo" 2 --protect "$tag"
  # Installed apps see the new version only after the Release exists. Keep the two newest update zips.
  "$node_bin" services/mobile-updates/desktop-publish.mjs publish --store "$store" \
    --zip "$out/$update_zip" --sha256-file "$out/$update_zip.sha256" --notes "Hermes Desktop $tag"
  "$node_bin" services/mobile-updates/desktop-publish.mjs prune --store "$store" --keep 2
  status="$(curl -s -o /dev/null -w '%{http_code}' "https://hermes-app-api.tuly.space/desktop-updates/darwin-arm64/0.0.0")"
  [[ "$status" == 200 ]] || { echo "Update feed answered $status instead of 200." >&2; exit 1; }
fi
