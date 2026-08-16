#!/bin/sh
#
# Git hooks live in .git/hooks, which is not version controlled — so the hook
# itself is kept in the repo and copied into place by this script. Run it once
# per clone.
#
#   sh scripts/hooks/install.sh

set -e

root=$(git rev-parse --show-toplevel)
cp "$root/scripts/hooks/pre-push" "$root/.git/hooks/pre-push"
chmod +x "$root/.git/hooks/pre-push"

echo "Installed pre-push hook."
echo "It blocks a push when production is missing migrations the code needs."
echo "Bypass any single push with: git push --no-verify"
