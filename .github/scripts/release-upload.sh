#!/usr/bin/env bash
# Upload files to a GitHub Release, trying the direct network path first.
#
# Usage: release-upload.sh <owner/repo> <release-id> <file>...
# Env:   GH_TOKEN (required)
#        UPLOAD_DIRECT_IF   physical interface for the direct path (default en0)
#        UPLOAD_DIRECT_IP   skip DoH and use this IP for the direct path (tests)
#
# The Mac mini sends all traffic through Surge (TUN), which routes GitHub to an
# overseas proxy. Measured uploads: direct 74-80 Mbps, Surge 8-12 Mbps, but the
# direct path may degrade at other times. So each file is tried:
#   1. direct: bound to UPLOAD_DIRECT_IF, uploads.github.com resolved with
#      AliDNS DoH (system DNS returns Surge fake IPs). Aborted below 4 Mbps for 20 s.
#   2. default route (Surge): after removing any partial asset from attempt 1.
# A line per attempt goes to stdout and, in Actions, to the job summary.
# Compatible with macOS bash 3.2 (no empty-array expansion under set -u).
set -euo pipefail

repo="${1:?usage: release-upload.sh <owner/repo> <release-id> <file>...}"
release_id="${2:?missing release id}"
shift 2
[[ $# -gt 0 ]] || { echo "No files to upload." >&2; exit 2; }
: "${GH_TOKEN:?GH_TOKEN is required}"
iface="${UPLOAD_DIRECT_IF:-en0}"
host="uploads.github.com"
api="https://api.github.com/repos/$repo/releases"
resp="$(mktemp)"; errf="$(mktemp)"
trap 'rm -f "$resp" "$errf"' EXIT

log() {
  echo "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "- $1" >> "$GITHUB_STEP_SUMMARY"; fi
}

# Prints the first A record of $host from AliDNS DoH, over the physical interface.
direct_ip() {
  curl -s --interface "$iface" --max-time 8 "https://223.5.5.5/resolve?name=$host&type=A" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=(JSON.parse(s).Answer||[]).find(x=>x.type===1);if(a)console.log(a.data)}catch{}})'
}

# Deletes an asset with this name (a partial upload blocks a retry with the same name).
delete_asset() {
  local name="$1" ids id
  ids="$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" "$api/$release_id/assets?per_page=100" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const a of JSON.parse(s))if(a.name===process.argv[1])console.log(a.id)})' "$name")"
  for id in $ids; do
    curl -fsS -X DELETE -H "Authorization: Bearer $GH_TOKEN" "$api/assets/$id" >/dev/null
  done
}

# attempt <label> <speed-limit B/s> <speed-time s> <file> [extra curl args...]
# Returns 0 only when GitHub answers 201 and reports the full file size.
attempt() {
  local label="$1" limit="$2" window="$3" file="$4" name size out code secs rate got
  shift 4
  name="$(basename "$file")"
  size="$(wc -c < "$file" | tr -d ' ')"
  out="$(curl -sS -o "$resp" -w '%{http_code} %{time_total} %{speed_upload}' "$@" \
    --connect-timeout 15 --speed-limit "$limit" --speed-time "$window" --max-time 600 \
    -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary @"$file" "https://$host/repos/$repo/releases/$release_id/assets?name=$name" 2>"$errf")" || true
  read -r code secs rate <<< "$out"
  secs="$(awk -v t="${secs:-0}" 'BEGIN{printf "%.1f", t}')"
  rate="$(awk -v r="${rate:-0}" 'BEGIN{printf "%.1f", r*8/1e6}')"
  if [[ "$code" == "201" ]]; then
    got="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).size' "$resp" 2>/dev/null || echo 0)"
    if [[ "$got" == "$size" ]]; then
      log "$name: $label OK, $size bytes in ${secs}s (${rate} Mbps)"
      return 0
    fi
    log "$name: $label size mismatch (GitHub $got, local $size)"
  else
    log "$name: $label failed (HTTP ${code:-none}, ${secs}s: $(head -c 160 "$errf" | tr '\n' ' '))"
  fi
  return 1
}

ip="${UPLOAD_DIRECT_IP:-$(direct_ip || true)}"
[[ -n "$ip" ]] || log "direct path unavailable: no DoH answer for $host via $iface"

for file in "$@"; do
  name="$(basename "$file")"
  if [[ -n "$ip" ]] && attempt "direct($iface)" 500000 20 "$file" --interface "$iface" --resolve "$host:443:$ip"; then
    continue
  fi
  delete_asset "$name"
  # Fallback through the default route; only abort a truly stalled upload.
  attempt "default route (Surge)" 50000 60 "$file" || { delete_asset "$name"; exit 1; }
done
