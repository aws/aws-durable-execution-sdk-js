#!/usr/bin/env bash

set -euo pipefail

claude_bin="${GITHUB_ACTION_PATH}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"
bun_dir="${GITHUB_ACTION_PATH}/bin"

if [[ ! -x "$claude_bin" ]]; then
  echo "::error::The pinned Claude action did not install its bundled Linux CLI."
  exit 1
fi
if [[ ! -x "${bun_dir}/bun" ]]; then
  echo "::error::The pinned Claude action did not expose its Bun executable."
  exit 1
fi
if ! sudo -H -u claude-review -- test -x "$claude_bin"; then
  echo "::error::claude-review cannot execute the pinned Claude CLI."
  exit 1
fi
if ! sudo -H -u claude-review -- test -x "${bun_dir}/bun"; then
  echo "::error::claude-review cannot execute the pinned Bun runtime."
  exit 1
fi

exec sudo -H -u claude-review -- env \
  PATH="${bun_dir}:/usr/local/bin:/usr/bin:/bin" \
  TMPDIR=/home/claude-review/tmp \
  "$claude_bin" "$@"
