#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${OSTYPE:-}" == darwin* ]]; then
  python="${PYTHON:-/usr/bin/python3}"
else
  python="${PYTHON:-python3}"
fi
export PYTHONPYCACHEPREFIX
PYTHONPYCACHEPREFIX="$(mktemp -d)"
trap 'rm -rf "$PYTHONPYCACHEPREFIX"' EXIT
"$python" -m unittest discover -s tests -p 'test_*.py' -v
"$python" -m compileall -q tools tests
for script in tools/*.sh; do bash -n "$script"; done
git diff --check
if [[ -f product/check.sh ]]; then
  bash product/check.sh
fi
if [[ -f apps/ReplyWorkbench/check.sh ]]; then
  bash apps/ReplyWorkbench/check.sh
fi
