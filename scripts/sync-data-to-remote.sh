#!/usr/bin/env bash
set -euo pipefail

# Manual one-way sync for the remote read-only instance.
# Fill these values before first use.
REMOTE_USER="${REMOTE_USER:-yunxiao}"
REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/home/yunxiao/lab-notebook-data}"
REMOTE_COMPOSE_CMD="${REMOTE_COMPOSE_CMD:-docker compose -f docker-compose.yml -f docker-compose.prod.yml}"
SERVICE_NAME="${SERVICE_NAME:-lab-notebook}"

LOCAL_DATA_DIR="${LOCAL_DATA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data}"
DB_NAME="lab_notebook.db"

if [[ -z "$REMOTE_HOST" || -z "$REMOTE_COMPOSE_DIR" ]]; then
  echo "Set REMOTE_HOST and REMOTE_COMPOSE_DIR before running." >&2
  echo "Example:" >&2
  echo "  REMOTE_HOST=server REMOTE_COMPOSE_DIR=/opt/lab-notebook $0" >&2
  exit 2
fi

for cmd in rsync ssh sqlite3 mktemp; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 2
  fi
done

if [[ ! -d "$LOCAL_DATA_DIR" ]]; then
  echo "Local data dir does not exist: $LOCAL_DATA_DIR" >&2
  exit 2
fi

if [[ ! -f "$LOCAL_DATA_DIR/$DB_NAME" ]]; then
  echo "Local database does not exist: $LOCAL_DATA_DIR/$DB_NAME" >&2
  exit 2
fi

SNAPSHOT_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$SNAPSHOT_DIR"
}
trap cleanup EXIT

echo "Creating local data snapshot..."
rsync -a --delete \
  --exclude "$DB_NAME" \
  --exclude "$DB_NAME-wal" \
  --exclude "$DB_NAME-shm" \
  "$LOCAL_DATA_DIR"/ "$SNAPSHOT_DIR"/

sqlite3 "$LOCAL_DATA_DIR/$DB_NAME" ".backup '$SNAPSHOT_DIR/$DB_NAME'"

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

echo "Stopping remote container..."
ssh "$REMOTE" "cd '$REMOTE_COMPOSE_DIR' && $REMOTE_COMPOSE_CMD stop '$SERVICE_NAME'"

echo "Ensuring remote data directory exists..."
ssh "$REMOTE" "mkdir -p '$REMOTE_DATA_DIR'"

echo "Syncing snapshot to remote..."
rsync -az --delete --delay-updates "$SNAPSHOT_DIR"/ "$REMOTE:$REMOTE_DATA_DIR"/

echo "Starting remote container..."
ssh "$REMOTE" "cd '$REMOTE_COMPOSE_DIR' && $REMOTE_COMPOSE_CMD up -d '$SERVICE_NAME'"

echo "Done."
