#!/usr/bin/env bash
# Pulls the configured branch and deploys it after all repository checks pass.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/samuel/AiApi-Wrapper}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
DEPLOY_MODE="${DEPLOY_MODE:-systemd}"
LOG_FILE="${LOG_FILE:-/var/log/model-console-deploy.log}"
LOCK_FILE="${LOCK_FILE:-/var/lock/model-console-deploy.lock}"
API_SERVICE="${API_SERVICE:-model-console-api.service}"
WEB_SERVICE="${WEB_SERVICE:-model-console-web.service}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.yml}"

if [[ -n "${PNPM_BIN:-}" && -x "$PNPM_BIN" ]]; then
  :
elif command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN=$(command -v pnpm)
elif [[ -x "$HOME/.npm-global/bin/pnpm" ]]; then
  PNPM_BIN="$HOME/.npm-global/bin/pnpm"
elif [[ -x "$HOME/.local/share/pnpm/pnpm" ]]; then
  PNPM_BIN="$HOME/.local/share/pnpm/pnpm"
else
  echo "pnpm executable not found" >&2
  exit 1
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

read_env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); exit }' "$REPO_DIR/.env"
}

wait_for_health() {
  local attempts="${1:-45}"
  for _ in $(seq 1 "$attempts"); do
    if curl --fail --silent http://127.0.0.1:18789/health >/dev/null \
      && curl --fail --silent http://127.0.0.1:3000/login >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP: another deployment is already running"
  exit 0
fi

cd "$REPO_DIR"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  log "SKIP: tracked working-tree changes exist; refusing to overwrite them"
  exit 0
fi

if ! git fetch "$REMOTE" "$BRANCH" >>"$LOG_FILE" 2>&1; then
  log "ERROR: git fetch failed"
  exit 1
fi

LOCAL_SHA=$(git rev-parse "$BRANCH")
REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH")
if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  exit 0
fi

log "Deploying ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7} using ${DEPLOY_MODE}"
git switch "$BRANCH" >>"$LOG_FILE" 2>&1
git merge --ff-only "$REMOTE/$BRANCH" >>"$LOG_FILE" 2>&1

NODE_ENV=development "$PNPM_BIN" install --frozen-lockfile >>"$LOG_FILE" 2>&1
NODE_ENV=development "$PNPM_BIN" check:secrets >>"$LOG_FILE" 2>&1
NODE_ENV=development "$PNPM_BIN" typecheck >>"$LOG_FILE" 2>&1
NODE_ENV=development "$PNPM_BIN" lint >>"$LOG_FILE" 2>&1
NODE_ENV=development "$PNPM_BIN" --filter @model-console/core build >>"$LOG_FILE" 2>&1
NODE_ENV=development "$PNPM_BIN" --filter @model-console/api build >>"$LOG_FILE" 2>&1

case "$DEPLOY_MODE" in
  systemd)
    rollback_dir="$REPO_DIR/apps/web/.next.rollback"
    rm -rf "$rollback_dir"
    if [[ -d "$REPO_DIR/apps/web/.next" ]]; then
      cp -a "$REPO_DIR/apps/web/.next" "$rollback_dir"
    fi

    systemctl --user stop "$WEB_SERVICE"
    rm -rf "$REPO_DIR/apps/web/.next"

    public_api_url=$(read_env_value NEXT_PUBLIC_PUBLIC_API_URL)
    chat_url=$(read_env_value NEXT_PUBLIC_CHAT_URL)
    api_backend_url=$(read_env_value API_BACKEND_URL)
    api_backend_url=${api_backend_url:-http://127.0.0.1:18789}

    if ! NODE_ENV=production \
      NEXT_PUBLIC_PUBLIC_API_URL="$public_api_url" \
      NEXT_PUBLIC_CHAT_URL="$chat_url" \
      API_BACKEND_URL="$api_backend_url" \
      NODE_OPTIONS= \
      "$PNPM_BIN" --filter @model-console/web build >>"$LOG_FILE" 2>&1; then
      log "ERROR: web build failed; restoring previous build"
      rm -rf "$REPO_DIR/apps/web/.next"
      if [[ -d "$rollback_dir" ]]; then
        mv "$rollback_dir" "$REPO_DIR/apps/web/.next"
        systemctl --user start "$WEB_SERVICE" || true
      fi
      exit 1
    fi

    systemctl --user restart "$API_SERVICE"
    systemctl --user start "$WEB_SERVICE"

    if ! wait_for_health; then
      log "ERROR: health check failed; restoring previous web build"
      systemctl --user stop "$WEB_SERVICE" || true
      rm -rf "$REPO_DIR/apps/web/.next"
      if [[ -d "$rollback_dir" ]]; then
        mv "$rollback_dir" "$REPO_DIR/apps/web/.next"
      fi
      systemctl --user start "$WEB_SERVICE" || true
      exit 1
    fi

    rm -rf "$rollback_dir"
    ;;
  docker)
    docker compose -f "$COMPOSE_FILE" config --quiet >>"$LOG_FILE" 2>&1
    docker compose -f "$COMPOSE_FILE" build >>"$LOG_FILE" 2>&1
    docker compose -f "$COMPOSE_FILE" up -d >>"$LOG_FILE" 2>&1
    if ! wait_for_health; then
      log "ERROR: health check failed after Docker deployment"
      exit 1
    fi
    docker image prune -f >>"$LOG_FILE" 2>&1 || true
    ;;
  *)
    log "ERROR: unsupported DEPLOY_MODE=$DEPLOY_MODE"
    exit 1
    ;;
esac

log "Deployment completed at $(git rev-parse --short HEAD)"
