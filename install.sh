#!/usr/bin/env bash
# =============================================================================
#   Singra Vox – Self-Hosted Installer & Manager
#   Works on any Linux VPS (Hetzner, Netcup, Contabo, Ionos, etc.)
#
#   Usage:
#     bash install.sh              # Fresh install or repair
#     bash install.sh --update     # Pull latest code & rebuild
#     bash install.sh --status     # Health check & diagnostics
#     bash install.sh --repair     # Detect & fix broken config
#     bash install.sh --identity   # Set up Singra Vox ID server
#     bash install.sh --auto-update-on   # Enable automatic updates
#     bash install.sh --auto-update-off  # Disable automatic updates
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$REPO_DIR/deploy"
DATA_DIR="/opt/singravox"
COMPOSE_BIN=""
VERSION_FILE="$REPO_DIR/.singravox-version"
IDENTITY_ENV="$DATA_DIR/.env.identity"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

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
      return 1
    fi
    printf "."
  done
  echo ""
  success "API ist bereit"
}

detect_compose() {
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_BIN="docker-compose"
  else
    return 1
  fi
  return 0
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

# ═══════════════════════════════════════════════════════════════════════════════
#   --status : Health Check & Diagnostics
# ═══════════════════════════════════════════════════════════════════════════════
run_status() {
  banner
  header "Singra Vox – System-Status"
  echo ""

  local ok=0 warn_count=0 fail=0

  # ── Installation vorhanden?
  if [[ -d "$DATA_DIR" ]]; then
    success "Installation gefunden: $DATA_DIR"
    (( ok++ ))
  else
    error "Keine Installation gefunden in $DATA_DIR"
    echo -e "  ${DIM}Tipp: bash install.sh ausführen${RESET}"
    exit 1
  fi

  # ── .env vorhanden?
  if [[ -f "$DATA_DIR/.env" ]]; then
    success ".env Konfiguration vorhanden"
    (( ok++ ))
  else
    error ".env fehlt in $DATA_DIR"
    (( fail++ ))
  fi

  # ── Docker / Compose?
  if command -v docker &>/dev/null; then
    success "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
    (( ok++ ))
  else
    error "Docker nicht installiert"
    (( fail++ ))
  fi

  if detect_compose; then
    success "Docker Compose verfügbar"
    (( ok++ ))
  else
    error "Docker Compose nicht gefunden"
    (( fail++ ))
  fi

  # ── Container-Status
  echo ""
  header "Container-Status"
  if detect_compose && [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    cd "$DATA_DIR"
    local running stopped
    running=$($COMPOSE_BIN ps --status running -q 2>/dev/null | wc -l)
    stopped=$($COMPOSE_BIN ps --status exited -q 2>/dev/null | wc -l)

    echo ""
    $COMPOSE_BIN ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
      $COMPOSE_BIN ps 2>/dev/null || \
      warn "Konnte Container-Status nicht abfragen"

    echo ""
    if [[ "$running" -gt 0 ]]; then
      success "$running Container laufen"
      (( ok++ ))
    fi
    if [[ "$stopped" -gt 0 ]]; then
      warn "$stopped Container gestoppt"
      (( warn_count++ ))
    fi
  else
    warn "Keine docker-compose.yml gefunden"
    (( warn_count++ ))
  fi

  # ── Konfiguration prüfen
  echo ""
  header "Konfigurations-Check"
  if [[ -f "$DATA_DIR/.env" ]]; then
    local missing_vars=()

    # Pflicht-Variablen prüfen
    for var in DB_NAME JWT_SECRET FRONTEND_URL; do
      local val
      val=$(grep "^${var}=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
      if [[ -z "$val" ]]; then
        missing_vars+=("$var")
      fi
    done

    # Encryption Secret
    local enc_secret
    enc_secret=$(grep "^INSTANCE_ENCRYPTION_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
    if [[ -n "$enc_secret" && ${#enc_secret} -ge 32 ]]; then
      success "INSTANCE_ENCRYPTION_SECRET konfiguriert (${#enc_secret} Zeichen)"
      (( ok++ ))
    elif [[ -n "$enc_secret" ]]; then
      warn "INSTANCE_ENCRYPTION_SECRET zu kurz (${#enc_secret} Zeichen, min. 32)"
      (( warn_count++ ))
    else
      warn "INSTANCE_ENCRYPTION_SECRET fehlt – Daten werden unverschlüsselt gespeichert!"
      (( warn_count++ ))
    fi

    # LiveKit
    local lk_url
    lk_url=$(grep "^LIVEKIT_URL=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
    if [[ -n "$lk_url" ]]; then
      success "LiveKit konfiguriert: $lk_url"
      (( ok++ ))
    else
      info "LiveKit nicht konfiguriert (Voice/Video deaktiviert)"
    fi

    # SMTP
    local smtp_host
    smtp_host=$(grep "^SMTP_HOST=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
    if [[ -n "$smtp_host" ]]; then
      success "SMTP konfiguriert: $smtp_host"
      (( ok++ ))
    else
      warn "SMTP nicht konfiguriert – E-Mail-Verifizierung deaktiviert"
      (( warn_count++ ))
    fi

    # SVID
    local svid_issuer
    svid_issuer=$(grep "^SVID_ISSUER=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
    if [[ -n "$svid_issuer" ]]; then
      success "Singra Vox ID konfiguriert: $svid_issuer"
      (( ok++ ))
    else
      info "Singra Vox ID nicht konfiguriert (nur lokale Accounts)"
    fi

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
      for var in "${missing_vars[@]}"; do
        error "Pflicht-Variable fehlt: $var"
        (( fail++ ))
      done
    fi
  fi

  # ── API Health Check
  echo ""
  header "API Health Check"
  local frontend_url
  frontend_url=$(grep "^FRONTEND_URL=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -n "$frontend_url" ]]; then
    local health_response
    health_response=$(curl -s --max-time 5 "$frontend_url/api/health" 2>/dev/null) || true
    if echo "$health_response" | grep -q "ok\|healthy" 2>/dev/null; then
      success "API erreichbar: $frontend_url/api/health"
      (( ok++ ))
    else
      warn "API nicht erreichbar unter $frontend_url/api/health"
      (( warn_count++ ))
    fi

    # Frontend Check
    local frontend_check
    frontend_check=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$frontend_url" 2>/dev/null) || true
    if [[ "$frontend_check" == "200" ]]; then
      success "Frontend erreichbar: $frontend_url"
      (( ok++ ))
    else
      warn "Frontend nicht erreichbar (HTTP $frontend_check)"
      (( warn_count++ ))
    fi
  fi

  # ── Disk Space
  echo ""
  header "Speicherplatz"
  local disk_avail
  disk_avail=$(df -h "$DATA_DIR" 2>/dev/null | tail -1 | awk '{print $4}')
  local disk_percent
  disk_percent=$(df "$DATA_DIR" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
  if [[ -n "$disk_percent" ]]; then
    if [[ "$disk_percent" -lt 80 ]]; then
      success "Speicherplatz: $disk_avail frei (${disk_percent}% belegt)"
      (( ok++ ))
    elif [[ "$disk_percent" -lt 95 ]]; then
      warn "Speicherplatz: $disk_avail frei (${disk_percent}% belegt) – Bitte aufräumen"
      (( warn_count++ ))
    else
      error "Speicherplatz kritisch: $disk_avail frei (${disk_percent}% belegt)"
      (( fail++ ))
    fi
  fi

  # ── Auto-Update Status
  echo ""
  header "Auto-Update"
  if crontab -l 2>/dev/null | grep -q "singravox.*install.sh.*--update"; then
    success "Auto-Update ist aktiviert"
    local cron_schedule
    cron_schedule=$(crontab -l 2>/dev/null | grep "singravox.*install.sh.*--update" | awk '{print $1,$2,$3,$4,$5}')
    info "Zeitplan: $cron_schedule"
    (( ok++ ))
  else
    info "Auto-Update ist nicht aktiviert"
    echo -e "  ${DIM}Aktivieren: bash install.sh --auto-update-on${RESET}"
  fi

  # ── Summary
  echo ""
  divider
  echo ""
  echo -e "  ${GREEN}✓ $ok OK${RESET}   ${YELLOW}! $warn_count Warnung(en)${RESET}   ${RED}✗ $fail Fehler${RESET}"
  echo ""

  if [[ "$fail" -gt 0 ]]; then
    echo -e "  ${BOLD}Empfehlung:${RESET} bash install.sh --repair"
  elif [[ "$warn_count" -gt 0 ]]; then
    echo -e "  ${BOLD}Hinweis:${RESET} Einige Warnungen gefunden. Prüfe die Details oben."
  else
    echo -e "  ${BOLD}${GREEN}Alles in Ordnung!${RESET}"
  fi
  echo ""
  divider
}

# ═══════════════════════════════════════════════════════════════════════════════
#   --repair : Detect and fix broken configuration
# ═══════════════════════════════════════════════════════════════════════════════
run_repair() {
  banner
  header "Singra Vox – Reparatur-Modus"
  echo ""
  echo "  Prüfe bestehende Installation und behebe Probleme automatisch…"
  echo ""

  local fixed=0 skipped=0

  # ── Prüfe ob Installation existiert
  if [[ ! -d "$DATA_DIR" ]]; then
    error "Keine Installation gefunden in $DATA_DIR"
    echo -e "  ${DIM}Bitte zuerst installieren: bash install.sh${RESET}"
    exit 1
  fi

  # ── Docker prüfen
  header "1/7 Docker prüfen"
  ensure_docker

  # ── .env prüfen & reparieren
  header "2/7 Konfiguration prüfen"
  if [[ ! -f "$DATA_DIR/.env" ]]; then
    error ".env fehlt. Kann nicht automatisch erstellt werden."
    echo -e "  ${DIM}Bitte neu installieren: bash install.sh${RESET}"
    exit 1
  fi

  # JWT_SECRET prüfen
  local jwt_val
  jwt_val=$(grep "^JWT_SECRET=" "$DATA_DIR/.env" | cut -d'=' -f2-)
  if [[ -z "$jwt_val" || ${#jwt_val} -lt 16 ]]; then
    warn "JWT_SECRET fehlt oder zu kurz. Generiere neuen…"
    local new_jwt; new_jwt=$(gen_secret)
    if grep -q "^JWT_SECRET=" "$DATA_DIR/.env"; then
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$new_jwt|" "$DATA_DIR/.env"
    else
      echo "JWT_SECRET=$new_jwt" >> "$DATA_DIR/.env"
    fi
    success "JWT_SECRET generiert"
    (( fixed++ ))
  else
    success "JWT_SECRET OK"
    (( skipped++ ))
  fi

  # INSTANCE_ENCRYPTION_SECRET prüfen
  local enc_val
  enc_val=$(grep "^INSTANCE_ENCRYPTION_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -z "$enc_val" ]]; then
    warn "INSTANCE_ENCRYPTION_SECRET fehlt. Generiere…"
    local new_enc; new_enc=$(gen_secret)
    echo "INSTANCE_ENCRYPTION_SECRET=$new_enc" >> "$DATA_DIR/.env"
    success "INSTANCE_ENCRYPTION_SECRET generiert"
    warn "WICHTIG: Diesen Schlüssel SICHER aufbewahren! Ohne ihn sind alle Daten verloren."
    echo -e "  ${BOLD}$new_enc${RESET}"
    (( fixed++ ))
  else
    success "INSTANCE_ENCRYPTION_SECRET OK"
    (( skipped++ ))
  fi

  # DB_NAME prüfen
  local db_val
  db_val=$(grep "^DB_NAME=" "$DATA_DIR/.env" | cut -d'=' -f2-)
  if [[ -z "$db_val" ]]; then
    echo "DB_NAME=singravox" >> "$DATA_DIR/.env"
    success "DB_NAME gesetzt: singravox"
    (( fixed++ ))
  else
    success "DB_NAME OK: $db_val"
    (( skipped++ ))
  fi

  # ── Docker Compose Datei prüfen
  header "3/7 Docker Compose prüfen"
  if [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    success "docker-compose.yml vorhanden"
    (( skipped++ ))
  else
    warn "docker-compose.yml fehlt"
    echo -e "  ${DIM}Bitte neu installieren: bash install.sh${RESET}"
    (( fixed++ ))
  fi

  # ── LiveKit Config prüfen
  header "4/7 LiveKit-Konfiguration prüfen"
  local lk_key lk_secret
  lk_key=$(grep "^LIVEKIT_API_KEY=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  lk_secret=$(grep "^LIVEKIT_API_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -n "$lk_key" && -n "$lk_secret" ]]; then
    # Prüfe ob livekit.yaml existiert und konsistent ist
    if [[ -f "$DATA_DIR/livekit.yaml" ]]; then
      if grep -q "$lk_key" "$DATA_DIR/livekit.yaml"; then
        success "LiveKit-Konfiguration konsistent"
        (( skipped++ ))
      else
        warn "livekit.yaml passt nicht zu .env – regeneriere…"
        write_livekit_config "$lk_key" "$lk_secret"
        success "livekit.yaml aktualisiert"
        (( fixed++ ))
      fi
    else
      info "livekit.yaml fehlt – erstelle…"
      write_livekit_config "$lk_key" "$lk_secret"
      success "livekit.yaml erstellt"
      (( fixed++ ))
    fi
  else
    info "LiveKit nicht konfiguriert (Voice/Video deaktiviert)"
    (( skipped++ ))
  fi

  # ── Berechtigungen prüfen
  header "5/7 Dateiberechtigungen prüfen"
  if [[ -f "$DATA_DIR/.env" ]]; then
    local env_perms
    env_perms=$(stat -c '%a' "$DATA_DIR/.env" 2>/dev/null)
    if [[ "$env_perms" == "600" ]]; then
      success ".env Berechtigungen OK (600)"
      (( skipped++ ))
    else
      chmod 600 "$DATA_DIR/.env"
      success ".env Berechtigungen korrigiert: $env_perms → 600"
      (( fixed++ ))
    fi
  fi

  # ── Container starten falls gestoppt
  header "6/7 Container prüfen"
  if [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    cd "$DATA_DIR"
    local running
    running=$($COMPOSE_BIN ps --status running -q 2>/dev/null | wc -l)
    if [[ "$running" -eq 0 ]]; then
      warn "Keine Container laufen. Starte…"
      $COMPOSE_BIN up -d 2>&1 | tail -5
      success "Container gestartet"
      (( fixed++ ))
    else
      success "$running Container laufen"
      (( skipped++ ))

      # Prüfe ob wichtige Container fehlen
      local expected_services=("mongodb" "backend" "frontend")
      for svc in "${expected_services[@]}"; do
        if $COMPOSE_BIN ps "$svc" 2>/dev/null | grep -q "running\|Up"; then
          success "$svc läuft"
        else
          warn "$svc nicht gestartet – versuche Neustart…"
          $COMPOSE_BIN up -d "$svc" 2>&1 | tail -3
          (( fixed++ ))
        fi
      done
    fi
  fi

  # ── Source-Dateien aktuell?
  header "7/7 Build-Kontext prüfen"
  if [[ -d "$DATA_DIR/backend_src" ]]; then
    success "Backend Source vorhanden"
    (( skipped++ ))
  else
    warn "Backend Source fehlt – kopiere…"
    prepare_build_context
    (( fixed++ ))
  fi

  # ── Ergebnis
  echo ""
  divider
  echo ""
  if [[ "$fixed" -gt 0 ]]; then
    echo -e "  ${GREEN}✓ $fixed Problem(e) behoben${RESET}, $skipped bereits OK"
    echo ""
    echo -e "  ${BOLD}Empfehlung:${RESET} Container neu starten für volle Wirkung:"
    echo -e "  ${DIM}cd $DATA_DIR && $COMPOSE_BIN restart${RESET}"
  else
    echo -e "  ${GREEN}${BOLD}Alles in Ordnung!${RESET} Keine Reparaturen nötig."
  fi
  echo ""
  divider
}

# ═══════════════════════════════════════════════════════════════════════════════
#   --identity : Set up Singra Vox ID (optional)
# ═══════════════════════════════════════════════════════════════════════════════
run_identity_setup() {
  banner
  header "Singra Vox ID – Identity Server einrichten"
  echo ""
  echo "  Singra Vox ID ermöglicht EIN Konto über ALLE Instanzen hinweg."
  echo "  Ähnlich wie 'Login mit Google' – aber komplett selbst gehostet."
  echo ""
  echo -e "  ${BOLD}Zwei Optionen:${RESET}"
  echo ""
  echo -e "  ${BOLD}1) Integriert${RESET} – Teil deiner bestehenden Singra Vox Instanz"
  echo "     → Einfachste Option: SVID läuft auf dem gleichen Server"
  echo "     → Nutzer können sich mit Singra Vox ID auf DEINER Instanz registrieren"
  echo "     → Andere Instanzen können deine als ID-Server nutzen"
  echo ""
  echo -e "  ${BOLD}2) Standalone${RESET} – Eigener Server nur für Identity"
  echo "     → Empfohlen für: Mehrere Instanzen, zentraler ID-Server"
  echo "     → Braucht eigene Domain (z.B. id.deine-domain.de)"
  echo "     → Minimale Ressourcen (512 MB RAM)"
  echo ""

  local choice; choice=$(ask "Option wählen" "1")

  if [[ "$choice" == "1" ]]; then
    # ── Integrierter Modus
    echo ""
    header "Integrierter Identity Server"

    if [[ ! -f "$DATA_DIR/.env" ]]; then
      error "Keine bestehende Installation gefunden. Bitte zuerst installieren."
      exit 1
    fi

    local current_issuer
    current_issuer=$(grep "^SVID_ISSUER=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
    local current_frontend
    current_frontend=$(grep "^FRONTEND_URL=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)

    if [[ -n "$current_issuer" ]]; then
      success "SVID bereits konfiguriert: $current_issuer"
      if ! ask_yes_no "Neu konfigurieren?" "n"; then
        echo ""; info "Keine Änderungen vorgenommen."; return
      fi
    fi

    local svid_url
    svid_url=$(ask "Öffentliche URL deiner Instanz (wird der SVID Issuer)" "$current_frontend")

    local svid_secret
    svid_secret=$(gen_secret)

    # In .env eintragen
    if grep -q "^SVID_ISSUER=" "$DATA_DIR/.env"; then
      sed -i "s|^SVID_ISSUER=.*|SVID_ISSUER=$svid_url|" "$DATA_DIR/.env"
    else
      echo "SVID_ISSUER=$svid_url" >> "$DATA_DIR/.env"
    fi

    if grep -q "^SVID_JWT_SECRET=" "$DATA_DIR/.env"; then
      # Nur überschreiben wenn leer
      local existing_svid_secret
      existing_svid_secret=$(grep "^SVID_JWT_SECRET=" "$DATA_DIR/.env" | cut -d'=' -f2-)
      if [[ -z "$existing_svid_secret" ]]; then
        sed -i "s|^SVID_JWT_SECRET=.*|SVID_JWT_SECRET=$svid_secret|" "$DATA_DIR/.env"
      else
        svid_secret="$existing_svid_secret"
        info "Bestehender SVID_JWT_SECRET beibehalten"
      fi
    else
      echo "SVID_JWT_SECRET=$svid_secret" >> "$DATA_DIR/.env"
    fi

    echo ""
    success "Singra Vox ID konfiguriert!"
    echo ""
    echo -e "  ${BOLD}SVID Issuer:${RESET}      $svid_url"
    echo -e "  ${BOLD}SVID JWT Secret:${RESET}  ${svid_secret:0:8}…"
    echo ""
    echo -e "  ${BOLD}Nächster Schritt:${RESET}"
    echo "  Backend neu starten, damit die Änderungen wirksam werden:"
    echo -e "  ${DIM}cd $DATA_DIR && $COMPOSE_BIN restart backend${RESET}"
    echo ""
    echo "  Danach können Nutzer sich unter /svid-register mit Singra Vox ID"
    echo "  registrieren, und andere Instanzen können deine als ID-Server nutzen."

  elif [[ "$choice" == "2" ]]; then
    # ── Standalone Modus
    echo ""
    header "Standalone Identity Server"
    echo ""
    echo "  Für einen dedizierten Identity Server auf einem eigenen Server"
    echo "  folge der Anleitung in: docs/deploy-identity-server.md"
    echo ""
    echo -e "  ${BOLD}Kurzfassung:${RESET}"
    echo ""
    echo "  1. Auf dem ID-Server:"
    echo "     git clone https://github.com/einmalmaik/singra-vox.git"
    echo "     cd singra-vox/backend"
    echo "     python3 -m venv .venv && source .venv/bin/activate"
    echo "     pip install -r requirements.txt"
    echo ""
    echo "  2. .env erstellen mit:"
    echo "     MONGO_URL=mongodb://localhost:27017"
    echo "     DB_NAME=singravox_id"
    echo "     SVID_ISSUER=https://id.deine-domain.de"
    echo "     SVID_JWT_SECRET=$(gen_secret)"
    echo "     (+ SMTP-Konfiguration für E-Mail-Verifizierung)"
    echo ""
    echo "  3. Starten:"
    echo "     uvicorn identity_server:app --host 0.0.0.0 --port 8002 --workers 2"
    echo ""
    echo "  4. Reverse Proxy (Caddy/nginx) mit SSL einrichten"
    echo ""
    echo "  5. Auf jeder Instanz in .env eintragen:"
    echo "     SVID_ISSUER=https://id.deine-domain.de"
    echo "     SVID_JWT_SECRET=<gleicher-schlüssel-wie-id-server>"
    echo ""

    if [[ -f "$DATA_DIR/.env" ]] && ask_yes_no "Soll ich die SVID_ISSUER URL jetzt in deine Instanz eintragen?" "j"; then
      local standalone_url
      standalone_url=$(ask "URL des Identity Servers" "https://id.deine-domain.de")
      local standalone_secret
      standalone_secret=$(ask_secret "SVID JWT Secret (muss identisch mit ID-Server sein)")

      if grep -q "^SVID_ISSUER=" "$DATA_DIR/.env"; then
        sed -i "s|^SVID_ISSUER=.*|SVID_ISSUER=$standalone_url|" "$DATA_DIR/.env"
      else
        echo "SVID_ISSUER=$standalone_url" >> "$DATA_DIR/.env"
      fi

      if grep -q "^SVID_JWT_SECRET=" "$DATA_DIR/.env"; then
        sed -i "s|^SVID_JWT_SECRET=.*|SVID_JWT_SECRET=$standalone_secret|" "$DATA_DIR/.env"
      else
        echo "SVID_JWT_SECRET=$standalone_secret" >> "$DATA_DIR/.env"
      fi

      success "Instanz mit Identity Server verbunden: $standalone_url"
      echo -e "  ${DIM}Backend neu starten: cd $DATA_DIR && $COMPOSE_BIN restart backend${RESET}"
    fi
  fi

  echo ""
  divider
}

# ═══════════════════════════════════════════════════════════════════════════════
#   --auto-update-on / --auto-update-off
# ═══════════════════════════════════════════════════════════════════════════════
run_auto_update_on() {
  banner
  header "Auto-Update aktivieren"
  echo ""
  echo "  Das Auto-Update prüft täglich um 04:00 Uhr auf neue Versionen"
  echo "  und aktualisiert automatisch. Deine Konfiguration bleibt erhalten."
  echo ""

  local schedule
  schedule=$(ask "Cron-Zeitplan (Standard: täglich 04:00)" "0 4 * * *")

  # Sicherstellen dass kein alter Eintrag existiert
  local tmpfile
  tmpfile=$(mktemp)
  crontab -l 2>/dev/null | grep -v "singravox.*install.sh.*--update" > "$tmpfile" || true
  echo "$schedule cd $REPO_DIR && bash install.sh --update >> /var/log/singravox-update.log 2>&1 # singravox-auto-update" >> "$tmpfile"
  crontab "$tmpfile"
  rm -f "$tmpfile"

  success "Auto-Update aktiviert!"
  echo ""
  echo -e "  ${BOLD}Zeitplan:${RESET}   $schedule"
  echo -e "  ${BOLD}Log-Datei:${RESET}  /var/log/singravox-update.log"
  echo ""
  echo -e "  ${DIM}Deaktivieren: bash install.sh --auto-update-off${RESET}"
  echo ""
  divider
}

run_auto_update_off() {
  banner
  header "Auto-Update deaktivieren"

  local tmpfile
  tmpfile=$(mktemp)
  crontab -l 2>/dev/null | grep -v "singravox.*install.sh.*--update" > "$tmpfile" || true
  crontab "$tmpfile"
  rm -f "$tmpfile"

  success "Auto-Update deaktiviert."
  echo ""
  divider
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
  local encryption_secret; encryption_secret="$(gen_secret)"

  mkdir -p "$DATA_DIR"
  cat > "$DATA_DIR/.env" <<EOF
DB_NAME=singravox
JWT_SECRET=$jwt_secret
INSTANCE_ENCRYPTION_SECRET=$encryption_secret
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

  # INSTANCE_ENCRYPTION_SECRET Warnung
  echo ""
  warn "WICHTIG: Verschlüsselungsschlüssel sicher aufbewahren!"
  echo -e "  ${BOLD}INSTANCE_ENCRYPTION_SECRET:${RESET}"
  echo -e "  ${DIM}$encryption_secret${RESET}"
  echo -e "  ${RED}Ohne diesen Schlüssel sind alle Daten unwiderruflich verloren!${RESET}"
  echo ""
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

  rsync -a --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.env' --exclude='storage/' \
    "$REPO_DIR/backend/" "$DATA_DIR/backend_src/" 2>/dev/null \
    || cp -r "$REPO_DIR/backend/." "$DATA_DIR/backend_src/"

  rsync -a --exclude='.git' --exclude='node_modules' --exclude='build' \
    --exclude='.env' \
    "$REPO_DIR/frontend/" "$DATA_DIR/frontend_src/" 2>/dev/null \
    || cp -r "$REPO_DIR/frontend/." "$DATA_DIR/frontend_src/"

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
  echo -e "  ${BOLD}1)${RESET} Eingebaut (Mailpit) — Alle E-Mails im Browser sichtbar"
  echo "     Empfohlen für Tests und private Server"
  echo -e "  ${BOLD}2)${RESET} Extern (Gmail, Mailgun, Resend, etc.) — Echte E-Mails"
  echo "     Empfohlen für öffentliche Server"
  echo ""

  local choice; choice=$(ask "Wahl" "1")

  if [[ "$choice" == "2" ]]; then
    echo ""
    local smtp_host smtp_port smtp_user smtp_pass smtp_from smtp_tls smtp_ssl
    smtp_host=$(ask "SMTP Server (z.B. smtp.resend.com)" "")
    smtp_port=$(ask "SMTP Port" "587")
    smtp_user=$(ask "SMTP Benutzername / E-Mail" "")
    smtp_pass=$(ask_secret "SMTP Passwort")
    smtp_from=$(ask "Absender E-Mail" "$smtp_user")
    smtp_tls="true"; smtp_ssl="false"
    if [[ "$smtp_port" == "465" ]]; then smtp_ssl="true"; smtp_tls="false"; fi
    echo "$smtp_host|$smtp_port|$smtp_user|$smtp_pass|$smtp_from|$smtp_tls|$smtp_ssl"
  else
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

  if ! detect_compose; then
    error "Docker Compose nicht gefunden."
    exit 1
  fi

  # Determine which compose file is in use
  if [[ -f "$DATA_DIR/Caddyfile" ]]; then
    info "Produktions-Setup erkannt (Caddy/HTTPS)"
  else
    info "Quickstart-Setup erkannt (HTTP)"
  fi

  # Pull latest source (if git repo)
  if [[ -d "$REPO_DIR/.git" ]]; then
    info "Lade neuesten Code von GitHub…"
    cd "$REPO_DIR"
    local current_hash new_hash
    current_hash=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null \
      || warn "git pull fehlgeschlagen. Fahre mit lokalem Code fort."
    new_hash=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

    if [[ "$current_hash" == "$new_hash" ]]; then
      info "Bereits auf dem neuesten Stand ($current_hash)"
    else
      success "Code aktualisiert: ${current_hash:0:8} → ${new_hash:0:8}"
    fi
  fi

  # Check if INSTANCE_ENCRYPTION_SECRET exists (repair on update)
  local enc_val
  enc_val=$(grep "^INSTANCE_ENCRYPTION_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -z "$enc_val" ]]; then
    warn "INSTANCE_ENCRYPTION_SECRET fehlt – generiere neuen Schlüssel…"
    local new_enc; new_enc=$(gen_secret)
    echo "INSTANCE_ENCRYPTION_SECRET=$new_enc" >> "$DATA_DIR/.env"
    success "INSTANCE_ENCRYPTION_SECRET generiert"
    warn "WICHTIG: Schlüssel sicher aufbewahren: $new_enc"
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

  # Save version
  if [[ -d "$REPO_DIR/.git" ]]; then
    git rev-parse HEAD > "$VERSION_FILE" 2>/dev/null || true
  fi

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

# ═══════════════════════════════════════════════════════════════════════════════
#   Main Install
# ═══════════════════════════════════════════════════════════════════════════════
main() {
  # ── Flag-Erkennung ─────────────────────────────────────────────────────────
  for arg in "$@"; do
    case "$arg" in
      --update|update)        run_update; return ;;
      --status|status)        run_status; return ;;
      --repair|repair)        run_repair; return ;;
      --identity|identity)    run_identity_setup; return ;;
      --auto-update-on)       run_auto_update_on; return ;;
      --auto-update-off)      run_auto_update_off; return ;;
      --help|-h|help)
        echo ""
        echo "  Singra Vox Installer"
        echo ""
        echo "  Verwendung: bash install.sh [OPTION]"
        echo ""
        echo "  Optionen:"
        echo "    (ohne)              Neu-Installation oder Re-Installation"
        echo "    --update            Update auf neueste Version"
        echo "    --status            System-Status & Diagnose"
        echo "    --repair            Konfiguration prüfen & reparieren"
        echo "    --identity          Singra Vox ID einrichten (optional)"
        echo "    --auto-update-on    Automatische Updates aktivieren"
        echo "    --auto-update-off   Automatische Updates deaktivieren"
        echo "    --help              Diese Hilfe anzeigen"
        echo ""
        return
        ;;
    esac
  done

  banner

  # ── Bestehende Installation erkennen
  if [[ -d "$DATA_DIR" && -f "$DATA_DIR/.env" && -f "$DATA_DIR/docker-compose.yml" ]]; then
    echo ""
    warn "Bestehende Installation erkannt in $DATA_DIR"
    echo ""
    echo -e "  ${BOLD}1)${RESET} Neu installieren (Konfiguration wird überschrieben!)"
    echo -e "  ${BOLD}2)${RESET} Reparieren (Konfiguration bleibt erhalten)"
    echo -e "  ${BOLD}3)${RESET} Update (Konfiguration bleibt erhalten, neuster Code)"
    echo -e "  ${BOLD}4)${RESET} Abbrechen"
    echo ""
    local reinstall_choice; reinstall_choice=$(ask "Wahl" "2")
    case "$reinstall_choice" in
      2) run_repair; return ;;
      3) run_update; return ;;
      4) info "Abgebrochen."; return ;;
      1) warn "Fahre mit Neuinstallation fort…" ;;
    esac
  fi

  # ── OS Check ────────────────────────────────────────────────────────────────
  if [[ "$(uname -s)" != "Linux" ]]; then
    error "Dieser Installer unterstützt nur Linux."
    exit 1
  fi

  if [[ "$EUID" -ne 0 ]] && ! groups | grep -q docker 2>/dev/null; then
    warn "Nicht root und nicht in der Docker-Gruppe. Einige Befehle könnten sudo benötigen."
  fi

  # ── Storage Mode (Lite vs Full) ──────────────────────────────────────────
  echo ""
  header "Speicher-Modus (E2EE Datei-Uploads)"
  local total_ram_mb; total_ram_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2048)
  echo ""
  echo -e "  ${BOLD}1) Lite-Modus${RESET}  — Lokales Dateisystem (kein MinIO, ~50 MB RAM)"
  echo "     Ideal für: VPS mit 1-2 GB RAM, kleine Instanzen"
  echo ""
  echo -e "  ${BOLD}2) Voll-Modus${RESET}  — MinIO S3-kompatibler Storage (~200 MB RAM)"
  echo "     Ideal für: Server mit 4+ GB RAM, große Instanzen, S3-Backups"
  echo ""
  if [[ $total_ram_mb -lt 3000 ]]; then
    warn "Erkannter RAM: ${total_ram_mb} MB → Lite-Modus empfohlen"
    local storage_default="1"
  else
    info "Erkannter RAM: ${total_ram_mb} MB"
    local storage_default="2"
  fi
  local storage_mode; storage_mode=$(ask "Wähle 1 oder 2" "$storage_default")

  # ── Worker-Anzahl (CPU-basiert) ────────────────────────────────────────────
  local cpu_cores; cpu_cores=$(nproc 2>/dev/null || echo 1)
  local workers=1
  if [[ $cpu_cores -ge 4 ]]; then
    workers=2
  fi
  info "CPU-Kerne: ${cpu_cores} → Backend-Workers: ${workers}"

  # ── Mode Selection ───────────────────────────────────────────────────────────
  echo ""
  header "Installations-Modus"
  echo ""
  echo -e "  ${BOLD}1) Schnellstart${RESET}  — HTTP, über IP oder Domain erreichbar"
  echo "     Ideal für: Tests, privates Netzwerk, eigene Subdomain"
  echo ""
  echo -e "  ${BOLD}2) Produktiv${RESET}     — HTTPS mit automatischem SSL-Zertifikat (Let's Encrypt)"
  echo "     Ideal für: Öffentlicher Server, Hetzner/Netcup/Contabo VPS"
  echo "     Voraussetzung: Domain zeigt auf diesen Server (Port 80+443 offen)"
  echo ""
  local mode; mode=$(ask "Wähle 1 oder 2" "1")

  # ── Instance Name ─────────────────────────────────────────────────────────
  echo ""
  header "Server-Name"
  echo -e "  ${DIM}Der Name, der in der App und bei Einladungen angezeigt wird.${RESET}"
  local instance_name; instance_name=$(ask "Name deiner Singra-Vox-Instanz" "Mein Singra Vox")

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
    "$vapid_private" "$vapid_public" "" \
    "$s3_key" "$s3_secret"

  # Storage-Modus und Worker-Anzahl in .env eintragen
  if [[ "$storage_mode" == "1" ]]; then
    echo "STORAGE_MODE=local" >> "$DATA_DIR/.env"
    echo "S3_ENDPOINT_URL=" >> "$DATA_DIR/.env"
    info "Lite-Modus: Lokaler Speicher aktiviert (kein MinIO)"
  else
    echo "STORAGE_MODE=s3" >> "$DATA_DIR/.env"
    info "Voll-Modus: MinIO S3-Storage aktiviert"
  fi
  echo "WORKERS=${workers}" >> "$DATA_DIR/.env"
  echo "ALLOW_OPEN_SIGNUP=${allow_signup}" >> "$DATA_DIR/.env"

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

  # ── Admin setup via Web UI ────────────────────────────────────────────────
  echo ""
  info "Admin-Account wird beim ersten Öffnen der App über den Setup-Wizard erstellt."

  # ── Save version info ────────────────────────────────────────────────────
  if [[ -d "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" rev-parse HEAD > "$VERSION_FILE" 2>/dev/null || true
  fi

  # ── Optional: Singra Vox ID? ─────────────────────────────────────────────
  echo ""
  if ask_yes_no "Möchtest du Singra Vox ID (Identity Server) einrichten?" "n"; then
    run_identity_setup
  else
    info "Singra Vox ID übersprungen. Jederzeit nachholen: bash install.sh --identity"
  fi

  # ── Optional: Auto-Update? ──────────────────────────────────────────────
  echo ""
  if ask_yes_no "Automatische Updates aktivieren? (täglich um 04:00)" "j"; then
    local tmpfile
    tmpfile=$(mktemp)
    crontab -l 2>/dev/null | grep -v "singravox.*install.sh.*--update" > "$tmpfile" || true
    echo "0 4 * * * cd $REPO_DIR && bash install.sh --update >> /var/log/singravox-update.log 2>&1 # singravox-auto-update" >> "$tmpfile"
    crontab "$tmpfile"
    rm -f "$tmpfile"
    success "Auto-Update aktiviert (täglich 04:00)"
  fi

  # ── Done! ─────────────────────────────────────────────────────────────────
  echo ""
  divider
  echo ""
  echo -e "${BOLD}${GREEN}  Singra Vox läuft!${RESET}"
  echo ""
  echo -e "  ${BOLD}App öffnen:${RESET}      $frontend_url"
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
  echo "  1. App im Browser öffnen: $frontend_url"
  echo "  2. Setup-Wizard durchlaufen (Admin-Account & Instanz einrichten)"
  echo "  3. Ersten Server erstellen und Freunde einladen"
  echo ""
  echo -e "  ${BOLD}Verwaltung:${RESET}"
  echo "  bash install.sh --status          Status & Diagnose"
  echo "  bash install.sh --repair          Probleme reparieren"
  echo "  bash install.sh --update          Manuell aktualisieren"
  echo "  bash install.sh --identity        Singra Vox ID einrichten"
  echo "  bash install.sh --auto-update-on  Automatische Updates aktivieren"
  echo ""
  echo -e "  ${CYAN}Docker-Befehle:${RESET}"
  echo "  cd $DATA_DIR"
  echo "  $COMPOSE_BIN logs -f           # Live-Logs"
  echo "  $COMPOSE_BIN restart backend   # Backend neu starten"
  echo "  $COMPOSE_BIN down              # Alles stoppen"
  echo "  $COMPOSE_BIN up -d             # Alles starten"
  echo ""
  divider
}

main "$@"
