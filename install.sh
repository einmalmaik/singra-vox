#!/usr/bin/env bash
# =============================================================================
#   Singra Vox – Self-Hosted Installer
#   Works on any Linux VPS (Hetzner, Netcup, Contabo, Ionos, etc.)
#   Just run:  bash install.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
DATA_DIR="/opt/singravox"
COMPOSE_BIN=""

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}  →${RESET} $*"; }
success() { echo -e "${GREEN}  ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}  !${RESET} $*"; }
error()   { echo -e "${RED}  ✗${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }
divider() { echo -e "${CYAN}────────────────────────────────────────────${RESET}"; }

banner() {
  echo ""
  echo -e "${BOLD}${CYAN}"
  echo "   ███████╗██╗███╗   ██╗ ██████╗ ██████╗  █████╗     ██╗   ██╗ ██████╗ ██╗  ██╗"
  echo "   ██╔════╝██║████╗  ██║██╔════╝ ██╔══██╗██╔══██╗    ██║   ██║██╔═══██╗╚██╗██╔╝"
  echo "   ███████╗██║██╔██╗ ██║██║  ███╗██████╔╝███████║    ██║   ██║██║   ██║ ╚███╔╝ "
  echo "   ╚════██║██║██║╚██╗██║██║   ██║██╔══██╗██╔══██║    ╚██╗ ██╔╝██║   ██║ ██╔██╗ "
  echo "   ███████║██║██║ ╚████║╚██████╔╝██║  ██║██║  ██║     ╚████╔╝ ╚██████╔╝██╔╝ ██╗"
  echo "   ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═══╝   ╚═════╝ ╚═╝  ╚═╝"
  echo -e "${RESET}"
  echo -e "${BOLD}   Self-Hosted Encrypted Chat — Easy Install${RESET}"
  divider
  echo ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────
ask() {
  local label="$1" default="${2:-}" result=""
  if [[ -n "$default" ]]; then
    printf "  ${BOLD}%s${RESET} [%s]: " "$label" "$default"
  else
    printf "  ${BOLD}%s${RESET}: " "$label"
  fi
  read -r result
  echo "${result:-$default}"
}

ask_secret() {
  local label="$1" result=""
  printf "  ${BOLD}%s${RESET}: " "$label"
  read -rs result; echo ""
  echo "$result"
}

ask_yes_no() {
  local label="$1" default="${2:-n}" result=""
  printf "  ${BOLD}%s${RESET} (j/n) [%s]: " "$label" "$default"
  read -r result
  result="${result:-$default}"
  [[ "${result,,}" =~ ^(j|y|ja|yes)$ ]]
}

gen_secret() { openssl rand -hex 32; }

get_public_ip() {
  local ip=""
  ip="$(curl -4 --silent --max-time 3 https://api.ipify.org 2>/dev/null)" \
    || ip="$(curl -4 --silent --max-time 3 https://ifconfig.me 2>/dev/null)" \
    || ip="$(hostname -I 2>/dev/null | awk '{print $1}')" \
    || ip="127.0.0.1"
  echo "$ip"
}

spinner() {
  local pid=$1 msg="$2" i=0
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET}  %s  " "${frames[$((i % 10))]}" "$msg"
    sleep 0.08; (( i++ ))
  done
  printf "\r  ${GREEN}✓${RESET}  %-50s\n" "$msg"
}

wait_for_api() {
  local url="$1" max_seconds=120 elapsed=0
  info "Warte auf API ($url)…"
  while ! curl -s --max-time 3 "$url" >/dev/null 2>&1; do
    sleep 3; elapsed=$(( elapsed + 3 ))
    if (( elapsed >= max_seconds )); then
      error "API antwortet nicht nach ${max_seconds}s."
      error "Logs prüfen:  $COMPOSE_BIN logs backend"
      exit 1
    fi
    printf "."
  done
  echo ""
  success "API ist bereit"
}

# ── Docker ────────────────────────────────────────────────────────────────────
ensure_docker() {
  if ! command -v docker &>/dev/null; then
    warn "Docker nicht gefunden. Installiere Docker…"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    success "Docker installiert"
  else
    success "Docker gefunden: $(docker --version | cut -d' ' -f3 | tr -d ',')"
  fi

  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_BIN="docker-compose"
  else
    warn "Docker Compose Plugin nicht gefunden. Installiere…"
    PLUGIN_DIR="$HOME/.docker/cli-plugins"
    mkdir -p "$PLUGIN_DIR"
    ARCH="$(uname -m)"; [[ "$ARCH" == "x86_64" ]] && ARCH="x86_64" || ARCH="aarch64"
    COMPOSE_URL="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}"
    curl -SL "$COMPOSE_URL" -o "$PLUGIN_DIR/docker-compose"
    chmod +x "$PLUGIN_DIR/docker-compose"
    COMPOSE_BIN="docker compose"
    success "Docker Compose installiert"
  fi
}

# ── VAPID Keys ────────────────────────────────────────────────────────────────
generate_vapid() {
  python3 -c "
import base64, os
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
pk = ec.generate_private_key(ec.SECP256R1())
priv = pk.private_numbers().private_value.to_bytes(32,'big')
pub  = pk.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
b64 = lambda d: base64.urlsafe_b64encode(d).decode().rstrip('=')
print(b64(priv) + ' ' + b64(pub))
" 2>/dev/null || echo "placeholder_private placeholder_public"
}

# ── Write config files ────────────────────────────────────────────────────────
write_env() {
  local mode="$1"
  local frontend_url="$2"  cors_origins="$3"
  local cookie_secure="$4"
  local livekit_internal="$5"  livekit_public="$6"
  local livekit_key="$7"  livekit_secret="$8"
  local domain="$9"  rtc_domain="${10}"
  local smtp_host="${11}"  smtp_port="${12}"
  local smtp_user="${13}"  smtp_pass="${14}"
  local smtp_tls="${15}"  smtp_ssl="${16}"  smtp_from="${17}"
  local vapid_private="${18}"  vapid_public="${19}"  vapid_email="${20}"
  local s3_key="${21}"  s3_secret="${22}"
  local jwt_secret; jwt_secret="$(gen_secret)"

  mkdir -p "$DATA_DIR"
  cat > "$DATA_DIR/.env" <<EOF
DB_NAME=singravox
JWT_SECRET=$jwt_secret
COOKIE_SECURE=$cookie_secure
FRONTEND_URL=$frontend_url
CORS_ORIGINS=$cors_origins
LIVEKIT_URL=$livekit_internal
LIVEKIT_PUBLIC_URL=$livekit_public
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
DOMAIN=$domain
RTC_DOMAIN=$rtc_domain
SMTP_HOST=$smtp_host
SMTP_PORT=$smtp_port
SMTP_USERNAME=$smtp_user
SMTP_PASSWORD=$smtp_pass
SMTP_FROM_EMAIL=$smtp_from
SMTP_FROM_NAME=Singra Vox
SMTP_USE_TLS=$smtp_tls
SMTP_USE_SSL=$smtp_ssl
EMAIL_VERIFICATION_TTL_MINUTES=15
PASSWORD_RESET_TTL_MINUTES=15
VAPID_PRIVATE_KEY=$vapid_private
VAPID_PUBLIC_KEY=$vapid_public
VAPID_EMAIL=$vapid_email
S3_ACCESS_KEY=$s3_key
S3_SECRET_KEY=$s3_secret
S3_BUCKET=singravox-e2ee
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
MAX_E2EE_BLOB_BYTES=52428800
EOF
  chmod 600 "$DATA_DIR/.env"
}

write_livekit_config() {
  local key="$1" secret="$2"
  cat > "$DATA_DIR/livekit.yaml" <<EOF
port: 7880
bind_addresses:
  - 0.0.0.0
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
keys:
  $key: $secret
logging:
  level: info
EOF
}

write_caddy_config() {
  local domain="$1" rtc_domain="$2"
  cat > "$DATA_DIR/Caddyfile" <<EOF
$domain {
    encode gzip

    handle /api/* {
        reverse_proxy backend:8001 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }

    handle {
        reverse_proxy frontend:80
    }
}

$rtc_domain {
    reverse_proxy livekit:7880 {
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
    }
}
EOF
}

write_docker_compose_quickstart() {
  local http_port="$1"
  cat > "$DATA_DIR/docker-compose.yml" <<'COMPOSE_EOF'
services:
  mongodb:
    image: mongo:7
    container_name: singravox-db
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    image: ghcr.io/singra-vox/backend:latest
    build:
      context: .
      dockerfile: backend.Dockerfile
    container_name: singravox-backend
    restart: unless-stopped
    depends_on:
      mongodb:
        condition: service_healthy
      minio:
        condition: service_started
    env_file: .env
    environment:
      MONGO_URL: "mongodb://mongodb:27017"
      S3_ENDPOINT_URL: "http://minio:9000"
    volumes:
      - uploads_data:/app/storage/uploads
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')"]
      interval: 15s
      timeout: 5s
      retries: 5

  frontend:
    image: ghcr.io/singra-vox/frontend:latest
    build:
      context: .
      dockerfile: frontend.Dockerfile
    container_name: singravox-web
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy

  livekit:
    image: livekit/livekit-server:v1.8
    container_name: singravox-livekit
    restart: unless-stopped
    command: ["--config", "/etc/livekit.yaml"]
    ports:
      - "7880:7880"
      - "7881:7881/tcp"
      - "7882:7882/udp"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro

  minio:
    image: minio/minio:latest
    container_name: singravox-minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: "${S3_ACCESS_KEY}"
      MINIO_ROOT_PASSWORD: "${S3_SECRET_KEY}"
    volumes:
      - minio_data:/data

  mailpit:
    image: axllent/mailpit:latest
    container_name: singravox-mailpit
    restart: unless-stopped

  proxy:
    image: nginx:1.25-alpine
    container_name: singravox-proxy
    restart: unless-stopped
    ports:
      - "HTTP_PORT_PLACEHOLDER:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - backend
      - frontend

volumes:
  mongo_data:
  minio_data:
  uploads_data:
COMPOSE_EOF

  # Replace placeholder with actual port
  sed -i "s/HTTP_PORT_PLACEHOLDER/$http_port/" "$DATA_DIR/docker-compose.yml"
}

write_docker_compose_production() {
  cat > "$DATA_DIR/docker-compose.yml" <<'COMPOSE_EOF'
services:
  mongodb:
    image: mongo:7
    container_name: singravox-db
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    image: ghcr.io/singra-vox/backend:latest
    build:
      context: .
      dockerfile: backend.Dockerfile
    container_name: singravox-backend
    restart: unless-stopped
    depends_on:
      mongodb:
        condition: service_healthy
      minio:
        condition: service_started
    env_file: .env
    environment:
      MONGO_URL: "mongodb://mongodb:27017"
      S3_ENDPOINT_URL: "http://minio:9000"
    volumes:
      - uploads_data:/app/storage/uploads
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')"]
      interval: 15s
      timeout: 5s
      retries: 5

  frontend:
    image: ghcr.io/singra-vox/frontend:latest
    build:
      context: .
      dockerfile: frontend.Dockerfile
    container_name: singravox-web
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy

  livekit:
    image: livekit/livekit-server:v1.8
    container_name: singravox-livekit
    restart: unless-stopped
    command: ["--config", "/etc/livekit.yaml"]
    ports:
      - "7880:7880"
      - "7881:7881/tcp"
      - "7882:7882/udp"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro

  minio:
    image: minio/minio:latest
    container_name: singravox-minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: "${S3_ACCESS_KEY}"
      MINIO_ROOT_PASSWORD: "${S3_SECRET_KEY}"
    volumes:
      - minio_data:/data

  caddy:
    image: caddy:2-alpine
    container_name: singravox-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - backend
      - frontend
      - livekit

volumes:
  mongo_data:
  minio_data:
  uploads_data:
  caddy_data:
  caddy_config:
COMPOSE_EOF
}

write_nginx_conf() {
  cat > "$DATA_DIR/nginx.conf" <<'NGINX_EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 100M;
    resolver 127.0.0.11 ipv6=off valid=30s;

    location /api/ {
        set $backend http://backend:8001;
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        set $frontend http://frontend:80;
        proxy_pass $frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX_EOF
}

# ── Copy source files for Docker build ───────────────────────────────────────
prepare_build_context() {
  info "Kopiere Quellcode nach $DATA_DIR…"

  mkdir -p "$DATA_DIR/backend_src" "$DATA_DIR/frontend_src"

  # Copy source files (exclude git, node_modules, .env files)
  rsync -a --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.env' --exclude='storage/' \
    "$REPO_DIR/backend/" "$DATA_DIR/backend_src/" 2>/dev/null \
    || cp -r "$REPO_DIR/backend/." "$DATA_DIR/backend_src/"

  rsync -a --exclude='.git' --exclude='node_modules' --exclude='build' \
    --exclude='.env' \
    "$REPO_DIR/frontend/" "$DATA_DIR/frontend_src/" 2>/dev/null \
    || cp -r "$REPO_DIR/frontend/." "$DATA_DIR/frontend_src/"

  # Write Dockerfiles that use the copied source dirs
  cat > "$DATA_DIR/backend.Dockerfile" <<'DOCKERFILE_EOF'
FROM python:3.11-slim
LABEL maintainer="Singra Vox"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libffi-dev && rm -rf /var/lib/apt/lists/*
COPY backend_src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend_src/ .
RUN useradd -m -r singravox && mkdir -p /app/storage/uploads && chown -R singravox:singravox /app
USER singravox
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/health')"
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
DOCKERFILE_EOF

  cat > "$DATA_DIR/frontend.Dockerfile" <<'DOCKERFILE_EOF'
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend_src/package.json frontend_src/yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile
COPY frontend_src/ .
RUN yarn build

FROM nginx:1.25-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY frontend_src/nginx.default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
DOCKERFILE_EOF

  success "Build-Kontext vorbereitet"
}

# ── Bootstrap admin account ───────────────────────────────────────────────────
bootstrap_admin() {
  local api_url="$1"
  local instance_name="$2"
  local admin_email="$3"
  local admin_user="$4"
  local admin_pass="$5"
  local admin_display="$6"
  local allow_signup="$7"

  info "Erstelle Admin-Account…"

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "$api_url/api/setup/bootstrap" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json, sys
print(json.dumps({
  'instance_name': '$instance_name',
  'owner_email': '$admin_email',
  'owner_username': '$admin_user',
  'owner_password': '$admin_pass',
  'owner_display_name': '$admin_display',
  'allow_open_signup': $allow_signup
}))
")" 2>&1)

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [[ "$http_code" == "200" ]]; then
    success "Admin-Account erstellt: $admin_email"
    return 0
  elif [[ "$http_code" == "409" ]]; then
    warn "Instanz bereits eingerichtet (Admin existiert schon)"
    return 0
  else
    warn "Bootstrap-Fehler (HTTP $http_code): Bitte manuell unter /setup einrichten"
    warn "Antwort: $body"
    return 1
  fi
}

# ── SMTP Configuration ────────────────────────────────────────────────────────
configure_smtp() {
  echo ""
  header "E-Mail Konfiguration"
  echo "  Singra Vox benötigt E-Mail für Registrierungsbestätigung."
  echo ""
  echo "  ${BOLD}1)${RESET} Eingebaut (Mailpit) — Alle E-Mails im Browser sichtbar"
  echo "     Empfohlen für Tests und private Server"
  echo "  ${BOLD}2)${RESET} Extern (Gmail, Mailgun, etc.) — Echte E-Mails"
  echo "     Empfohlen für öffentliche Server"
  echo ""

  local choice; choice=$(ask "Wahl" "1")

  if [[ "$choice" == "2" ]]; then
    echo ""
    local smtp_host smtp_port smtp_user smtp_pass smtp_from smtp_tls smtp_ssl
    smtp_host=$(ask "SMTP Server (z.B. smtp.gmail.com)" "")
    smtp_port=$(ask "SMTP Port" "587")
    smtp_user=$(ask "SMTP Benutzername / E-Mail" "")
    smtp_pass=$(ask_secret "SMTP Passwort")
    smtp_from=$(ask "Absender E-Mail" "$smtp_user")
    smtp_tls="true"; smtp_ssl="false"
    if [[ "$smtp_port" == "465" ]]; then smtp_ssl="true"; smtp_tls="false"; fi
    echo "$smtp_host|$smtp_port|$smtp_user|$smtp_pass|$smtp_from|$smtp_tls|$smtp_ssl"
  else
    # Built-in Mailpit
    echo "mailpit|1025|||no-reply@singravox.local|false|false"
  fi
}

# ── Update Mode ───────────────────────────────────────────────────────────────
run_update() {
  banner
  header "Singra Vox aktualisieren"

  if [[ ! -d "$DATA_DIR" ]]; then
    error "Keine bestehende Installation gefunden in $DATA_DIR"
    error "Starte zuerst die Erstinstallation: bash install.sh"
    exit 1
  fi

  if [[ ! -f "$DATA_DIR/.env" ]]; then
    error "Keine .env-Datei gefunden. Bitte erneut installieren."
    exit 1
  fi

  info "Bestehende Installation gefunden: $DATA_DIR"
  info "Konfiguration (.env) wird beibehalten – alle Einstellungen bleiben erhalten."
  echo ""

  # Detect compose binary
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_BIN="docker-compose"
  else
    error "Docker Compose nicht gefunden."
    exit 1
  fi

  # Determine which compose file is in use
  local compose_file="docker-compose.yml"
  if [[ -f "$DATA_DIR/Caddyfile" ]]; then
    info "Produktions-Setup erkannt (Caddy/HTTPS)"
    compose_file="docker-compose.yml"
  else
    info "Quickstart-Setup erkannt (HTTP)"
  fi

  # Pull latest source (if git repo)
  if [[ -d "$REPO_DIR/.git" ]]; then
    info "Lade neuesten Code von GitHub…"
    cd "$REPO_DIR"
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null \
      || warn "git pull fehlgeschlagen. Fahre mit lokalem Code fort."
    success "Code aktuell"
  fi

  # Re-prepare build context with updated source
  prepare_build_context

  # Rebuild images
  info "Baue neue Docker-Images…"
  cd "$DATA_DIR"
  $COMPOSE_BIN build --quiet 2>&1 | tail -3 || true
  success "Images gebaut"

  # Rolling restart (backend first, then frontend)
  info "Starte Dienste neu…"
  $COMPOSE_BIN up -d --no-deps backend 2>&1 | tail -3 || true
  sleep 3
  $COMPOSE_BIN up -d --no-deps frontend 2>&1 | tail -3 || true

  # Ensure all services running
  $COMPOSE_BIN up -d 2>&1 | tail -5

  echo ""
  success "Update abgeschlossen! Alle bestehenden Sessions bleiben aktiv."
  echo ""
  local frontend_url
  frontend_url=$(grep "^FRONTEND_URL=" "$DATA_DIR/.env" | cut -d'=' -f2)
  if [[ -n "$frontend_url" ]]; then
    echo -e "  App: ${BOLD}$frontend_url${RESET}"
  fi
  echo ""
  divider
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  # ── Update-Flag erkennen ─────────────────────────────────────────────────────
  for arg in "$@"; do
    if [[ "$arg" == "--update" || "$arg" == "update" ]]; then
      run_update
      return
    fi
  done
  banner

  # ── OS Check ────────────────────────────────────────────────────────────────
  if [[ "$(uname -s)" != "Linux" ]]; then
    error "Dieser Installer unterstützt nur Linux."
    exit 1
  fi

  if [[ "$EUID" -ne 0 ]] && ! groups | grep -q docker 2>/dev/null; then
    warn "Nicht root und nicht in der Docker-Gruppe. Einige Befehle könnten sudo benötigen."
  fi

  # ── Mode Selection ───────────────────────────────────────────────────────────
  header "Installations-Modus"
  echo ""
  echo "  ${BOLD}1) Schnellstart${RESET}  — HTTP, über IP oder Domain erreichbar"
  echo "     Ideal für: Tests, privates Netzwerk, eigene Subdomain"
  echo ""
  echo "  ${BOLD}2) Produktiv${RESET}     — HTTPS mit automatischem SSL-Zertifikat (Let's Encrypt)"
  echo "     Ideal für: Öffentlicher Server, Hetzner/Netcup/Contabo VPS"
  echo "     Voraussetzung: Domain zeigt auf diesen Server (Port 80+443 offen)"
  echo ""
  local mode; mode=$(ask "Modus wählen" "1")

  # ── Instance Name ─────────────────────────────────────────────────────────
  echo ""
  header "Server-Name"
  local instance_name; instance_name=$(ask "Name deiner Singra-Vox-Instanz" "Mein Singra Vox")

  # ── Admin Account ─────────────────────────────────────────────────────────
  echo ""
  header "Admin-Account"
  echo "  Dieser Account wird der erste Administrator deiner Instanz."
  echo ""
  local admin_email; admin_email=$(ask "Admin E-Mail" "admin@example.com")
  local admin_user;  admin_user=$(ask "Admin Benutzername (3-32 Zeichen, a-z 0-9 _)" "admin")
  local admin_pass;  admin_pass=$(ask_secret "Admin Passwort (min. 8 Zeichen)")
  if [[ ${#admin_pass} -lt 8 ]]; then
    error "Passwort zu kurz (min. 8 Zeichen)"; exit 1
  fi
  local admin_display; admin_display=$(ask "Anzeigename" "Admin")

  # ── Open Signup ───────────────────────────────────────────────────────────
  echo ""
  local allow_signup="true"
  if ask_yes_no "Soll sich jeder selbst registrieren dürfen?" "j"; then
    allow_signup="true"
  else
    allow_signup="false"
    info "Nur der Admin kann weitere Accounts anlegen (Einladungs-Links)"
  fi

  # ── Mode-specific config ──────────────────────────────────────────────────
  local frontend_url cors_origins cookie_secure
  local livekit_internal livekit_public
  local domain rtc_domain http_port api_url compose_flag

  if [[ "$mode" == "2" ]]; then
    # ── Production mode ───────────────────────────────────────────────────
    echo ""
    header "Domain-Konfiguration"
    echo "  Stelle sicher, dass deine Domain auf die IP dieses Servers zeigt."
    echo ""
    domain=$(ask "Haupt-Domain (z.B. chat.example.com)" "")
    if [[ -z "$domain" ]]; then error "Domain darf nicht leer sein."; exit 1; fi
    rtc_domain=$(ask "Voice-Domain (z.B. rtc.example.com)" "rtc.${domain#*.}")

    frontend_url="https://$domain"
    cors_origins="https://$domain,tauri://localhost,http://tauri.localhost"
    cookie_secure="true"
    livekit_internal="ws://livekit:7880"
    livekit_public="wss://$rtc_domain"
    api_url="https://$domain"
    compose_flag="production"
    http_port="443"
  else
    # ── Quickstart mode ───────────────────────────────────────────────────
    echo ""
    header "Netzwerk-Konfiguration"
    local public_ip; public_ip=$(get_public_ip)
    info "Erkannte öffentliche IP: $public_ip"

    local public_host; public_host=$(ask "Öffentliche IP oder Domain" "$public_ip")
    http_port=$(ask "HTTP Port" "8080")
    domain="$public_host"
    rtc_domain="$public_host"

    frontend_url="http://$public_host:$http_port"
    cors_origins="$frontend_url,http://localhost:$http_port,http://127.0.0.1:$http_port,tauri://localhost,http://tauri.localhost"
    cookie_secure="false"
    livekit_internal="ws://livekit:7880"
    livekit_public="ws://$public_host:7880"
    api_url="http://localhost:$http_port"
    compose_flag="quickstart"
  fi

  # ── SMTP ─────────────────────────────────────────────────────────────────
  local smtp_config; smtp_config=$(configure_smtp)
  IFS='|' read -r smtp_host smtp_port smtp_user smtp_pass smtp_from smtp_tls smtp_ssl <<< "$smtp_config"
  local smtp_builtin=false
  [[ "$smtp_host" == "mailpit" ]] && smtp_builtin=true

  # ── Generate secrets ──────────────────────────────────────────────────────
  echo ""
  header "Konfiguration wird erstellt…"
  info "Generiere Schlüssel…"

  local livekit_key="lk$(openssl rand -hex 6)"
  local livekit_secret; livekit_secret="$(gen_secret)"
  local s3_key="singravox"
  local s3_secret; s3_secret="$(gen_secret | head -c 32)"
  local vapid_keys; vapid_keys="$(generate_vapid)"
  local vapid_private; vapid_private="$(echo "$vapid_keys" | cut -d' ' -f1)"
  local vapid_public;  vapid_public="$(echo "$vapid_keys" | cut -d' ' -f2)"

  # ── Ensure Docker ─────────────────────────────────────────────────────────
  echo ""
  header "System-Vorbereitung"
  ensure_docker
  mkdir -p "$DATA_DIR"

  # ── Write configs ─────────────────────────────────────────────────────────
  write_env \
    "$compose_flag" "$frontend_url" "$cors_origins" "$cookie_secure" \
    "$livekit_internal" "$livekit_public" "$livekit_key" "$livekit_secret" \
    "$domain" "$rtc_domain" \
    "$smtp_host" "$smtp_port" "$smtp_user" "$smtp_pass" "$smtp_tls" "$smtp_ssl" "$smtp_from" \
    "$vapid_private" "$vapid_public" "${admin_email}" \
    "$s3_key" "$s3_secret"

  write_livekit_config "$livekit_key" "$livekit_secret"

  if [[ "$compose_flag" == "production" ]]; then
    write_caddy_config "$domain" "$rtc_domain"
    write_docker_compose_production
  else
    write_nginx_conf
    write_docker_compose_quickstart "$http_port"
  fi

  success "Konfiguration erstellt in $DATA_DIR"

  # ── Build / Pull images ───────────────────────────────────────────────────
  echo ""
  header "Docker Images"
  prepare_build_context

  info "Baue Images (das kann 2-5 Minuten dauern)…"
  cd "$DATA_DIR"
  $COMPOSE_BIN build --quiet 2>&1 | tail -5 || true
  success "Images fertig"

  # ── Start services ─────────────────────────────────────────────────────────
  echo ""
  header "Dienste starten"
  info "Starte alle Dienste…"
  cd "$DATA_DIR"
  $COMPOSE_BIN up -d
  success "Dienste gestartet"

  # ── Wait for API ─────────────────────────────────────────────────────────
  echo ""
  sleep 5
  wait_for_api "$api_url/api/setup/status"

  # ── Bootstrap admin ───────────────────────────────────────────────────────
  echo ""
  header "Admin-Account einrichten"
  bootstrap_admin \
    "$api_url" "$instance_name" \
    "$admin_email" "$admin_user" "$admin_pass" "$admin_display" \
    "$allow_signup"

  # ── Done! ─────────────────────────────────────────────────────────────────
  echo ""
  divider
  echo ""
  echo -e "${BOLD}${GREEN}  Singra Vox läuft!${RESET}"
  echo ""
  echo -e "  ${BOLD}App öffnen:${RESET}      $frontend_url"
  echo -e "  ${BOLD}Admin-Login:${RESET}     $admin_email"
  echo -e "  ${BOLD}Voice (LiveKit):${RESET} $livekit_public"

  if $smtp_builtin; then
    if [[ "$compose_flag" == "quickstart" ]]; then
      echo -e "  ${BOLD}Mail-Postfach:${RESET}   http://${public_host:-localhost}:8025"
    fi
    warn "SMTP: Eingebautes Mailpit aktiv. E-Mails sind NICHT nach außen sichtbar."
    warn "Für echte E-Mails: .env in $DATA_DIR bearbeiten und SMTP_HOST ändern."
  fi

  echo ""
  echo -e "  ${BOLD}Nächste Schritte:${RESET}"
  echo "  1. App öffnen und einloggen"
  echo "  2. Ersten Server erstellen"
  echo "  3. Freunde per Einladungs-Link einladen"
  echo ""
  echo -e "  ${BOLD}Updates:${RESET}"
  echo "  bash install.sh --update   # Auf neuste Version aktualisieren"
  echo "  (Deine Konfiguration + Daten bleiben dabei vollständig erhalten)"
  echo ""
  echo -e "  ${CYAN}Befehle:${RESET}"
  echo "  cd $DATA_DIR"
  echo "  $COMPOSE_BIN logs -f           # Live-Logs"
  echo "  $COMPOSE_BIN restart backend   # Backend neu starten"
  echo "  $COMPOSE_BIN down              # Alles stoppen"
  echo "  $COMPOSE_BIN up -d             # Alles starten"
  echo ""
  divider
}

main "$@"
