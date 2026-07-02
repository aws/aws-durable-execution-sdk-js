# External PR Policy

## For Maintainers

External PRs skip integration tests for security. To merge:

1. **Review code carefully**
2. **Add `safe-to-merge` label** for safe changes (docs, small fixes)
3. **Use "Squash and merge"**

## Safe Changes

- Documentation updates
- Comment/JSDoc fixes
- Small typo corrections
- Non-functional changes

## Changes Needing Full Tests

Create internal branch and recreate the PR for full integration testing.
