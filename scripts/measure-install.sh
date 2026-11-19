#!/bin/sh
# Print the size measures that the slim-and-DRY plan records in each PR.
# It never touches the gournal home. npm uses its normal cache, and the build writes the git-ignored dist folder.
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp "$REPO/package.json" "$REPO/package-lock.json" "$T"/
(cd "$T" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1)
PKGS=$(cd "$T" && npm ls --omit=dev --all --parseable 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
KB=$(du -sk "$T/node_modules" | cut -f1)
LINES=$(find "$REPO/src" -name '*.ts' -exec cat {} + | wc -l | tr -d ' ')
FILES=$(find "$REPO/src" -name '*.ts' | wc -l | tr -d ' ')
echo "prod packages: $PKGS"
echo "prod install: $KB kB"
echo "src lines: $LINES"
echo "src files: $FILES"
(cd "$REPO" && npm run -s build >/dev/null && npm pack --dry-run 2>&1 | grep -E 'package size|unpacked size|total files' | sed 's/^npm notice //')
