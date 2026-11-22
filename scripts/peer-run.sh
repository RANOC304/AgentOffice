#!/bin/sh
# Starts AgentOffice peer mode with whichever Node 22.18+ this computer has right now, so the
# background service keeps working after a Node upgrade (fnm, nvm, volta or a system package).
# Used by the systemd service that `npm run peer:setup` installs. Arguments go to server/peer.ts.

here=$(cd "$(dirname "$0")/.." && pwd)

usable() {
  [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' 2>/dev/null
}

candidates() {
  command -v node 2>/dev/null
  echo "$HOME/.local/share/fnm/aliases/default/bin/node"
  echo "$HOME/.volta/bin/node"
  echo /usr/local/bin/node
  echo /usr/bin/node
  # Newest first for version managers that keep one folder per version.
  ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -rV
}

# Split the list on newlines only, so folders with spaces in their names still work.
set -f
IFS='
'
for candidate in $(candidates); do
  if usable "$candidate"; then
    exec "$candidate" --disable-warning=ExperimentalWarning "$here/server/peer.ts" "$@"
  fi
done

echo "AgentOffice peer: no Node 22.18 or newer found on this computer. Install one, then it starts by itself." >&2
exit 1
