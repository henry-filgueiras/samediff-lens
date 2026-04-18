#!/bin/bash

set -euo pipefail
set -x

# Usage: ./track_drift_full.sh <path_to_file>
FILE_PATH=$1

if [ -z "$FILE_PATH" ]; then
    echo "Usage: $0 <path_to_file>"
    exit 1
fi

# Ensure output directory exists
mkdir -p diffs

# Get all commit hashes for this file in chronological order
commits=($(git log --reverse --format="%H" -- "$FILE_PATH"))
total=${#commits[@]}

if [ "$total" -eq 0 ]; then
    echo "Error: No history found for '$FILE_PATH'."
    exit 1
fi

filename=$(basename "$FILE_PATH")

echo "Processing $total commits (including initial check-in) for $FILE_PATH..."

# 1. Handle the Initial Check-in (EMPTY -> First Commit)
first_commit=${commits[0]}
short_first=${first_commit:0:8}

SAMEDIFF_TOOL="/Users/henry/samediff-lens/samediff"

echo "[0] Analyzing EMPTY -> $short_first (Initial Check-in)..."
${SAMEDIFF_TOOL} --html --out "diffs/${filename}-0-EMPTY-${short_first}.html" --git "EMPTY" "$first_commit" -- "$FILE_PATH"

# 2. Handle subsequent pairs (1 -> 2, 2 -> 3, etc.)
for (( i=0; i<$((total-1)); i++ )); do
    baseline=${commits[$i]}
    next=${commits[$((i+1))]}
    
    # We use i+1 for the index so the initial check-in is 0
    idx=$((i+1))

    short_base=${baseline:0:8}
    short_next=${next:0:8}

    output_file="diffs/${filename}-${idx}-${short_base}-${short_next}.html"

    echo "[$idx] Analyzing $short_base -> $short_next..."
    ${SAMEDIFF_TOOL} --html --out "$output_file" --git "$baseline" "$next" -- "$FILE_PATH"
done

echo "-----------------------------------------------"
echo "Done! Full lifecycle deltas generated in /diffs"
