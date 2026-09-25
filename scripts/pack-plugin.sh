#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
baseline="${HERMES_BASELINE:-${1:-}}"
[[ -n "$baseline" ]] || { echo 'Set HERMES_BASELINE or pass baseline path' >&2; exit 2; }
[[ "$(git -C "$baseline" rev-parse HEAD)" == 2f16a1aa5a35feec496949abdef7ad51aea0e7ef ]] || { echo 'Hermes baseline mismatch' >&2; exit 2; }
: "${TMPDIR:=/home/hermes/.hermes/profiles/jamie/cache/scratch}"
out="${P105_ARTIFACT_DIR:-/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p1-05/artifacts}"
mkdir -p "$out"
stage=$(mktemp -d "$TMPDIR/hermes-app-p1-05-pack-XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/hermes-app"
for file in plugins/hermes_app/*.py plugins/hermes_app/plugin.yaml; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Unexpected plugin file: $file" >&2; exit 2; }
  cp "$file" "$stage/hermes-app/$(basename "$file")"
done
cat > "$stage/hermes-app/README.txt" <<'NOTE'
Hermes App local P1 plugin; fixed Hermes baseline 2f16a1aa5a35feec496949abdef7ad51aea0e7ef.
Install, disable, backup, and recovery procedure: docs/p1/packaging.md in the source repository.
This archive contains plugin files only. It contains no database, credential, profile, or build cache.
NOTE
version=$(sed -n 's/^version: //p' plugins/hermes_app/plugin.yaml)
[[ -n "$version" ]] || { echo 'Missing plugin version' >&2; exit 2; }
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner --format=ustar -C "$stage" -cf "$stage/plugin.tar" hermes-app
gzip -n -9 "$stage/plugin.tar"
hash=$(sha256sum "$stage/plugin.tar.gz" | cut -d' ' -f1)
artifact="$out/hermes-app-plugin-${version}-${hash}.tar.gz"
if [[ -e "$artifact" ]]; then cmp "$stage/plugin.tar.gz" "$artifact"; else cp "$stage/plugin.tar.gz" "$artifact"; chmod 444 "$artifact"; fi
if [[ -e "$artifact.sha256" ]]; then
  sha256sum -c "$artifact.sha256"
else
  sha256sum "$artifact" > "$artifact.sha256"
  chmod 444 "$artifact.sha256"
fi
sha256sum "$artifact"
printf 'artifact=%s\n' "$artifact"
