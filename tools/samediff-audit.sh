#!/usr/bin/env bash
#
# samediff-audit — scan → history → audit in one shot.
#
# A cantrip: point it at a git repo and it ranks the high-churn
# markdown / text files, lets you pick one, walks its full history,
# and produces a reviewable audit.md with a persistent verdict store.
#
# Usage:
#   samediff-audit [options] [<file>]
#
#   <file>                  File to audit (repo-relative or absolute).
#                           If omitted, a scan+prompt flow kicks in.
#
# Options:
#   -d, --dir <path>        Scan starting dir (default: .)
#   -n, --top <N>           How many top-churn files to show (default: 10)
#   -o, --out <dir>         Output dir (default: .samediff/<basename>)
#       --no-empty          Skip the EMPTY → first-commit baseline
#   -y, --yes               Auto-pick the highest-churn file (no prompt)
#       --pick <N>          Pick the Nth file (1-indexed) from the scan
#       --max-diff-lines N  Cap diff lines per step in audit.md (default: 60)
#       --include-quiet     Include below-the-fold quiet issues in audit.md
#   -h, --help              Show this help
#
# Environment:
#   SAMEDIFF               Path to the samediff binary. If unset, we try
#                          (in order): ./samediff, samediff in PATH, and
#                          finally the one next to this script.

set -euo pipefail

# ── Colors (disabled when not a TTY or NO_COLOR is set) ────────────
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  B=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  B=""; DIM=""; CYAN=""; GREEN=""; YELLOW=""; RESET=""
fi

usage() {
  sed -n 's/^# \{0,1\}//;3,27p' "$0"
}

# ── Locate samediff ─────────────────────────────────────────────────
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_samediff="${script_dir%/tools}/samediff"

resolve_samediff() {
  if [[ -n "${SAMEDIFF:-}" && -x "$SAMEDIFF" ]]; then
    printf '%s' "$SAMEDIFF"; return
  fi
  if [[ -x "./samediff" ]]; then
    printf '%s' "$(pwd)/samediff"; return
  fi
  if command -v samediff >/dev/null 2>&1; then
    command -v samediff; return
  fi
  if [[ -x "$repo_samediff" ]]; then
    printf '%s' "$repo_samediff"; return
  fi
  echo "error: couldn't locate the samediff binary." >&2
  echo "  set SAMEDIFF=/path/to/samediff or add it to PATH." >&2
  exit 127
}

# ── Flag parsing ────────────────────────────────────────────────────
scan_dir="."
top_n=10
out_dir=""
include_empty=1
auto_pick=0
pick_index=0
max_diff=60
include_quiet=0
explicit_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -d|--dir) scan_dir="$2"; shift 2 ;;
    -n|--top) top_n="$2"; shift 2 ;;
    -o|--out) out_dir="$2"; shift 2 ;;
    --no-empty) include_empty=0; shift ;;
    -y|--yes) auto_pick=1; shift ;;
    --pick) pick_index="$2"; shift 2 ;;
    --max-diff-lines) max_diff="$2"; shift 2 ;;
    --include-quiet) include_quiet=1; shift ;;
    --) shift; break ;;
    -*) echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *) explicit_file="$1"; shift ;;
  esac
done

SAMEDIFF_BIN="$(resolve_samediff)"

# ── Confirm we're inside a git repo ────────────────────────────────
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "error: not inside a git working tree." >&2
  exit 1
fi
cd "$repo_root"

echo "${B}samediff-audit${RESET} · repo: ${CYAN}$repo_root${RESET}"
echo "${DIM}binary: $SAMEDIFF_BIN${RESET}"
echo

