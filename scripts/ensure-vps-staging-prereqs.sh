#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/ensure-vps-staging-prereqs.sh \
    --deploy-dir /srv/openmirage \
    --public-base-url https://staging.example.com \
    [--deploy-user deploy] \
    [--ssh-public-key "ssh-ed25519 AAAA... comment"] \
    [--ssh-public-key-file /path/to/public_key.pub] \
    [--force]

Environment fallbacks:
  VPS_DEPLOY_DIR
  STAGING_PUBLIC_BASE_URL
  VPS_USER
  VPS_SSH_PUBLIC_KEY
  VPS_SSH_PUBLIC_KEY_FILE
  SESSION_COOKIE_NAME
  SESSION_COOKIE_PATH
  SESSION_COOKIE_SAME_SITE
  ENABLE_TEST_ERROR_ROUTES
  SENTRY_DSN
  SENTRY_ENVIRONMENT
  SENTRY_RELEASE

Behavior:
  - Verifies Docker CLI, Docker Compose, and Docker daemon access
  - Ensures the deploy user exists
  - Ensures the deploy user's ~/.ssh and authorized_keys exist when a public key is provided
  - Ensures the deploy directory and docker/ subdirectory exist
  - Ensures .env.staging exists at the deploy root
  - Fills missing staging env keys; preserves existing values unless --force is used
EOF
}

log() {
  printf '[openmirage] %s\n' "$*"
}

fail() {
  printf '[openmirage] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

trim_trailing_slash() {
  printf '%s' "${1%/}"
}

get_user_home() {
  local user="$1"
  getent passwd "$user" | awk -F: '{print $6}'
}

upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')

  if grep -Eq "^${key}=" "$file"; then
    if [ "${FORCE_UPDATE_ENV}" = "true" ]; then
      sed -i.bak -E "s|^${key}=.*$|${key}=${escaped}|" "$file"
      rm -f "${file}.bak"
    fi
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

ensure_directory() {
  local path="$1"
  local owner="$2"

  mkdir -p "$path"
  chmod 755 "$path"

  if is_root; then
    chown "$owner":"$owner" "$path"
  fi
}

ensure_file_permissions() {
  local path="$1"
  local owner="$2"
  local mode="$3"

  chmod "$mode" "$path"
  if is_root; then
    chown "$owner":"$owner" "$path"
  fi
}

DEPLOY_DIR="${VPS_DEPLOY_DIR:-}"
PUBLIC_BASE_URL="${STAGING_PUBLIC_BASE_URL:-}"
DEPLOY_USER="${VPS_USER:-deploy}"
SSH_PUBLIC_KEY="${VPS_SSH_PUBLIC_KEY:-}"
SSH_PUBLIC_KEY_FILE="${VPS_SSH_PUBLIC_KEY_FILE:-}"
FORCE_UPDATE_ENV="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --deploy-dir)
      DEPLOY_DIR="$2"
      shift 2
      ;;
    --public-base-url)
      PUBLIC_BASE_URL="$2"
      shift 2
      ;;
    --deploy-user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    --ssh-public-key)
      SSH_PUBLIC_KEY="$2"
      shift 2
      ;;
    --ssh-public-key-file)
      SSH_PUBLIC_KEY_FILE="$2"
      shift 2
      ;;
    --force)
      FORCE_UPDATE_ENV="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ -n "$DEPLOY_DIR" ] || fail "missing deploy directory; set --deploy-dir or VPS_DEPLOY_DIR"
[ -n "$PUBLIC_BASE_URL" ] || fail "missing public base URL; set --public-base-url or STAGING_PUBLIC_BASE_URL"

DEPLOY_DIR="$(trim_trailing_slash "$DEPLOY_DIR")"

case "$PUBLIC_BASE_URL" in
  https://*) ;;
  *)
    fail "public base URL must start with https://"
    ;;
esac

require_command docker

log "verifying docker cli"
docker --version >/dev/null

log "verifying docker compose"
docker compose version >/dev/null

log "verifying docker daemon access"
docker info >/dev/null

id "$DEPLOY_USER" >/dev/null 2>&1 || fail "deploy user does not exist: $DEPLOY_USER"
DEPLOY_HOME="$(get_user_home "$DEPLOY_USER")"
[ -n "$DEPLOY_HOME" ] || fail "could not determine home directory for $DEPLOY_USER"

log "deploy user: $DEPLOY_USER"
log "deploy home: $DEPLOY_HOME"
log "deploy dir: $DEPLOY_DIR"

if [ -n "$SSH_PUBLIC_KEY_FILE" ]; then
  [ -f "$SSH_PUBLIC_KEY_FILE" ] || fail "ssh public key file does not exist: $SSH_PUBLIC_KEY_FILE"
  SSH_PUBLIC_KEY="$(cat "$SSH_PUBLIC_KEY_FILE")"
fi

