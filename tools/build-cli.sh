#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Compile CLI TypeScript to CommonJS
npx tsc -p tsconfig.cli.json

# Add a package.json to dist-cli that forces CommonJS interpretation
# (the root package.json has "type": "module" which conflicts)
cat > dist-cli/package.json << 'EOF'
{ "type": "commonjs" }
EOF

echo "CLI built to dist-cli/"
