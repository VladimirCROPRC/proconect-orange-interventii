#!/usr/bin/env bash
set -euo pipefail

state_dir="${WRANGLER_STATE_DIR:-/data/wrangler}"
mkdir -p "${state_dir}"

npx wrangler d1 migrations apply proconect-orange-interventii-db \
  --local \
  --persist-to "${state_dir}" \
  --config wrangler.server.jsonc

exec npx wrangler dev \
  --local \
  --persist-to "${state_dir}" \
  --config wrangler.server.jsonc \
  --ip 0.0.0.0 \
  --port 3000 \
  --test-scheduled
