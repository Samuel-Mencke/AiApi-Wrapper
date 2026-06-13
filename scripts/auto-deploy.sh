#!/usr/bin/env bash
# Auto-Deploy: pollt GitHub main und deployed bei Änderungen.
# Wird von systemd aiapi-autodeploy.timer aufgerufen.
set -euo pipefail

REPO_DIR="/home/samuel/AiApi-Wrapper"
BRANCH="main"
REMOTE="origin"
LOG_FILE="/var/log/aiapi-autodeploy.log"
COMPOSE_FILE="$REPO_DIR/docker-compose.yml"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# --- Lock gegen parallele Runs ---
LOCK_FILE="/var/lock/aiapi-autodeploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "SKIP: anderer deploy läuft noch"
    exit 0
fi

cd "$REPO_DIR"

# --- Aktuellen Stand sichern ---
OLD_SHA=$(git rev-parse "$BRANCH" 2>/dev/null || echo "")

# --- Remote fetchen (ohne working tree zu verändern) ---
if ! git fetch "$REMOTE" "$BRANCH" >>"$LOG_FILE" 2>&1; then
    log "ERROR: git fetch fehlgeschlagen — überspringe"
    exit 0  # kein harter Fehler,netzwerk könnte flacken
fi

REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH")

if [[ "$OLD_SHA" == "$REMOTE_SHA" ]]; then
    exit 0  # nichts zu tun, schweigen
fi

# --- Änderung erkannt ---
OLD_SHORT="${OLD_SHA:0:7}"
NEW_SHORT="${REMOTE_SHA:0:7}"
LOG_MSG=$(git log --oneline "$OLD_SHA..$REMOTE_SHA" 2>/dev/null | head -5)

log "==== Deploy start: $OLD_SHORT -> $NEW_SHORT ===="
[[ -n "$LOG_MSG" ]] && log "Commits:"$'\n'"$LOG_MSG"

# --- Reset auf Remote-Stand ( hart, falls lokale changes da sind ) ---
if ! git reset --hard "$REMOTE/$BRANCH" >>"$LOG_FILE" 2>&1; then
    log "ERROR: git reset fehlgeschlagen"
    exit 1
fi

# --- Container neu bauen + starten ---
log "docker compose build..."
if ! docker compose -f "$COMPOSE_FILE" build >>"$LOG_FILE" 2>&1; then
    log "ERROR: docker compose build fehlgeschlagen"
    exit 1
fi

log "docker compose up -d..."
if ! docker compose -f "$COMPOSE_FILE" up -d >>"$LOG_FILE" 2>&1; then
    log "ERROR: docker compose up fehlgeschlagen"
    exit 1
fi

# --- Aufräumen (alte Images) ---
docker image prune -f >>"$LOG_FILE" 2>&1 || true

log "==== Deploy fertig ===="
