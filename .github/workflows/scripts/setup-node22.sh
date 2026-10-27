#!/usr/bin/env bash
# Source this file so the following preparation commands use the selected Node.
# CodeBuild does not provide GitHub-hosted runners' $HOME/.nvm installation.
durable_setup_node22() {
  local version=22.23.3 arch checksum install_root archive node_bin
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64)
      arch=x64
      checksum=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
      ;;
    Linux/aarch64|Linux/arm64)
      arch=arm64
      checksum=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f
      ;;
    *) echo "Node 22 CI setup requires Linux x64 or arm64" >&2; return 1 ;;
  esac

  if command -v node >/dev/null 2>&1 &&
    [ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ]; then
    node_bin=$(dirname "$(node -p 'process.execPath')")
  else
    install_root=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/durable-node22.XXXXXX") || return 1
    archive="node-v${version}-linux-${arch}.tar.xz"
    curl --fail --silent --show-error --location --retry 3 \
      "https://nodejs.org/dist/v${version}/${archive}" \
      --output "${install_root}/${archive}" || return 1
    # Values are from the official v22.23.3 SHASUMS256.txt. Never unpack an
    # unverified response, even when this file is sourced without errexit.
    printf '%s  %s\n' "$checksum" "${install_root}/${archive}" |
      sha256sum --check --status || {
        echo "Node 22 archive checksum mismatch" >&2
        return 1
      }
    tar -xJf "${install_root}/${archive}" -C "$install_root" || return 1
    node_bin="${install_root}/${archive%.tar.xz}/bin"
  fi

  export PATH="${node_bin}:${PATH}"
  if [ -n "${GITHUB_PATH:-}" ]; then
    printf '%s\n' "$node_bin" >> "$GITHUB_PATH" || return 1
  fi
  [ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || return 1
  node --version
}

durable_setup_node22
