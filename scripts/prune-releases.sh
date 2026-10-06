#!/usr/bin/env bash
# Keep only the newest published GitHub Releases; delete older Releases and their assets.
#
# Usage: scripts/prune-releases.sh <owner/repo> [keep=2] [--dry-run] [--protect <tag>]
#
# - Ordering is by Release creation time, newest first.
# - Draft Releases are never counted or deleted.
# - Git tags are kept; only the Release and its uploaded files are deleted.
# - --protect <tag> never deletes that Release (the one just published).
set -euo pipefail

repo="${1:?owner/repo required}"; shift
keep=2
dry_run=false
protect=""
while (($#)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --protect) protect="${2:?tag required}"; shift ;;
    *) keep="$1" ;;
  esac
  shift
done
if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then echo "keep must be a positive integer" >&2; exit 2; fi

mapfile -t tags < <(gh api --paginate "repos/$repo/releases?per_page=100" \
  --jq '.[] | select(.draft == false) | [.created_at, .tag_name] | @tsv' | sort -r | cut -f2)

echo "Published releases: ${#tags[@]}; keeping newest $keep."
for tag in "${tags[@]:0:keep}"; do echo "keep   $tag"; done
for tag in "${tags[@]:keep}"; do
  if [[ -n "$protect" && "$tag" == "$protect" ]]; then echo "keep   $tag (protected)"; continue; fi
  if $dry_run; then echo "would delete $tag"; continue; fi
  gh release delete "$tag" --repo "$repo" --yes
  echo "delete $tag"
done
