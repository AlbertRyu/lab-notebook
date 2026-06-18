#!/usr/bin/env bash
set -euo pipefail

# Back up the lab-notebook data directory into a timestamped .tar.gz archive.
#
# What this script backs up:
#   - SQLite database: data/lab_notebook.db
#   - Sample raw files: data/samples/
#   - Imported notes: data/notes/
#   - Stock photos: data/stock/
#   - JSON config files: data/*.json
#
# Why the database is handled specially:
#   SQLite databases can have active WAL/SHM sidecar files while the app is running.
#   Copying lab_notebook.db directly can produce an inconsistent backup, so this script
#   asks SQLite to create a consistent snapshot with the .backup command first.
#
# Usage:
#   scripts/backup-data.sh
#
# Optional overrides:
#   DATA_DIR=./data BACKUP_ROOT=./backups scripts/backup-data.sh

# Resolve the repository root from this script's location, so the script works even
# when you run it from another directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# DATA_DIR is the live application data directory. By default this is ./data in the
# repository, matching the local Docker bind mount described in CLAUDE.md.
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"

# BACKUP_ROOT is where finished backup archives will be written. Put this on an
# external disk, NAS mount, or synced folder if you want protection from disk loss.
BACKUP_ROOT="${BACKUP_ROOT:-$REPO_ROOT/backups}"

DB_NAME="lab_notebook.db"
DB_PATH="$DATA_DIR/$DB_NAME"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_NAME="lab-notebook-$STAMP"
STAGING_PARENT="$BACKUP_ROOT/.staging-$STAMP"
STAGING_DIR="$STAGING_PARENT/$BACKUP_NAME"
ARCHIVE_PATH="$BACKUP_ROOT/$BACKUP_NAME.tar.gz"

# Clean up the temporary staging directory if the script fails halfway through.
cleanup() {
  rm -rf "$STAGING_PARENT"
}
trap cleanup EXIT

# Fail early with clear messages if required inputs/tools are missing.
if [[ ! -d "$DATA_DIR" ]]; then
  echo "ERROR: DATA_DIR does not exist: $DATA_DIR" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "ERROR: SQLite database not found: $DB_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 is required but was not found in PATH" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is required but was not found in PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
mkdir -p "$STAGING_DIR"

# Step 1: Create a transactionally consistent SQLite snapshot.
# This is safe while the app is running and avoids copying a half-written database.
echo "Creating SQLite snapshot..."
sqlite3 "$DB_PATH" ".backup '$STAGING_DIR/$DB_NAME'"

# Step 2: Copy all non-database data into the same staging directory.
# We exclude the live SQLite files because the consistent snapshot above replaces them.
echo "Copying data files..."
rsync -a \
  --exclude "$DB_NAME" \
  --exclude "$DB_NAME-wal" \
  --exclude "$DB_NAME-shm" \
  "$DATA_DIR/" "$STAGING_DIR/"

# Step 3: Compress the staged backup into one portable archive.
# The archive contains a single top-level folder named lab-notebook-YYYYMMDD-HHMMSS/.
echo "Creating archive..."
tar -czf "$ARCHIVE_PATH" -C "$STAGING_PARENT" "$BACKUP_NAME"

# Step 4: Verify that the archive exists and is not empty before reporting success.
if [[ ! -s "$ARCHIVE_PATH" ]]; then
  echo "ERROR: Backup archive was not created: $ARCHIVE_PATH" >&2
  exit 1
fi

BYTES="$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')"
echo "Backup complete: $ARCHIVE_PATH ($BYTES bytes)"

# The EXIT trap removes the temporary staging directory here.
