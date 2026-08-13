#!/usr/bin/env bash
set -euo pipefail

site_demo_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required." >&2
  exit 1
fi

for site_demo_argument in "$@"; do
  if [[ "$site_demo_argument" == "--validate" ]]; then
    exec node "$site_demo_script_dir/record_site_demo.mjs" "$@"
  fi
done

for site_demo_tool in npm ffmpeg ffprobe; do
  if ! command -v "$site_demo_tool" >/dev/null 2>&1; then
    echo "$site_demo_tool is required." >&2
    exit 1
  fi
done

if [[ ! -f "$site_demo_script_dir/node_modules/playwright/package.json" ]]; then
  npm install --prefix "$site_demo_script_dir" --no-audit --no-fund
fi

if ! node -e 'const fs = require("node:fs"); const { chromium } = require(process.argv[1] + "/node_modules/playwright"); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);' "$site_demo_script_dir"; then
  npx --prefix "$site_demo_script_dir" playwright install chromium
fi
exec node "$site_demo_script_dir/record_site_demo.mjs" "$@"
