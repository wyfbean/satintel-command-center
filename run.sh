#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on http://0.0.0.0:6008 ..."
(
  cd "$ROOT_DIR/backend"
  python -m uvicorn app:app --host 0.0.0.0 --port 6008
) &

echo "Starting frontend on http://0.0.0.0:6006 ..."
(
  cd "$ROOT_DIR"
  npm run dev -- --hostname 0.0.0.0 --port 6006
) &

wait
