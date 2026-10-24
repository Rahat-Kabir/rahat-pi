#!/bin/bash
# Runs typecheck and the full test suite on Linux (inside WSL) from a scratch copy of a
# Windows checkout. Called by scripts/test-linux.mjs; never changes the source checkout.
set -uo pipefail

sourceDirectory="$1"
checkDirectory="$HOME/rahat-pi-check"

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || { echo "Node 22 is not installed in WSL. Run: nvm install 22"; exit 1; }
fi
node "$sourceDirectory/scripts/check-node.mjs" || exit 1
command -v rsync >/dev/null || { echo "rsync is missing in WSL. Run: sudo apt install rsync"; exit 1; }
command -v bwrap >/dev/null || echo "Warning: bubblewrap is missing (sudo apt install bubblewrap); sandbox tests will fail."

echo "Linux test run ($(. /etc/os-release && echo "$PRETTY_NAME"), Node $(node --version))"

# Unix sockets do not work under /mnt/<drive>, so tests run from a copy in the Linux home folder.
# Secrets, local data, git metadata, and Windows-built node_modules are never copied.
mkdir -p "$checkDirectory"
rsync -a --delete \
  --exclude=/node_modules --exclude=/data --exclude=/.env --exclude=/.git --exclude=/.reference \
  --exclude=/ui/node_modules --exclude=/ui/dist \
  "$sourceDirectory/" "$checkDirectory/"
cd "$checkDirectory"

# Reinstall Linux dependencies only when package-lock.json changed since the last run.
lockHash="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.rahat-pi-lock-hash 2>/dev/null)" != "$lockHash" ]; then
  echo "Installing dependencies (package-lock.json changed)..."
  npm ci --no-fund --no-audit --loglevel=error || { echo "FAIL: npm ci"; exit 1; }
  echo "$lockHash" > node_modules/.rahat-pi-lock-hash
fi

uiLockHash="$(sha256sum ui/package-lock.json | cut -d' ' -f1)"
if [ "$(cat ui/node_modules/.rahat-pi-lock-hash 2>/dev/null)" != "$uiLockHash" ]; then
  echo "Installing app dependencies (ui/package-lock.json changed)..."
  npm ci --prefix ui --no-fund --no-audit --loglevel=error || { echo "FAIL: npm ci (ui)"; exit 1; }
  echo "$uiLockHash" > ui/node_modules/.rahat-pi-lock-hash
fi

npx tsc --noEmit || { echo "FAIL: typecheck"; exit 1; }
echo "TYPECHECK OK"

# Building the app also type-checks it against the brain's API contract.
npm run ui:build --silent >/dev/null || { echo "FAIL: app build"; exit 1; }
echo "APP BUILD OK"

npx vitest run && npm run ui:test --silent
testExitCode=$?
if [ "$testExitCode" -eq 0 ]; then
  echo "PASS: safe to commit"
else
  echo "FAIL: see the failing tests above"
fi
exit "$testExitCode"
