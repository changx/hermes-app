#!/usr/bin/env bash
# Build the signed and notarized Apple Silicon desktop package for a pushed tag on the Mac mini,
# then publish it as a GitHub Release from this host.
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
# Steps: npm ci, desktop:check, npm audit, desktop:package:mac, signed and notarized DMG (scripts/macos-dmg.sh), SHA-256.
# The source is `git archive` of the tag commit, so the Mac mini needs no GitHub login.
# Prerequisites:
# - `ssh macmini` works (override with MACMINI_HOST).
# - Node v24.14.1 is in ~/.local/node-v24.14.1 on the Mac mini (official tarball).
# - `gh` on this host can write Releases to the repository.
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
remote_dir="hermes-desktop-build/$tag"
out="$root/tmp/release/$tag"

if $build; then
# Build on the Mac mini (the heredoc below must stay unindented).
echo "Building $tag ($sha) on $host in ~/$remote_dir"

ssh "$host" "rm -rf ~/$remote_dir && mkdir -p ~/$remote_dir"
git archive --format=tar "$sha" | ssh "$host" "tar -x -C ~/$remote_dir"
ssh "$host" bash -s -- "$remote_dir" "$node_version" "$archive" <<'REMOTE'
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
npm run desktop:package:mac
app="apps/desktop/artifacts/Hermes-darwin-arm64/Hermes.app"
test -f "$app/Contents/Resources/app.asar"
/usr/bin/file "$app/Contents/MacOS/Hermes" | /usr/bin/grep -q arm64
/usr/bin/codesign --verify --deep --strict "$app"
/usr/bin/xcrun stapler validate "$app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app" 2>&1 | /usr/bin/grep -q 'source=Notarized Developer ID'
mkdir -p release
bash scripts/macos-dmg.sh "$app" "release/$3"
cd release
/usr/bin/shasum -a 256 "$3" > "$3.sha256"
/usr/bin/shasum -a 256 -c "$3.sha256"
REMOTE

rm -rf "$out"; mkdir -p "$out"
scp -q "$host:$remote_dir/release/$archive" "$host:$remote_dir/release/$archive.sha256" "$out/"
fi
(cd "$out" && sha256sum -c "$archive.sha256")
echo "Package: $out/$archive"

if $publish; then
  gh release create "$tag" "$out/$archive" "$out/$archive.sha256" \
    --repo "$repo" --verify-tag --draft --generate-notes \
    --title "Hermes Desktop $tag" \
    --notes "Apple Silicon macOS build, signed with Developer ID and notarized by Apple, packaged on the project Mac mini. Open the DMG and drag Hermes to Applications; it opens without removing the quarantine flag. It is not an App Store distribution."
  gh release edit "$tag" --repo "$repo" --draft=false
  bash scripts/prune-releases.sh "$repo" 2 --protect "$tag"
fi
