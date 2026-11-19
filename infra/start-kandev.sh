#!/usr/bin/env bash
set -euo pipefail
umask 077
infra="${IOS_RESEARCH_INFRA:-$HOME/ai-dev-infra}"
export PATH="$infra/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
export KANDEV_HOME_DIR="${KANDEV_HOME_DIR:-$infra/kandev-state}"
export KANDEV_SERVER_HOST=127.0.0.1
export KANDEV_AGENT_STANDALONE_HOST=127.0.0.1
export AGENTCTL_PORT="${AGENTCTL_PORT:-39439}"
port="${IOS_RESEARCH_KANDEV_PORT:-38439}"
cd "$infra"
exec "$infra/kandev/node_modules/.bin/kandev" run --headless --port "$port"
