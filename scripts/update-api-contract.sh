#!/usr/bin/env bash
# Regenerate the committed OpenAPI contract and (when present) the TS types.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p packages/core
(cd server && uv run python scripts/dump_openapi.py) > packages/core/openapi.json
echo "wrote packages/core/openapi.json"

if [ -f packages/core/package.json ]; then
  npm run generate --workspace @crossclipper/core
fi
