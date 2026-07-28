#!/usr/bin/env bash

set -euo pipefail

context_dir="${GITHUB_WORKSPACE}/.ai-review-context"
if [[ -e "$context_dir" ]]; then
  echo "::error::The trusted base contains the reserved review context path."
  exit 1
fi
mkdir "$context_dir"

verify_current_head() {
  local current_head_sha
  current_head_sha="$(
    gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq .head.sha
  )"
  if [[ "$current_head_sha" != "$EXPECTED_HEAD_SHA" ]]; then
    echo "::error::The PR changed; review its latest workflow run instead."
    exit 1
  fi
}

verify_current_head

gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" \
  > "$context_dir/pr.raw.json"
jq \
  --arg base_sha "$EXPECTED_BASE_SHA" \
  --arg head_sha "$EXPECTED_HEAD_SHA" \
  '{
    number,
    title,
    body,
    html_url,
    draft,
    author_association,
    additions,
    deletions,
    changed_files,
    user: .user.login,
    base: {ref: .base.ref, sha: $base_sha},
    head: {ref: .head.ref, sha: $head_sha}
  }' \
  "$context_dir/pr.raw.json" > "$context_dir/pr.json"

gh api \
  -H "Accept: application/vnd.github.v3.diff" \
  "repos/${GITHUB_REPOSITORY}/compare/${EXPECTED_BASE_SHA}...${EXPECTED_HEAD_SHA}" \
  > "$context_dir/pr.diff"

expected_file_count="$(jq -er '.changed_files' "$context_dir/pr.json")"
diff_file_count="$(
  awk '/^diff --git / { count++ } END { print count + 0 }' \
    "$context_dir/pr.diff"
)"
if [[ "$diff_file_count" != "$expected_file_count" ]]; then
  echo "::error::GitHub returned an incomplete PR diff."
  exit 1
fi

verify_current_head
rm "$context_dir/pr.raw.json"
