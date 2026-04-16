#!/usr/bin/env bash
# Sample pre-push hook: run samediff against the commits you're about to push
# and block the push on HIGH drift. Users can override with `--no-verify`.
#
# Install:
#   cp prototypes/pr-drift/hooks/pre-push.sh .git/hooks/pre-push
#   chmod +x .git/hooks/pre-push
#
# Configure the base ref via SAMEDIFF_BASE env var (default: origin/main).

set -euo pipefail

BASE_REF="${SAMEDIFF_BASE:-origin/main}"
HEAD_REF="HEAD"

# Use the most recent commit subject/body as a stand-in for the PR title/body.
# If you use a PR template, you can swap this for `gh pr view --json ...`.
PR_TITLE="$(git log -1 --pretty=%s "${HEAD_REF}")"
PR_BODY="$(git log -1 --pretty=%b "${HEAD_REF}")"

# Find the samediff binary: prefer a local checkout, fall back to $PATH.
if [ -x "./prototypes/pr-drift/bin/samediff" ]; then
  SAMEDIFF="./prototypes/pr-drift/bin/samediff"
elif [ -x "./node_modules/.bin/samediff" ]; then
  SAMEDIFF="./node_modules/.bin/samediff"
else
  SAMEDIFF="samediff"
fi

if ! "${SAMEDIFF}" check \
    --base "${BASE_REF}" \
    --head "${HEAD_REF}" \
    --pr-title "${PR_TITLE}" \
    --pr-body "${PR_BODY}" \
    --exit-code; then
  echo ""
  echo "samediff: HIGH drift detected — push blocked."
  echo "          re-run with 'git push --no-verify' to override."
  exit 1
fi
