#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
input_svg="${repo_root}/docs/storyboard/samediff-lens-storyboard.svg"
output_dir="${repo_root}/docs/storyboard"
output_png="${output_dir}/samediff-lens-storyboard.png"

if [[ ! -f "${input_svg}" ]]; then
  echo "Missing source SVG: ${input_svg}" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required for PNG export on this machine." >&2
  exit 1
fi

if ! sips -s format png "${input_svg}" --out "${output_png}" >/dev/null 2>&1; then
  echo "PNG export failed: ${output_png}" >&2
  exit 1
fi

echo "Exported ${output_png}"
