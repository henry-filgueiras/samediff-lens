#!/usr/bin/env bash
set -euo pipefail

# Remember where the user ran us from, so relative paths work
ORIG_DIR="$(pwd)"
EXAMPLES_DIR="$(cd "$(dirname "$0")" && pwd)"
SAMEDIFF_PATH="${EXAMPLES_DIR}/../samediff"

set -x

find "${EXAMPLES_DIR}" -type d | \
    tail -n +2 | \
    xargs -I{} "${SAMEDIFF_PATH}" {}/left.md {}/right.md --html --out {}/findings.html
