#!/usr/bin/env bash
set -euo pipefail

# Daily cloud backup of the lab-notebook data directory to Backblaze B2 via restic.
#
# What this script does:
#   1. Builds a consistent snapshot of data/ in a staging directory:
#        - SQLite database copied via `sqlite3 .backup` (WAL-safe while app runs)
#        - All other files synced via rsync, excluding the live db / db-wal / db-shm
#   2. Uploads the staging tree to a restic repository on B2 (encrypted, deduped)
#   3. Applies a retention policy: 7 daily + 4 weekly + 12 monthly snapshots
#
# Why staging instead of `restic backup data/` directly:
#   SQLite under WAL mode can have a half-written database file at any moment.
#   Copying the file directly risks a corrupt backup. The staging step produces
#   a transactionally consistent snapshot first, and restic then sees a clean
#   file tree it can dedup across runs.
#
# First-time setup (see CLAUDE.md "Backups"):
#   1. Create a private B2 bucket, e.g. `lab-notebook-backups`
#   2. Create a B2 Application Key restricted to that bucket (read+write)
#   3. `cp scripts/.restic.env.example scripts/.restic.env` and fill in credentials
#   4. Run this script once manually — restic will `init` the repo on first use
#   5. Install the launchd plist (see scripts/com.lab-notebook.backup.plist)
#
# Usage:
#   scripts/backup-to-b2.sh
#
# Optional overrides (env vars):
#   DATA_DIR=./data BACKUP_ROOT=./backups scripts/backup-to-b2.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backups}"
ENV_FILE="$SCRIPT_DIR/.restic.env"

DB_NAME="lab_notebook.db"
DB_PATH="$DATA_DIR/$DB_NAME"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_PARENT="$BACKUP_ROOT/.staging-restic-$STAMP"
STAGING_DIR="$STAGING_PARENT/data"

cleanup() {
  rm -rf "$STAGING_PARENT"
}
trap cleanup EXIT

# --- Pre-flight checks -------------------------------------------------------

if [[ ! -d "$DATA_DIR" ]]; then
  echo "ERROR: DATA_DIR does not exist: $DATA_DIR" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "ERROR: SQLite database not found: $DB_PATH" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "       Copy scripts/.restic.env.example to scripts/.restic.env and fill in credentials." >&2
  exit 1
fi

for cmd in sqlite3 rsync restic; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd is required but was not found in PATH" >&2
    exit 1
  fi
done

# Load restic/B2 credentials. Use `set -a` so they're exported for child processes.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set in $ENV_FILE}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set in $ENV_FILE}"
: "${B2_ACCOUNT_ID:?B2_ACCOUNT_ID must be set in $ENV_FILE}"
: "${B2_ACCOUNT_KEY:?B2_ACCOUNT_KEY must be set in $ENV_FILE}"

export RESTIC_REPOSITORY RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY

# Auto-initialize the restic repo on first run.
if ! restic snapshots >/dev/null 2>&1; then
  echo "Initializing restic repository at $RESTIC_REPOSITORY..."
  restic init
fi

mkdir -p "$BACKUP_ROOT"
mkdir -p "$STAGING_DIR"

# --- Step 1: SQLite consistent snapshot --------------------------------------

echo "Creating SQLite snapshot..."
sqlite3 "$DB_PATH" ".backup '$STAGING_DIR/$DB_NAME'"

# --- Step 2: Copy non-database data ------------------------------------------

echo "Copying data files..."
rsync -a \
  --exclude "$DB_NAME" \
  --exclude "$DB_NAME-wal" \
  --exclude "$DB_NAME-shm" \
  "$DATA_DIR/" "$STAGING_DIR/"

# --- Step 3: Upload to B2 via restic -----------------------------------------

echo "Uploading snapshot to $RESTIC_REPOSITORY..."
restic backup --tag auto "$STAGING_DIR"

# --- Step 4: Apply retention policy ------------------------------------------
# 7 most-recent daily, 4 most-recent weekly, 12 most-recent monthly snapshots.
# Older snapshots are forgotten and their data pruned from B2.
echo "Applying retention policy..."
restic forget \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 12 \
  --prune

echo "Backup complete."
