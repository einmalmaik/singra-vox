#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer currently supports Linux only."
  exit 1
fi

prompt() {
  local label="$1"
  local default_value="${2:-}"
  local input=""
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " input
    echo "${input:-$default_value}"
  else
    read -r -p "$label: " input
    echo "$input"
  fi
}

generate_secret() {
  openssl rand -hex 32
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  echo "Docker or Docker Compose plugin not found."
  echo "Installing Docker using the official convenience script..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  echo "Docker installed. If the current shell still lacks Docker permissions, log out and back in once."
}

write_env() {
  local mode="$1"
  local frontend_url="$2"
  local cors_origins="$3"
  local cookie_secure="$4"
  local livekit_url="$5"
  local http_port="$6"
  local domain="$7"
  local rtc_domain="$8"
  local livekit_key="$9"
  local livekit_secret="${10}"

  cat > "$DEPLOY_DIR/.env" <<EOF
DB_NAME=singravox
JWT_SECRET=$(generate_secret)
COOKIE_SECURE=$cookie_secure
HTTP_PORT=$http_port
FRONTEND_URL=$frontend_url
CORS_ORIGINS=$cors_origins
LIVEKIT_URL=$livekit_url
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
DOMAIN=$domain
RTC_DOMAIN=$rtc_domain
EOF
}

write_livekit_config() {
  local livekit_key="$1"
  local livekit_secret="$2"

  cat > "$DEPLOY_DIR/livekit.yaml" <<EOF
port: 7880
bind_addresses:
  - 0.0.0.0

rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true

keys:
  $livekit_key: $livekit_secret
EOF
}

write_turn_config() {
  local realm="$1"
  local turn_secret="$2"

  cat > "$DEPLOY_DIR/turnserver.conf" <<EOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$turn_secret
realm=$realm
total-quota=100
bps-capacity=0
stale-nonce=600
no-cli
no-multicast-peers
EOF
}

main() {
  ensure_docker

  echo "Singra Vox installer"
  echo "1) Quickstart (HTTP, IP:Port)"
  echo "2) Production (Domain + HTTPS via Caddy)"
  local mode
  mode="$(prompt "Choose mode 1 or 2" "1")"

  local compose_file="docker-compose.yml"
  local http_port="8080"
  local frontend_url=""
  local cors_origins=""
  local cookie_secure="false"
  local livekit_url=""
  local domain="localhost"
  local rtc_domain="rtc.localhost"
  local public_host="localhost"

  if [[ "$mode" == "2" ]]; then
    compose_file="docker-compose.prod.yml"
    domain="$(prompt "Primary domain" "chat.example.com")"
    rtc_domain="$(prompt "Voice domain" "rtc.${domain#*.}")"
    frontend_url="https://$domain"
    cors_origins="https://$domain,tauri://localhost,http://tauri.localhost"
    cookie_secure="true"
    livekit_url="wss://$rtc_domain"
  else
    http_port="$(prompt "HTTP port" "8080")"
    public_host="$(prompt "Public host or IP" "localhost")"
    frontend_url="http://$public_host:$http_port"
    cors_origins="$frontend_url,http://localhost:3000,http://127.0.0.1:3000,tauri://localhost,http://tauri.localhost"
    livekit_url="ws://$public_host:7880"
  fi

  local livekit_key="lk$(openssl rand -hex 6)"
  local livekit_secret
  livekit_secret="$(generate_secret)"
  local turn_secret
  turn_secret="$(generate_secret)"

  write_env "$mode" "$frontend_url" "$cors_origins" "$cookie_secure" "$livekit_url" "$http_port" "$domain" "$rtc_domain" "$livekit_key" "$livekit_secret"
  write_livekit_config "$livekit_key" "$livekit_secret"
  write_turn_config "${domain:-singravox.local}" "$turn_secret"

  cd "$DEPLOY_DIR"
  docker compose -f "$compose_file" up -d --build

  echo
  echo "Singra Vox is starting."
  echo "Open $frontend_url/setup to create the first owner account."
  if [[ "$mode" != "2" ]]; then
    echo "Voice service: $livekit_url"
  fi
}

main "$@"

