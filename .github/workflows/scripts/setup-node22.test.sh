#!/usr/bin/env bash
set -euo pipefail
setup_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-node22.sh"
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p "$fixture_root/bin" "$fixture_root/tmp"
export RUNNER_TEMP="$fixture_root/tmp" GITHUB_PATH="$fixture_root/github-path"
export FIXTURE_ROOT="$fixture_root"
export PATH="$fixture_root/bin:$PATH"

cat > "$fixture_root/bin/node" <<'NODE'
#!/usr/bin/env bash
case "${2:-}" in
  'process.versions.node.split(".")[0]') echo "${FIXTURE_NODE_MAJOR:-22}" ;;
  'process.execPath') echo "$0" ;;
  *) echo v22.23.3 ;;
esac
NODE
cat > "$fixture_root/bin/curl" <<'CURL'
#!/usr/bin/env bash
touch "$FIXTURE_ROOT/downloaded"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then printf corrupt > "$2"; exit 0; fi
  shift
done
exit 1
CURL
cat > "$fixture_root/bin/tar" <<'TAR'
#!/usr/bin/env bash
touch "$FIXTURE_ROOT/unpacked"
exit 1
TAR
chmod +x "$fixture_root/bin/"*

# Missing or stale NVM configuration is irrelevant when Node 22 is available.
NVM_DIR=/does-not-exist bash -c 'source "$1"; echo continued' _ "$setup_script" > "$fixture_root/selected"
grep -q '^continued$' "$fixture_root/selected"
grep -Fxq "$fixture_root/bin" "$GITHUB_PATH"
test ! -e "$fixture_root/downloaded"

# A wrong major selects the archive path; checksum failure must prevent tar,
# including when the caller did not enable errexit.
if FIXTURE_NODE_MAJOR=24 bash -c 'source "$1"' _ "$setup_script" > "$fixture_root/rejected" 2>&1; then
  echo "Checksum mismatch was accepted" >&2
  exit 1
fi
grep -q 'checksum mismatch' "$fixture_root/rejected"
test -e "$fixture_root/downloaded"
test ! -e "$fixture_root/unpacked"

cat > "$fixture_root/bin/uname" <<'UNAME'
#!/usr/bin/env bash
echo Darwin
UNAME
chmod +x "$fixture_root/bin/uname"
if bash -c 'source "$1"' _ "$setup_script" > "$fixture_root/platform" 2>&1; then
  echo "Unsupported platform was accepted" >&2
  exit 1
fi
grep -q 'requires Linux' "$fixture_root/platform"
echo "Node 22 setup: three offline fixtures passed"
