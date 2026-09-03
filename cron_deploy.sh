#!/bin/bash
# Auto-deploy: pulls the latest commit on main and asks cPanel to run the
# .cpanel.yml deploy tasks (copy into public_html), so a merge to main goes
# live on its own — nobody has to open cPanel's Git Version Control page
# and click "Update from Remote" / "Deploy HEAD Commit" by hand.
#
# Set up as a cPanel cron job (see README's "Automatic deploy" section for
# the exact steps). Safe to run every few minutes: it's a no-op whenever
# main hasn't moved since the last run.
#
# REPO_DIR must be the "Repository Path" shown on cPanel's Git Version
# Control page for THIS repo — that's the bare git checkout cPanel manages,
# not the public_html folder the site is served from (DEPLOYPATH in
# .cpanel.yml). Update it below if it doesn't match your account.
set -euo pipefail

REPO_DIR="/home/murphserv/repositories/ledgerstone"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "cron_deploy.sh: '$REPO_DIR' is not a git checkout. Open cPanel > Git Version Control, copy this repo's 'Repository Path', and update REPO_DIR at the top of this script." >&2
  exit 1
fi

cd "$REPO_DIR"

BEFORE="$(git rev-parse HEAD)"
git fetch origin main
git merge --ff-only origin/main
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  exit 0
fi

echo "cron_deploy.sh: deploying $BEFORE -> $AFTER"
uapi VersionControl deploy repository_root="$REPO_DIR"
