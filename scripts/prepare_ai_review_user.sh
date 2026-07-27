#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 <claude-review|codex-review>" >&2
  exit 2
fi

review_user="$1"
home_dir="/home/${review_user}"

if [[ -z "${GITHUB_WORKSPACE:-}" || ! -d "$GITHUB_WORKSPACE" ]]; then
  echo "GITHUB_WORKSPACE must name an existing directory" >&2
  exit 2
fi

case "$review_user" in
  claude-review)
    private_dirs=("${home_dir}/.claude" "${home_dir}/tmp")
    ;;
  codex-review)
    private_dirs=("${home_dir}/.codex")
    ;;
  *)
    echo "unsupported AI review user: $review_user" >&2
    exit 2
    ;;
esac

sudo adduser \
  --system \
  --home "$home_dir" \
  --shell /bin/bash \
  --group "$review_user"

sudo install \
  -d \
  -m 700 \
  -o "$review_user" \
  -g "$review_user" \
  "${private_dirs[@]}"

# Standard hosted runners make /home/runner traversable. Keep this exact ACL
# fallback for images that use a private runner home instead.
if ! sudo -u "$review_user" test -x /home/runner; then
  sudo setfacl -m "u:${review_user}:--x" /home/runner
fi

sudo chown -R "runner:${review_user}" "$GITHUB_WORKSPACE"
sudo chmod -R g-w,o-rwx "$GITHUB_WORKSPACE"
sudo chmod -R g+rX "$GITHUB_WORKSPACE"

if ! sudo -u "$review_user" test -r "$GITHUB_WORKSPACE/README.md"; then
  echo "$review_user cannot read the trusted workspace" >&2
  exit 1
fi
