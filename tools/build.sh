#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ]]; then
  repo_root="${BUILD_WORKSPACE_DIRECTORY}"
else
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "${script_dir}/.." && pwd)"
fi

cd "${repo_root}"

if [[ ! -x "node_modules/.bin/tsc" || ! -x "node_modules/.bin/vite" ]]; then
  echo "Missing frontend dependencies. Run 'npm install' in ${repo_root} first." >&2
  exit 1
fi

exec npm run build