if [ -n "$SSH_PUBLIC_KEY" ]; then
  log "ensuring ssh directory and authorized_keys for $DEPLOY_USER"
  ensure_directory "$DEPLOY_HOME/.ssh" "$DEPLOY_USER"
  touch "$DEPLOY_HOME/.ssh/authorized_keys"
  ensure_file_permissions "$DEPLOY_HOME/.ssh/authorized_keys" "$DEPLOY_USER" 600

  if ! grep -Fqx "$SSH_PUBLIC_KEY" "$DEPLOY_HOME/.ssh/authorized_keys"; then
    printf '%s\n' "$SSH_PUBLIC_KEY" >>"$DEPLOY_HOME/.ssh/authorized_keys"
    ensure_file_permissions "$DEPLOY_HOME/.ssh/authorized_keys" "$DEPLOY_USER" 600
    log "added ssh public key to $DEPLOY_HOME/.ssh/authorized_keys"
  else
    log "ssh public key already present in authorized_keys"
  fi
else
  log "no ssh public key provided; skipping authorized_keys management"
fi

log "ensuring deploy directory layout"
ensure_directory "$DEPLOY_DIR" "$DEPLOY_USER"
ensure_directory "$DEPLOY_DIR/docker" "$DEPLOY_USER"

ENV_FILE="$DEPLOY_DIR/.env.staging"
HOST_ONLY="${PUBLIC_BASE_URL#https://}"
HOST_ONLY="${HOST_ONLY%%/*}"
SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-openmirage_session}"
SESSION_COOKIE_PATH="${SESSION_COOKIE_PATH:-/}"
SESSION_COOKIE_SAME_SITE="${SESSION_COOKIE_SAME_SITE:-lax}"
ENABLE_TEST_ERROR_ROUTES="${ENABLE_TEST_ERROR_ROUTES:-false}"
SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-staging}"
SENTRY_RELEASE="${SENTRY_RELEASE:-0.1.0}"

if [ ! -f "$ENV_FILE" ]; then
  log "creating $ENV_FILE"
  : >"$ENV_FILE"
  ensure_file_permissions "$ENV_FILE" "$DEPLOY_USER" 600
else
  log "updating missing keys in $ENV_FILE"
fi

upsert_env_key "$ENV_FILE" "OPENMIRAGE_ENV" "staging"
upsert_env_key "$ENV_FILE" "CADDY_SITE_ADDRESS" "$HOST_ONLY"
upsert_env_key "$ENV_FILE" "APP_BASE_URL" "$PUBLIC_BASE_URL"
upsert_env_key "$ENV_FILE" "OPENMIRAGE_PUBLIC_BASE_URL" "$PUBLIC_BASE_URL"
upsert_env_key "$ENV_FILE" "OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL" "$PUBLIC_BASE_URL/collab"
upsert_env_key "$ENV_FILE" "OPENMIRAGE_PUBLIC_COLLAB_WS_URL" "wss://${HOST_ONLY}/collab"
upsert_env_key "$ENV_FILE" "OPENMIRAGE_PUBLIC_WORKER_HTTP_URL" "$PUBLIC_BASE_URL/worker"
upsert_env_key "$ENV_FILE" "AUTH_PATH" "/auth"
upsert_env_key "$ENV_FILE" "COLLAB_WS_PATH" "/collab"
upsert_env_key "$ENV_FILE" "SESSION_COOKIE_NAME" "$SESSION_COOKIE_NAME"
upsert_env_key "$ENV_FILE" "SESSION_COOKIE_PATH" "$SESSION_COOKIE_PATH"
upsert_env_key "$ENV_FILE" "SESSION_COOKIE_SAME_SITE" "$SESSION_COOKIE_SAME_SITE"
upsert_env_key "$ENV_FILE" "SESSION_COOKIE_SECURE" "true"
upsert_env_key "$ENV_FILE" "CADDY_HTTP_PORT" "80"
upsert_env_key "$ENV_FILE" "CADDY_HTTPS_PORT" "443"
upsert_env_key "$ENV_FILE" "ENABLE_TEST_ERROR_ROUTES" "$ENABLE_TEST_ERROR_ROUTES"
upsert_env_key "$ENV_FILE" "SENTRY_DSN" "$SENTRY_DSN"
upsert_env_key "$ENV_FILE" "SENTRY_ENVIRONMENT" "$SENTRY_ENVIRONMENT"
upsert_env_key "$ENV_FILE" "SENTRY_RELEASE" "$SENTRY_RELEASE"

ensure_file_permissions "$ENV_FILE" "$DEPLOY_USER" 600

log "verifying resulting prerequisites"
test -d "$DEPLOY_DIR"
test -w "$DEPLOY_DIR"
test -d "$DEPLOY_DIR/docker"
test -w "$DEPLOY_DIR/docker"
test -f "$ENV_FILE"

log "rendered env summary:"
grep -E '^(OPENMIRAGE_ENV|CADDY_SITE_ADDRESS|APP_BASE_URL|OPENMIRAGE_PUBLIC_BASE_URL|OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL|OPENMIRAGE_PUBLIC_COLLAB_WS_URL|OPENMIRAGE_PUBLIC_WORKER_HTTP_URL|SESSION_COOKIE_SECURE)=' "$ENV_FILE"

log "staging VPS prerequisites are satisfied"
