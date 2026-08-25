#!/usr/bin/env bash
# Publish whitepaper/ to the public site.
# Flow: mirror whitepaper/ -> the public outfox-whitepaper repo -> push ->
# trigger GitBook to re-import. Publish only from a clean, reviewed state:
# everything under whitepaper/ becomes public the moment this runs.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/whitepaper"
PUB="${OUTFOX_WHITEPAPER_REPO:-$HOME/Projects/outfox-whitepaper}"
TOKEN_FILE="${GITBOOK_TOKEN_FILE:-$HOME/.config/gitbook/token}"
SPACE_ID="f3b29NcYLjPo3cnhExJ4"   # GitBook space "Whitepaper" (org WolfurX)

[ -d "$SRC" ] || { echo "missing $SRC"; exit 1; }
[ -d "$PUB/.git" ] || { echo "missing checkout of outfox-whitepaper at $PUB"; exit 1; }

# Mirror (delete removed files, keep .git)
find "$PUB" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$SRC/." "$PUB/"
# The sub-repo serves from its root, not from a whitepaper/ subdir
printf 'structure:\n  readme: README.md\n  summary: SUMMARY.md\n' > "$PUB/.gitbook.yaml"

cd "$PUB"
git add -A
if git diff --cached --quiet; then
  echo "whitepaper: no changes to publish"
  exit 0
fi
git commit -m "whitepaper: update $(date +%Y-%m-%d)"
git push origin master

curl -sS -f -X POST \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/WolfurX/outfox-whitepaper.git","ref":"refs/heads/master"}' \
  "https://api.gitbook.com/v1/spaces/$SPACE_ID/git/import" >/dev/null
echo "published: https://outfox.gitbook.io/whitepaper/"