# ── Pick target file ───────────────────────────────────────────────
target=""
if [[ -n "$explicit_file" ]]; then
  # Normalize: accept absolute or repo-relative; store repo-relative.
  if [[ "$explicit_file" = /* ]]; then
    target="${explicit_file#$repo_root/}"
  else
    target="$explicit_file"
  fi
  if [[ ! -f "$repo_root/$target" ]]; then
    echo "error: file not found at $repo_root/$target" >&2
    exit 1
  fi
  echo "${B}target:${RESET} $target (explicit)"
else
  echo "${B}scan${RESET} · top $top_n by commit churn under ${CYAN}$scan_dir${RESET}"
  scan_out="$("$SAMEDIFF_BIN" scan "$scan_dir" --top "$top_n")"
  echo "$scan_out"

  # Parse the scan rows (lines like "  NNN  path/to/file.md").
  mapfile -t rows < <(printf '%s\n' "$scan_out" \
    | awk '/^[[:space:]]*[0-9]+[[:space:]]+[^[:space:]]/ { sub(/^[[:space:]]+/,""); print }')
  if [[ ${#rows[@]} -eq 0 ]]; then
    echo "error: no files matched." >&2
    exit 1
  fi

  idx=0
  if [[ $auto_pick -eq 1 ]]; then
    idx=0
  elif [[ $pick_index -gt 0 ]]; then
    idx=$((pick_index - 1))
  else
    echo
    echo "${B}pick${RESET} a file by number (1-${#rows[@]}, default 1):"
    read -r pick < /dev/tty || pick=""
    if [[ -z "$pick" ]]; then
      idx=0
    elif [[ "$pick" =~ ^[0-9]+$ ]]; then
      idx=$((pick - 1))
    else
      echo "error: invalid selection '$pick'" >&2; exit 2
    fi
  fi

  if [[ $idx -lt 0 || $idx -ge ${#rows[@]} ]]; then
    echo "error: selection out of range" >&2; exit 2
  fi

  # Each row is "  NNN  path" — path is everything after the first gap.
  row="${rows[$idx]}"
  target="$(printf '%s' "$row" | awk '{ for (i=2; i<=NF; i++) printf "%s%s", $i, (i<NF?" ":"") }')"
  echo "${B}picked:${RESET} $target"
fi

# ── Derive output dir ──────────────────────────────────────────────
if [[ -z "$out_dir" ]]; then
  base="$(basename "$target")"
  out_dir=".samediff/${base%.*}"
fi
mkdir -p "$out_dir"
abs_out="$(cd "$out_dir" && pwd)"

echo
echo "${B}history${RESET} → ${CYAN}$abs_out${RESET}"

hist_args=(history "$target" -o "$out_dir")
if [[ $include_empty -eq 0 ]]; then
  hist_args+=(--no-empty)
fi

"$SAMEDIFF_BIN" "${hist_args[@]}" >/dev/null

# Pull the trail stats so we can render a summary before audit.
trail_json="$out_dir/trail.json"
if [[ ! -f "$trail_json" ]]; then
  echo "error: history failed to write trail.json" >&2
  exit 1
fi
step_count="$(awk -F'"' '/"index":/{c++} END{print c+0}' "$trail_json")"
echo "  ${GREEN}✓${RESET} $step_count transition$([ "$step_count" = 1 ] || echo s)"
echo "  index: $abs_out/index.html"

# ── Audit ──────────────────────────────────────────────────────────
echo
echo "${B}audit${RESET} → $abs_out/audit.md"

audit_args=(audit "$out_dir" --max-diff-lines "$max_diff")
if [[ $include_quiet -eq 1 ]]; then
  audit_args+=(--include-quiet)
fi

"$SAMEDIFF_BIN" "${audit_args[@]}"

echo
echo "${B}artifacts${RESET}:"
echo "  ${CYAN}$abs_out/audit.md${RESET}       ← reviewer canvas (edit verdict / finding-verdicts slots)"
echo "  ${CYAN}$abs_out/verdicts.json${RESET}  ← machine-readable store (persists across reruns)"
echo "  ${CYAN}$abs_out/index.html${RESET}     ← drift-over-time chart + per-step reports"
echo "  ${CYAN}$abs_out/trail.json${RESET}     ← raw per-step summary"
echo
echo "${YELLOW}next:${RESET} edit verdict slots in audit.md, then re-run this cantrip to persist."
