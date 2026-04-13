#!/bin/sh
set -eu

template_path="/opt/openmirage/runtime-config.template.js"
target_path="/usr/share/nginx/html/runtime-config.js"

export OPENMIRAGE_ENV="${OPENMIRAGE_ENV:-development}"
export WEB_PORT="${WEB_PORT:-3000}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost}"
export VITE_COLLAB_HTTP_URL="${VITE_COLLAB_HTTP_URL:-http://localhost/collab}"
export VITE_COLLAB_WS_URL="${VITE_COLLAB_WS_URL:-ws://localhost/collab}"
export VITE_COLLAB_WS_PATH="${VITE_COLLAB_WS_PATH:-/collab}"
export VITE_AUTH_PATH="${VITE_AUTH_PATH:-/auth}"
export VITE_WORKER_HTTP_URL="${VITE_WORKER_HTTP_URL:-http://localhost/worker}"

envsubst \
  '${OPENMIRAGE_ENV} ${WEB_PORT} ${VITE_API_BASE_URL} ${VITE_COLLAB_HTTP_URL} ${VITE_COLLAB_WS_URL} ${VITE_COLLAB_WS_PATH} ${VITE_AUTH_PATH} ${VITE_WORKER_HTTP_URL}' \
  < "$template_path" \
  > "$target_path"
