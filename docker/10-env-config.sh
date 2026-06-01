#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SUPABASE_URL="$(json_escape "${VITE_SUPABASE_URL:-}")"
SUPABASE_PUBLISHABLE_KEY="$(json_escape "${VITE_SUPABASE_PUBLISHABLE_KEY:-}")"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__APP_CONFIG__ = {
  VITE_SUPABASE_URL: "${SUPABASE_URL}",
  VITE_SUPABASE_PUBLISHABLE_KEY: "${SUPABASE_PUBLISHABLE_KEY}"
};
EOF
