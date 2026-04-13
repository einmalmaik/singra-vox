#!/usr/bin/env bash

# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# =============================================================================
#   Singra Vox â€“ Self-Hosted Installer & Manager
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

# â”€â”€ Colors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

info()    { echo -e "${CYAN}  â†’${RESET} $*" >&2; }
success() { echo -e "${GREEN}  âœ“${RESET} $*" >&2; }
warn()    { echo -e "${YELLOW}  !${RESET} $*" >&2; }
error()   { echo -e "${RED}  âœ—${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}$*${RESET}" >&2; }
divider() { echo -e "${CYAN}â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€${RESET}" >&2; }

banner() {
  echo "" >&2
  echo -e "${BOLD}${CYAN}" >&2
  echo "   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ•—   â–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—     â–ˆâ–ˆâ•—   â–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ•—  â–ˆâ–ˆâ•—" >&2
  echo "   â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•â•â• â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—    â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•â–ˆâ–ˆâ•—â•šâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•" >&2
  echo "   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â–ˆâ–ˆâ•— â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘    â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘ â•šâ–ˆâ–ˆâ–ˆâ•”â• " >&2
  echo "   â•šâ•â•â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘    â•šâ–ˆâ–ˆâ•— â–ˆâ–ˆâ•”â•â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘ â–ˆâ–ˆâ•”â–ˆâ–ˆâ•— " >&2
  echo "   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘ â•šâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘     â•šâ–ˆâ–ˆâ–ˆâ–ˆâ•”â• â•šâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•”â•â–ˆâ–ˆâ•”â• â–ˆâ–ˆâ•—" >&2
  echo "   â•šâ•â•â•â•â•â•â•â•šâ•â•â•šâ•â•  â•šâ•â•â•â• â•šâ•â•â•â•â•â• â•šâ•â•  â•šâ•â•â•šâ•â•  â•šâ•â•      â•šâ•â•â•â•   â•šâ•â•â•â•â•â• â•šâ•â•  â•šâ•â•" >&2
  echo -e "${RESET}" >&2
  echo -e "${BOLD}   Self-Hosted Encrypted Chat â€” Easy Install${RESET}" >&2
  divider
  echo "" >&2
}

# â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ask() {
  local label="$1" default="${2:-}" result=""
  if [[ -n "$default" ]]; then
    printf "  ${BOLD}%s${RESET} [%s]: " "$label" "$default" >&2
  else
    printf "  ${BOLD}%s${RESET}: " "$label" >&2
  fi
  read -r result
  echo "${result:-$default}"
}

ask_secret() {
  local label="$1" result=""
  printf "  ${BOLD}%s${RESET}: " "$label" >&2
  read -rs result; echo "" >&2
  echo "$result"
}

ask_yes_no() {
  local label="$1" default="${2:-n}" result=""
  printf "  ${BOLD}%s${RESET} (j/n) [%s]: " "$label" "$default" >&2
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

# â”€â”€ Port-VerfÃ¼gbarkeit prÃ¼fen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
is_port_free() {
  local port="$1"
  # Try ss first, then netstat, then a direct connection test
  if command -v ss &>/dev/null; then
    ! ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"
  elif command -v netstat &>/dev/null; then
    ! netstat -tlnp 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"
  else
    # Fallback: try to bind the port briefly
    (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null && return 1 || return 0
  fi
}

find_free_port() {
  local start_port="$1"
  local port="$start_port"
  while ! is_port_free "$port"; do
    warn "Port $port ist bereits belegt, versuche $((port + 1))â€¦" >&2
    (( port++ ))
    if (( port > start_port + 20 )); then
      error "Kein freier Port im Bereich $start_portâ€“$port gefunden." >&2
      echo "$start_port"
      return
    fi
  done
  if (( port != start_port )); then
    info "Port $port ist frei." >&2
  fi
  echo "$port"
}

# â”€â”€ UFW Portfreigabe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
configure_firewall() {
  local ports=("$@")

  if ! command -v ufw &>/dev/null; then
    return 0
  fi

  # Check if UFW is active
  if ! ufw status 2>/dev/null | grep -qi "active"; then
    return 0
  fi

  echo "" >&2
  header "Firewall (UFW)" >&2
  info "UFW ist aktiv. Folgende Ports werden fÃ¼r Singra Vox benÃ¶tigt:" >&2
  echo "" >&2
  for entry in "${ports[@]}"; do
    local port_num="${entry%%:*}"
    local desc="${entry#*:}"
    echo -e "  ${BOLD}${port_num}${RESET}  â€” ${desc}" >&2
  done
  echo "" >&2

  printf "  ${BOLD}%s${RESET} (j/n) [j]: " "Ports automatisch in UFW freigeben?" >&2
  read -r ufw_confirm
  ufw_confirm="${ufw_confirm:-j}"

  if [[ "${ufw_confirm,,}" =~ ^(j|y|ja|yes)$ ]]; then
    local all_ok=true
    for entry in "${ports[@]}"; do
      local port_num="${entry%%:*}"
      local desc="${entry#*:}"
      local proto="${port_num##*/}"
      local pnum="${port_num%%/*}"

      local ufw_result
      if [[ "$proto" == "$port_num" ]]; then
        ufw_result=$(ufw allow "$pnum" comment "Singra Vox: $desc" 2>&1) || true
      else
        ufw_result=$(ufw allow "$port_num" comment "Singra Vox: $desc" 2>&1) || true
      fi

      if echo "$ufw_result" | grep -qi "added\|existing\|updated\|skipping"; then
        success "Port $port_num freigegeben (${desc})" >&2
      else
        warn "Port $port_num konnte nicht freigegeben werden: $ufw_result" >&2
        all_ok=false
      fi
    done

    # Reload UFW to apply changes
    ufw reload >/dev/null 2>&1 || true

    # Verify: check that the ports are now in UFW rules
    echo "" >&2
    info "ÃœberprÃ¼fe Firewall-Regelnâ€¦" >&2
    local verify_ok=true
    for entry in "${ports[@]}"; do
      local port_num="${entry%%:*}"
      local pnum="${port_num%%/*}"
      if ufw status 2>/dev/null | grep -q "$pnum"; then
        success "Port $pnum ist in UFW freigegeben." >&2
      else
        error "Port $pnum ist NICHT in UFW freigegeben!" >&2
        verify_ok=false
      fi
    done

    if [[ "$verify_ok" == "false" ]]; then
      echo "" >&2
      warn "Einige Ports konnten nicht freigegeben werden." >&2
      echo -e "  ${DIM}MÃ¶gliche Ursache: Script lÃ¤uft nicht als root.${RESET}" >&2
      echo -e "  ${DIM}LÃ¶sung: Script mit sudo ausfÃ¼hren: ${BOLD}sudo bash install.sh${RESET}" >&2
      echo "" >&2
      printf "  ${BOLD}%s${RESET} (j/n) [j]: " "Trotzdem fortfahren?" >&2
      read -r skip_confirm
      skip_confirm="${skip_confirm:-j}"
      if [[ ! "${skip_confirm,,}" =~ ^(j|y|ja|yes)$ ]]; then
        error "Installation abgebrochen. Bitte mit sudo ausfÃ¼hren." >&2
        exit 1
      fi
    fi
  else
    warn "Ports nicht freigegeben. Bitte manuell Ã¶ffnen:" >&2
    for entry in "${ports[@]}"; do
      local port_num="${entry%%:*}"
      local desc="${entry#*:}"
      echo "    sudo ufw allow $port_num comment 'Singra Vox: $desc'" >&2
    done
  fi
}

# â”€â”€ Webserver-Erkennung â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
detect_existing_webserver() {
  local proc80=""
  if command -v ss &>/dev/null; then
    proc80=$(ss -tlnp 2>/dev/null | grep ':80 ' | head -1)
  elif command -v netstat &>/dev/null; then
    proc80=$(netstat -tlnp 2>/dev/null | grep ':80 ' | head -1)
  fi
  if echo "$proc80" | grep -qi "nginx"; then echo "nginx"; return; fi
  if echo "$proc80" | grep -qi "apache\|httpd"; then echo "apache"; return; fi
  if echo "$proc80" | grep -qi "caddy"; then echo "caddy"; return; fi
  # Fallback: systemd
  if systemctl is-active --quiet nginx 2>/dev/null; then echo "nginx"; return; fi
  if systemctl is-active --quiet apache2 2>/dev/null; then echo "apache"; return; fi
  if systemctl is-active --quiet httpd 2>/dev/null; then echo "apache"; return; fi
  if systemctl is-active --quiet caddy 2>/dev/null; then echo "caddy"; return; fi
  echo "unknown"
}

configure_nginx_reverse_proxy() {
  local domain="$1" local_port="$2" rtc_domain="$3" lk_port="${4:-7880}"
  local conf_dir="" conf_file=""

  if [[ -d "/etc/nginx/sites-available" ]]; then
    conf_dir="sites"
    conf_file="/etc/nginx/sites-available/singravox.conf"
  elif [[ -d "/etc/nginx/conf.d" ]]; then
    conf_dir="conf.d"
    conf_file="/etc/nginx/conf.d/singravox.conf"
  else
    error "Nginx-Konfigurationsverzeichnis nicht gefunden."
    return 1
  fi

  if [[ ! -w "$(dirname "$conf_file")" ]]; then
    warn "Keine Schreibrechte auf $(dirname "$conf_file")."
    warn "Bitte mit sudo ausfÃ¼hren oder manuell konfigurieren."
    return 1
  fi

  [[ -f "$conf_file" ]] && {
    cp "$conf_file" "${conf_file}.bak.$(date +%s)" 2>/dev/null || true
    info "Backup erstellt: ${conf_file}.bak.*"
  }

  info "Schreibe Nginx-Konfiguration: ${conf_file}"

  cat > "$conf_file" <<NGPROXY_EOF
# Singra Vox â€“ Automatisch generiert von install.sh ($(date +%F))
# Wird bei erneutem install.sh ueberschrieben.

server {
    listen 80;
    server_name ${domain};
    client_max_body_size 100M;

    location /api/ {
        proxy_pass http://127.0.0.1:${local_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:${local_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name ${rtc_domain};

    location / {
        proxy_pass http://127.0.0.1:${lk_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGPROXY_EOF

  [[ "$conf_dir" == "sites" ]] && ln -sf "$conf_file" /etc/nginx/sites-enabled/singravox.conf 2>/dev/null || true

  info "Teste Nginx-Konfigurationâ€¦"
  if nginx -t 2>/dev/null; then
    success "Nginx-Konfiguration ist gueltig"
  else
    error "Nginx-Konfiguration fehlerhaft!"
    nginx -t 2>&1 | while IFS= read -r l; do echo "  $l" >&2; done
    return 1
  fi

  nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || {
    warn "Nginx konnte nicht neu geladen werden. Bitte manuell: sudo systemctl reload nginx"
  }
  success "Nginx-Proxy: ${domain} -> 127.0.0.1:${local_port}"
  success "Nginx-Proxy: ${rtc_domain} -> 127.0.0.1:${lk_port} (LiveKit)"
  return 0
}

configure_apache_reverse_proxy() {
  local domain="$1" local_port="$2" rtc_domain="$3" lk_port="${4:-7880}"
  local conf_file="" svc_name="apache2"

  if [[ -d "/etc/apache2/sites-available" ]]; then
    conf_file="/etc/apache2/sites-available/singravox.conf"
  elif [[ -d "/etc/httpd/conf.d" ]]; then
    conf_file="/etc/httpd/conf.d/singravox.conf"
    svc_name="httpd"
  else
    error "Apache-Konfigurationsverzeichnis nicht gefunden."
    return 1
  fi

  if [[ ! -w "$(dirname "$conf_file")" ]]; then
    warn "Keine Schreibrechte. Bitte mit sudo ausfuehren."
    return 1
  fi

  command -v a2enmod &>/dev/null && {
    a2enmod proxy proxy_http proxy_wstunnel rewrite headers >/dev/null 2>&1 || true
    info "Apache-Module aktiviert (proxy, proxy_http, proxy_wstunnel, rewrite, headers)"
  }

  [[ -f "$conf_file" ]] && cp "$conf_file" "${conf_file}.bak.$(date +%s)" 2>/dev/null || true

  info "Schreibe Apache-Konfiguration: ${conf_file}"

  cat > "$conf_file" <<APPROXY_EOF
# Singra Vox â€“ Automatisch generiert von install.sh ($(date +%F))

<VirtualHost *:80>
    ServerName ${domain}
    ProxyPreserveHost On
    ProxyRequests Off

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:${local_port}/\$1 [P,L]

    ProxyPass / http://127.0.0.1:${local_port}/
    ProxyPassReverse / http://127.0.0.1:${local_port}/
</VirtualHost>

<VirtualHost *:80>
    ServerName ${rtc_domain}
    ProxyPreserveHost On
    ProxyRequests Off

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:${lk_port}/\$1 [P,L]

    ProxyPass / http://127.0.0.1:${lk_port}/
    ProxyPassReverse / http://127.0.0.1:${lk_port}/
</VirtualHost>
APPROXY_EOF

  command -v a2ensite &>/dev/null && a2ensite singravox.conf >/dev/null 2>&1 || true

  systemctl reload "$svc_name" 2>/dev/null || {
    warn "Apache konnte nicht neu geladen werden. Bitte manuell: sudo systemctl reload $svc_name"
  }
  success "Apache-Proxy: ${domain} und ${rtc_domain} konfiguriert"
  return 0
}

configure_caddy_reverse_proxy() {
  local domain="$1" local_port="$2" rtc_domain="$3" lk_port="${4:-7880}"
  local caddyfile="/etc/caddy/Caddyfile"
  local conf_dir="/etc/caddy/conf.d"
  local conf_file="$conf_dir/singravox.caddy"

  if [[ ! -f "$caddyfile" ]]; then
    error "Caddyfile nicht gefunden: $caddyfile"
    return 1
  fi

  mkdir -p "$conf_dir" 2>/dev/null || true
  [[ -f "$conf_file" ]] && cp "$conf_file" "${conf_file}.bak.$(date +%s)" 2>/dev/null || true

  info "Schreibe Caddy-Konfiguration: ${conf_file}"

  cat > "$conf_file" <<CDPROXY_EOF
# Singra Vox ($(date +%F))
${domain} {
    reverse_proxy 127.0.0.1:${local_port}
}

${rtc_domain} {
    reverse_proxy 127.0.0.1:${lk_port}
}
CDPROXY_EOF

  if ! grep -q "import ${conf_dir}/" "$caddyfile" 2>/dev/null; then
    cp "$caddyfile" "${caddyfile}.bak.$(date +%s)" 2>/dev/null || true
    local tmp; tmp=$(mktemp)
    echo "import ${conf_dir}/*.caddy" > "$tmp"
    cat "$caddyfile" >> "$tmp"
    mv "$tmp" "$caddyfile"
    info "Import-Direktive in Caddyfile eingefuegt"
  fi

  systemctl reload caddy 2>/dev/null || caddy reload --config "$caddyfile" 2>/dev/null || {
    warn "Caddy konnte nicht neu geladen werden."
  }
  success "Caddy konfiguriert â€” SSL wird automatisch eingerichtet!"
  return 0
}

print_manual_proxy_instructions() {
  local domain="$1" local_port="$2" rtc_domain="$3" lk_port="${4:-7880}"
  echo "" >&2
  warn "Automatische Proxy-Konfiguration nicht moeglich."
  echo "" >&2
  echo -e "  ${BOLD}Richte deinen Reverse Proxy manuell ein:${RESET}" >&2
  echo "" >&2
  echo -e "  ${BOLD}App:${RESET}     ${domain}  ->  127.0.0.1:${local_port}" >&2
  echo -e "  ${BOLD}Voice:${RESET}   ${rtc_domain}  ->  127.0.0.1:${lk_port} (WebSocket!)" >&2
  echo "" >&2
  echo -e "  ${CYAN}Nginx-Beispiel:${RESET}" >&2
  echo "    server {" >&2
  echo "        listen 80;" >&2
  echo "        server_name ${domain};" >&2
  echo "        client_max_body_size 100M;" >&2
  echo "        location / {" >&2
  echo "            proxy_pass http://127.0.0.1:${local_port};" >&2
  echo "            proxy_http_version 1.1;" >&2
  echo "            proxy_set_header Upgrade \$http_upgrade;" >&2
  echo "            proxy_set_header Connection \"upgrade\";" >&2
  echo "            proxy_set_header Host \$host;" >&2
  echo "        }" >&2
  echo "    }" >&2
  echo "" >&2
  echo -e "  ${CYAN}Caddy-Beispiel:${RESET}" >&2
  echo "    ${domain} { reverse_proxy 127.0.0.1:${local_port} }" >&2
  echo "    ${rtc_domain} { reverse_proxy 127.0.0.1:${lk_port} }" >&2
  echo "" >&2
}

offer_certbot_ssl() {
  local domain="$1" rtc_domain="$2" webserver="$3"
  [[ "$webserver" == "caddy" ]] && return 0

  if ! command -v certbot &>/dev/null; then
    echo "" >&2
    info "Fuer SSL empfehlen wir Certbot:"
    echo -e "  ${DIM}sudo apt install certbot python3-certbot-nginx${RESET}" >&2
    echo -e "  ${DIM}sudo certbot --nginx -d ${domain} -d ${rtc_domain}${RESET}" >&2
    return 0
  fi

  echo "" >&2
  header "SSL-Zertifikat (Let's Encrypt)"
  printf "  ${BOLD}%s${RESET} (j/n) [j]: " "SSL-Zertifikat fuer ${domain} einrichten?" >&2
  read -r ssl_yn
  ssl_yn="${ssl_yn:-j}"
  [[ ! "${ssl_yn,,}" =~ ^(j|y|ja|yes)$ ]] && return 0

  local plugin=""
  case "$webserver" in
    nginx)  plugin="--nginx" ;;
    apache) plugin="--apache" ;;
    *)      plugin="--webroot -w /var/www/html" ;;
  esac

  info "Starte Certbotâ€¦"
  if certbot $plugin -d "$domain" -d "$rtc_domain" --non-interactive --agree-tos --register-unsafely-without-email 2>&1 | while IFS= read -r l; do echo "  $l" >&2; done; then
    success "SSL-Zertifikat eingerichtet!"
  else
    warn "Certbot fehlgeschlagen. Bitte manuell: sudo certbot ${plugin} -d ${domain} -d ${rtc_domain}"
  fi
}

configure_external_proxy() {
  local webserver="$1" domain="$2" local_port="$3" rtc_domain="$4" lk_port="${5:-7880}"

  echo "" >&2
  header "Reverse-Proxy Konfiguration"

  local ws_label=""
  case "$webserver" in
    nginx)  ws_label="Nginx" ;;
    apache) ws_label="Apache" ;;
    caddy)  ws_label="Caddy" ;;
    *)      ws_label="" ;;
  esac

  if [[ -n "$ws_label" ]]; then
    echo "" >&2
    success "Bestehender Webserver erkannt: ${ws_label}"
    echo "" >&2
    echo -e "  Soll die Proxy-Konfiguration fuer" >&2
    echo -e "  ${BOLD}${domain}${RESET} und ${BOLD}${rtc_domain}${RESET}" >&2
    echo -e "  automatisch in ${ws_label} eingetragen werden?" >&2
    echo -e "  ${DIM}(Bestehende Konfiguration wird NICHT veraendert â€“ nur eine neue Datei angelegt)${RESET}" >&2
    echo "" >&2
    printf "  ${BOLD}%s${RESET} (j/n) [j]: " "Automatisch konfigurieren?" >&2
    read -r auto_yn
    auto_yn="${auto_yn:-j}"

    if [[ "${auto_yn,,}" =~ ^(j|y|ja|yes)$ ]]; then
      local configure_ok=false
      case "$webserver" in
        nginx)  configure_nginx_reverse_proxy "$domain" "$local_port" "$rtc_domain" "$lk_port" && configure_ok=true ;;
        apache) configure_apache_reverse_proxy "$domain" "$local_port" "$rtc_domain" "$lk_port" && configure_ok=true ;;
        caddy)  configure_caddy_reverse_proxy "$domain" "$local_port" "$rtc_domain" "$lk_port" && configure_ok=true ;;
      esac

      if $configure_ok; then
        offer_certbot_ssl "$domain" "$rtc_domain" "$webserver"
        return 0
      fi
      warn "Automatische Konfiguration fehlgeschlagen. Zeige manuelle Anleitungâ€¦"
    fi
  fi

  print_manual_proxy_instructions "$domain" "$local_port" "$rtc_domain" "$lk_port"
  offer_certbot_ssl "$domain" "$rtc_domain" "$webserver"
}


spinner() {
  local pid=$1 msg="$2" i=0
  local frames=('â ‹' 'â ™' 'â ¹' 'â ¸' 'â ¼' 'â ´' 'â ¦' 'â §' 'â ‡' 'â ')
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET}  %s  " "${frames[$((i % 10))]}" "$msg"
    sleep 0.08; (( i++ ))
  done
  printf "\r  ${GREEN}âœ“${RESET}  %-50s\n" "$msg"
}

wait_for_api() {
  local url="$1" max_seconds=120 elapsed=0
  info "Warte auf API ($url)â€¦"
  while ! curl -s --max-time 3 "$url" >/dev/null 2>&1; do
    sleep 3; elapsed=$(( elapsed + 3 ))
    if (( elapsed >= max_seconds )); then
      error "API antwortet nicht nach ${max_seconds}s."
      error "Logs prÃ¼fen:  $COMPOSE_BIN logs backend"
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

# â”€â”€ Docker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ensure_docker() {
  if ! command -v docker &>/dev/null; then
    warn "Docker nicht gefunden. Installiere Dockerâ€¦"
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
    warn "Docker Compose Plugin nicht gefunden. Installiereâ€¦"
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

# â”€â”€ VAPID Keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#   --status : Health Check & Diagnostics
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
run_status() {
  banner
  header "Singra Vox â€“ System-Status"
  echo ""

  local ok=0 warn_count=0 fail=0

  # â”€â”€ Installation vorhanden?
  if [[ -d "$DATA_DIR" ]]; then
    success "Installation gefunden: $DATA_DIR"
    (( ok++ ))
  else
    error "Keine Installation gefunden in $DATA_DIR"
    echo -e "  ${DIM}Tipp: bash install.sh ausfÃ¼hren${RESET}"
    exit 1
  fi

  # â”€â”€ .env vorhanden?
  if [[ -f "$DATA_DIR/.env" ]]; then
    success ".env Konfiguration vorhanden"
    (( ok++ ))
  else
    error ".env fehlt in $DATA_DIR"
    (( fail++ ))
  fi

  # â”€â”€ Docker / Compose?
  if command -v docker &>/dev/null; then
    success "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
    (( ok++ ))
  else
    error "Docker nicht installiert"
    (( fail++ ))
  fi

  if detect_compose; then
    success "Docker Compose verfÃ¼gbar"
    (( ok++ ))
  else
    error "Docker Compose nicht gefunden"
    (( fail++ ))
  fi

  # â”€â”€ Container-Status
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

  # â”€â”€ Konfiguration prÃ¼fen
  echo ""
  header "Konfigurations-Check"
  if [[ -f "$DATA_DIR/.env" ]]; then
    local missing_vars=()

    # Pflicht-Variablen prÃ¼fen
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
      warn "INSTANCE_ENCRYPTION_SECRET fehlt â€“ Daten werden unverschlÃ¼sselt gespeichert!"
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
      warn "SMTP nicht konfiguriert â€“ E-Mail-Verifizierung deaktiviert"
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

  # â”€â”€ API Health Check
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

  # â”€â”€ Disk Space
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
      warn "Speicherplatz: $disk_avail frei (${disk_percent}% belegt) â€“ Bitte aufrÃ¤umen"
      (( warn_count++ ))
    else
      error "Speicherplatz kritisch: $disk_avail frei (${disk_percent}% belegt)"
      (( fail++ ))
    fi
  fi

  # â”€â”€ Auto-Update Status
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

  # â”€â”€ Summary
  echo ""
  divider
  echo ""
  echo -e "  ${GREEN}âœ“ $ok OK${RESET}   ${YELLOW}! $warn_count Warnung(en)${RESET}   ${RED}âœ— $fail Fehler${RESET}"
  echo ""

  if [[ "$fail" -gt 0 ]]; then
    echo -e "  ${BOLD}Empfehlung:${RESET} bash install.sh --repair"
  elif [[ "$warn_count" -gt 0 ]]; then
    echo -e "  ${BOLD}Hinweis:${RESET} Einige Warnungen gefunden. PrÃ¼fe die Details oben."
  else
    echo -e "  ${BOLD}${GREEN}Alles in Ordnung!${RESET}"
  fi
  echo ""
  divider
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#   --repair : Detect and fix broken configuration
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
run_repair() {
  banner
  header "Singra Vox â€“ Reparatur-Modus"
  echo ""
  echo "  PrÃ¼fe bestehende Installation und behebe Probleme automatischâ€¦"
  echo ""

  local fixed=0 skipped=0

  # â”€â”€ PrÃ¼fe ob Installation existiert
  if [[ ! -d "$DATA_DIR" ]]; then
    error "Keine Installation gefunden in $DATA_DIR"
    echo -e "  ${DIM}Bitte zuerst installieren: bash install.sh${RESET}"
    exit 1
  fi

  # â”€â”€ Docker prÃ¼fen
  header "1/7 Docker prÃ¼fen"
  ensure_docker

  # â”€â”€ .env prÃ¼fen & reparieren
  header "2/7 Konfiguration prÃ¼fen"
  if [[ ! -f "$DATA_DIR/.env" ]]; then
    error ".env fehlt. Kann nicht automatisch erstellt werden."
    echo -e "  ${DIM}Bitte neu installieren: bash install.sh${RESET}"
    exit 1
  fi

  # JWT_SECRET prÃ¼fen
  local jwt_val
  jwt_val=$(grep "^JWT_SECRET=" "$DATA_DIR/.env" | cut -d'=' -f2-)
  if [[ -z "$jwt_val" || ${#jwt_val} -lt 16 ]]; then
    warn "JWT_SECRET fehlt oder zu kurz. Generiere neuenâ€¦"
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

  # INSTANCE_ENCRYPTION_SECRET prÃ¼fen
  local enc_val
  enc_val=$(grep "^INSTANCE_ENCRYPTION_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -z "$enc_val" ]]; then
    warn "INSTANCE_ENCRYPTION_SECRET fehlt. Generiereâ€¦"
    local new_enc; new_enc=$(gen_secret)
    echo "INSTANCE_ENCRYPTION_SECRET=$new_enc" >> "$DATA_DIR/.env"
    success "INSTANCE_ENCRYPTION_SECRET generiert"
    warn "WICHTIG: Diesen SchlÃ¼ssel SICHER aufbewahren! Ohne ihn sind alle Daten verloren."
    echo -e "  ${BOLD}$new_enc${RESET}"
    (( fixed++ ))
  else
    success "INSTANCE_ENCRYPTION_SECRET OK"
    (( skipped++ ))
  fi

  # DB_NAME prÃ¼fen
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

  # SVID_ISSUER prÃ¼fen â€“ Default auf voxid.mauntingstudios.de
  local svid_val
  svid_val=$(grep "^SVID_ISSUER=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -z "$svid_val" ]]; then
    if grep -q "^SVID_ISSUER=" "$DATA_DIR/.env"; then
      sed -i "s|^SVID_ISSUER=.*|SVID_ISSUER=https://voxid.mauntingstudios.de|" "$DATA_DIR/.env"
    else
      echo "SVID_ISSUER=https://voxid.mauntingstudios.de" >> "$DATA_DIR/.env"
    fi
    success "SVID_ISSUER Default gesetzt: https://voxid.mauntingstudios.de"
    (( fixed++ ))
  else
    success "SVID_ISSUER OK: $svid_val"
    (( skipped++ ))
  fi

  # â”€â”€ Docker Compose Datei prÃ¼fen
  header "3/7 Docker Compose prÃ¼fen"
  if [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    success "docker-compose.yml vorhanden"
    (( skipped++ ))
  else
    warn "docker-compose.yml fehlt"
    echo -e "  ${DIM}Bitte neu installieren: bash install.sh${RESET}"
    (( fixed++ ))
  fi

  # â”€â”€ LiveKit Config prÃ¼fen
  header "4/7 LiveKit-Konfiguration prÃ¼fen"
  local lk_key lk_secret
  lk_key=$(grep "^LIVEKIT_API_KEY=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  lk_secret=$(grep "^LIVEKIT_API_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -n "$lk_key" && -n "$lk_secret" ]]; then
    # PrÃ¼fe ob livekit.yaml existiert und konsistent ist
    if [[ -f "$DATA_DIR/livekit.yaml" ]]; then
      if grep -q "$lk_key" "$DATA_DIR/livekit.yaml"; then
        success "LiveKit-Konfiguration konsistent"
        (( skipped++ ))
      else
        warn "livekit.yaml passt nicht zu .env â€“ regeneriereâ€¦"
        write_livekit_config "$lk_key" "$lk_secret"
        success "livekit.yaml aktualisiert"
        (( fixed++ ))
      fi
    else
      info "livekit.yaml fehlt â€“ erstelleâ€¦"
      write_livekit_config "$lk_key" "$lk_secret"
      success "livekit.yaml erstellt"
      (( fixed++ ))
    fi
  else
    info "LiveKit nicht konfiguriert (Voice/Video deaktiviert)"
    (( skipped++ ))
  fi

  # â”€â”€ Berechtigungen prÃ¼fen
  header "5/7 Dateiberechtigungen prÃ¼fen"
  if [[ -f "$DATA_DIR/.env" ]]; then
    local env_perms
    env_perms=$(stat -c '%a' "$DATA_DIR/.env" 2>/dev/null)
    if [[ "$env_perms" == "600" ]]; then
      success ".env Berechtigungen OK (600)"
      (( skipped++ ))
    else
      chmod 600 "$DATA_DIR/.env"
      success ".env Berechtigungen korrigiert: $env_perms â†’ 600"
      (( fixed++ ))
    fi
  fi

  # â”€â”€ Container starten falls gestoppt
  header "6/7 Container prÃ¼fen"
  if [[ -f "$DATA_DIR/docker-compose.yml" ]]; then
    cd "$DATA_DIR"
    local running
    running=$($COMPOSE_BIN ps --status running -q 2>/dev/null | wc -l)
    if [[ "$running" -eq 0 ]]; then
      warn "Keine Container laufen. Starteâ€¦"
      $COMPOSE_BIN up -d 2>&1 | tail -5
      success "Container gestartet"
      (( fixed++ ))
    else
      success "$running Container laufen"
      (( skipped++ ))

      # PrÃ¼fe ob wichtige Container fehlen
      local expected_services=("mongodb" "backend" "frontend")
      for svc in "${expected_services[@]}"; do
        if $COMPOSE_BIN ps "$svc" 2>/dev/null | grep -q "running\|Up"; then
          success "$svc lÃ¤uft"
        else
          warn "$svc nicht gestartet â€“ versuche Neustartâ€¦"
          $COMPOSE_BIN up -d "$svc" 2>&1 | tail -3
          (( fixed++ ))
        fi
      done
    fi
  fi

  # â”€â”€ Source-Dateien aktuell?
  header "7/7 Build-Kontext prÃ¼fen"
  if [[ -d "$DATA_DIR/backend_src" ]]; then
    success "Backend Source vorhanden"
    (( skipped++ ))
  else
    warn "Backend Source fehlt â€“ kopiereâ€¦"
    prepare_build_context
    (( fixed++ ))
  fi

  # â”€â”€ Ergebnis
  echo ""
  divider
  echo ""
  if [[ "$fixed" -gt 0 ]]; then
    echo -e "  ${GREEN}âœ“ $fixed Problem(e) behoben${RESET}, $skipped bereits OK"
    echo ""
    echo -e "  ${BOLD}Empfehlung:${RESET} Container neu starten fÃ¼r volle Wirkung:"
    echo -e "  ${DIM}cd $DATA_DIR && $COMPOSE_BIN restart${RESET}"
  else
    echo -e "  ${GREEN}${BOLD}Alles in Ordnung!${RESET} Keine Reparaturen nÃ¶tig."
  fi
  echo ""
  divider
}

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#   --identity : Set up Singra Vox ID (optional)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
run_identity_setup() {
  banner
  header "Singra Vox ID â€“ Identity Server einrichten"
  echo ""
  echo "  Singra Vox ID ermÃ¶glicht EIN Konto Ã¼ber ALLE Instanzen hinweg."
  echo "  Ã„hnlich wie 'Login mit Google' â€“ aber komplett selbst gehostet."
  echo ""
  echo -e "  ${BOLD}Zwei Optionen:${RESET}"
  echo ""
  echo -e "  ${BOLD}1) Integriert${RESET} â€“ Teil deiner bestehenden Singra Vox Instanz"
  echo "     â†’ Einfachste Option: SVID lÃ¤uft auf dem gleichen Server"
  echo "     â†’ Nutzer kÃ¶nnen sich mit Singra Vox ID auf DEINER Instanz registrieren"
  echo "     â†’ Andere Instanzen kÃ¶nnen deine als ID-Server nutzen"
  echo ""
  echo -e "  ${BOLD}2) Standalone${RESET} â€“ Eigener Server nur fÃ¼r Identity"
  echo "     â†’ Empfohlen fÃ¼r: Mehrere Instanzen, zentraler ID-Server"
  echo "     â†’ Braucht eigene Domain (z.B. id.deine-domain.de)"
  echo "     â†’ Minimale Ressourcen (512 MB RAM)"
  echo ""

  local choice; choice=$(ask "Option wÃ¤hlen" "1")

  if [[ "$choice" == "1" ]]; then
    # â”€â”€ Integrierter Modus
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
        echo ""; info "Keine Ã„nderungen vorgenommen."; return
      fi
    fi

    local svid_url
    svid_url=$(ask "Ã–ffentliche URL deiner Instanz (wird der SVID Issuer)" "$current_frontend")

    local svid_secret
    svid_secret=$(gen_secret)

    # In .env eintragen
    if grep -q "^SVID_ISSUER=" "$DATA_DIR/.env"; then
      sed -i "s|^SVID_ISSUER=.*|SVID_ISSUER=$svid_url|" "$DATA_DIR/.env"
    else
      echo "SVID_ISSUER=$svid_url" >> "$DATA_DIR/.env"
    fi

    if grep -q "^SVID_JWT_SECRET=" "$DATA_DIR/.env"; then
      # Nur Ã¼berschreiben wenn leer
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
    echo -e "  ${BOLD}SVID JWT Secret:${RESET}  ${svid_secret:0:8}â€¦"
    echo ""
    echo -e "  ${BOLD}NÃ¤chster Schritt:${RESET}"
    echo "  Backend neu starten, damit die Ã„nderungen wirksam werden:"
    echo -e "  ${DIM}cd $DATA_DIR && $COMPOSE_BIN restart backend${RESET}"
    echo ""
    echo "  Danach kÃ¶nnen Nutzer sich unter /svid-register mit Singra Vox ID"
    echo "  registrieren, und andere Instanzen kÃ¶nnen deine als ID-Server nutzen."

  elif [[ "$choice" == "2" ]]; then
    # â”€â”€ Standalone Modus
    echo ""
    header "Standalone Identity Server"
    echo ""
    echo "  FÃ¼r einen dedizierten Identity Server auf einem eigenen Server"
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
    echo "     (+ SMTP-Konfiguration fÃ¼r E-Mail-Verifizierung)"
    echo ""
    echo "  3. Starten:"
    echo "     uvicorn identity_server:app --host 0.0.0.0 --port 8002 --workers 2"
    echo ""
    echo "  4. Reverse Proxy (Caddy/nginx) mit SSL einrichten"
    echo ""
    echo "  5. Auf jeder Instanz in .env eintragen:"
    echo "     SVID_ISSUER=https://id.deine-domain.de"
    echo "     SVID_JWT_SECRET=<gleicher-schlÃ¼ssel-wie-id-server>"
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

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#   --auto-update-on / --auto-update-off
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
run_auto_update_on() {
  banner
  header "Auto-Update aktivieren"
  echo ""
  echo "  Das Auto-Update prÃ¼ft tÃ¤glich um 04:00 Uhr auf neue Versionen"
  echo "  und aktualisiert automatisch. Deine Konfiguration bleibt erhalten."
  echo ""

  local schedule
  schedule=$(ask "Cron-Zeitplan (Standard: tÃ¤glich 04:00)" "0 4 * * *")

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

# â”€â”€ Write config files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
SVID_ISSUER=https://voxid.mauntingstudios.de
SVID_JWT_SECRET=
EOF
  chmod 600 "$DATA_DIR/.env"

  # INSTANCE_ENCRYPTION_SECRET Warnung
  echo ""
  warn "WICHTIG: VerschlÃ¼sselungsschlÃ¼ssel sicher aufbewahren!"
  echo -e "  ${BOLD}INSTANCE_ENCRYPTION_SECRET:${RESET}"
  echo -e "  ${DIM}$encryption_secret${RESET}"
  echo -e "  ${RED}Ohne diesen SchlÃ¼ssel sind alle Daten unwiderruflich verloren!${RESET}"
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

write_docker_compose_reverse_proxy() {
  local local_port="$1" lk_signal_port="${2:-7880}"
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
      - "127.0.0.1:LK_SIGNAL_PLACEHOLDER:7880"
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
      - "127.0.0.1:LOCAL_PORT_PLACEHOLDER:80"
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

  sed -i "s/LOCAL_PORT_PLACEHOLDER/$local_port/" "$DATA_DIR/docker-compose.yml"
  sed -i "s/LK_SIGNAL_PLACEHOLDER/$lk_signal_port/" "$DATA_DIR/docker-compose.yml"
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

# â”€â”€ Copy source files for Docker build â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
prepare_build_context() {
  info "Kopiere Quellcode nach $DATA_DIRâ€¦"

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

# â”€â”€ Bootstrap admin account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
bootstrap_admin() {
  local api_url="$1"
  local instance_name="$2"
  local admin_email="$3"
  local admin_user="$4"
  local admin_pass="$5"
  local admin_display="$6"
  local allow_signup="$7"

  info "Erstelle Admin-Accountâ€¦"

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

# â”€â”€ SMTP Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
configure_smtp() {
  echo "" >&2
  header "E-Mail Konfiguration" >&2
  echo "  Singra Vox benÃ¶tigt E-Mail fÃ¼r RegistrierungsbestÃ¤tigung." >&2
  echo "" >&2
  echo -e "  ${BOLD}1)${RESET} Eingebaut (Mailpit) â€” Alle E-Mails im Browser sichtbar" >&2
  echo "     Empfohlen fÃ¼r Tests und private Server" >&2
  echo "" >&2
  echo -e "  ${BOLD}2)${RESET} Resend â€” API-basiert, einfach einzurichten" >&2
  echo "     Kostenlos bis 3.000 E-Mails/Monat, nur API-Key nÃ¶tig" >&2
  echo "" >&2
  echo -e "  ${BOLD}3)${RESET} Gmail â€” Google App-Passwort" >&2
  echo "     Voraussetzung: 2FA aktiv + App-Passwort erstellt" >&2
  echo "" >&2
  echo -e "  ${BOLD}4)${RESET} Mailgun â€” Transaktionale E-Mails" >&2
  echo "     Domain-Verifizierung erforderlich" >&2
  echo "" >&2
  echo -e "  ${BOLD}5)${RESET} Manuell â€” Eigene SMTP-Zugangsdaten eingeben" >&2
  echo "" >&2

  local choice
  printf "  ${BOLD}%s${RESET} [%s]: " "Wahl" "1" >&2
  read -r choice
  choice="${choice:-1}"

  local smtp_host smtp_port smtp_user smtp_pass smtp_from smtp_tls smtp_ssl

  while true; do
    case "$choice" in
      2)
        # â”€â”€ Resend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        echo "" >&2
        echo -e "  ${DIM}Resend API-Key findest du unter: https://resend.com/api-keys${RESET}" >&2
        printf "  ${BOLD}%s${RESET}: " "Resend API-Key (re_...)" >&2
        read -r smtp_pass
        printf "  ${BOLD}%s${RESET}: " "Absender E-Mail (z.B. noreply@deine-domain.de)" >&2
        read -r smtp_from
        smtp_host="smtp.resend.com"; smtp_port="587"
        smtp_user="resend"; smtp_tls="true"; smtp_ssl="false"
        ;;
      3)
        # â”€â”€ Gmail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        echo "" >&2
        echo -e "  ${DIM}App-Passwort erstellen: Google-Konto â†’ Sicherheit â†’ 2FA â†’ App-PasswÃ¶rter${RESET}" >&2
        printf "  ${BOLD}%s${RESET}: " "Gmail-Adresse" >&2
        read -r smtp_user
        printf "  ${BOLD}%s${RESET}: " "App-Passwort (16 Zeichen ohne Leerzeichen)" >&2
        read -r smtp_pass
        smtp_host="smtp.gmail.com"; smtp_port="587"
        smtp_from="$smtp_user"; smtp_tls="true"; smtp_ssl="false"
        ;;
      4)
        # â”€â”€ Mailgun â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        echo "" >&2
        printf "  ${BOLD}%s${RESET} [%s]: " "Mailgun Region" "EU" >&2
        read -r mg_region; mg_region="${mg_region:-EU}"
        if [[ "${mg_region,,}" == "eu" ]]; then
          smtp_host="smtp.eu.mailgun.org"
        else
          smtp_host="smtp.mailgun.org"
        fi
        printf "  ${BOLD}%s${RESET}: " "SMTP-Benutzername (z.B. postmaster@mg.deine-domain.de)" >&2
        read -r smtp_user
        printf "  ${BOLD}%s${RESET}: " "SMTP-Passwort" >&2
        read -r smtp_pass
        printf "  ${BOLD}%s${RESET} [%s]: " "Absender E-Mail" "$smtp_user" >&2
        read -r smtp_from; smtp_from="${smtp_from:-$smtp_user}"
        smtp_port="587"; smtp_tls="true"; smtp_ssl="false"
        ;;
      5)
        # â”€â”€ Manuell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        echo "" >&2
        printf "  ${BOLD}%s${RESET}: " "SMTP Server" >&2
        read -r smtp_host
        printf "  ${BOLD}%s${RESET} [%s]: " "SMTP Port" "587" >&2
        read -r smtp_port; smtp_port="${smtp_port:-587}"
        printf "  ${BOLD}%s${RESET}: " "SMTP Benutzername" >&2
        read -r smtp_user
        printf "  ${BOLD}%s${RESET}: " "SMTP Passwort" >&2
        read -r smtp_pass
        printf "  ${BOLD}%s${RESET} [%s]: " "Absender E-Mail" "$smtp_user" >&2
        read -r smtp_from; smtp_from="${smtp_from:-$smtp_user}"
        smtp_tls="true"; smtp_ssl="false"
        if [[ "$smtp_port" == "465" ]]; then smtp_ssl="true"; smtp_tls="false"; fi
        ;;
      *)
        # â”€â”€ Mailpit (Default) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        echo "mailpit|1025|||no-reply@singravox.local|false|false"
        return
        ;;
    esac

    # â”€â”€ SMTP-Verbindungstest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    echo "" >&2
    info "Teste SMTP-Verbindung zu ${smtp_host}:${smtp_port}â€¦" >&2
    local test_result
    test_result=$(python3 -c "
import smtplib, sys
host, port = '$smtp_host', int('$smtp_port')
user, pw = '$smtp_user', '$smtp_pass'
use_tls = '$smtp_tls' == 'true'
use_ssl = '$smtp_ssl' == 'true'
try:
    if use_ssl:
        s = smtplib.SMTP_SSL(host, port, timeout=10)
    else:
        s = smtplib.SMTP(host, port, timeout=10)
        if use_tls:
            s.starttls()
    if user:
        s.login(user, pw)
    s.quit()
    print('OK')
except Exception as e:
    print(f'FAIL:{e}')
" 2>&1)

    if [[ "$test_result" == "OK" ]]; then
      success "SMTP-Verbindung erfolgreich!" >&2
      break
    else
      local err_msg="${test_result#FAIL:}"
      error "SMTP-Verbindung fehlgeschlagen: ${err_msg}" >&2
      echo "" >&2
      printf "  ${BOLD}%s${RESET} (j/n) [j]: " "Zugangsdaten erneut eingeben?" >&2
      read -r retry
      retry="${retry:-j}"
      if [[ ! "${retry,,}" =~ ^(j|y|ja|yes)$ ]]; then
        warn "Fahre ohne gÃ¼ltige SMTP-Konfiguration fort. E-Mails werden nicht funktionieren." >&2
        break
      fi
      echo "" >&2
    fi
  done

  echo "$smtp_host|$smtp_port|$smtp_user|$smtp_pass|$smtp_from|$smtp_tls|$smtp_ssl"
}

# â”€â”€ Update Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  info "Konfiguration (.env) wird beibehalten â€“ alle Einstellungen bleiben erhalten."
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
    info "Lade neuesten Code von GitHubâ€¦"
    cd "$REPO_DIR"
    local current_hash new_hash
    current_hash=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null \
      || warn "git pull fehlgeschlagen. Fahre mit lokalem Code fort."
    new_hash=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

    if [[ "$current_hash" == "$new_hash" ]]; then
      info "Bereits auf dem neuesten Stand ($current_hash)"
    else
      success "Code aktualisiert: ${current_hash:0:8} â†’ ${new_hash:0:8}"
    fi
  fi

  # Check if INSTANCE_ENCRYPTION_SECRET exists (repair on update)
  local enc_val
  enc_val=$(grep "^INSTANCE_ENCRYPTION_SECRET=" "$DATA_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
  if [[ -z "$enc_val" ]]; then
    warn "INSTANCE_ENCRYPTION_SECRET fehlt â€“ generiere neuen SchlÃ¼sselâ€¦"
    local new_enc; new_enc=$(gen_secret)
    echo "INSTANCE_ENCRYPTION_SECRET=$new_enc" >> "$DATA_DIR/.env"
    success "INSTANCE_ENCRYPTION_SECRET generiert"
    warn "WICHTIG: SchlÃ¼ssel sicher aufbewahren: $new_enc"
  fi

  # Re-prepare build context with updated source
  prepare_build_context

  # Rebuild images
  info "Baue neue Docker-Imagesâ€¦"
  cd "$DATA_DIR"
  $COMPOSE_BIN build --quiet 2>&1 | tail -3 || true
  success "Images gebaut"

  # Rolling restart (backend first, then frontend)
  info "Starte Dienste neuâ€¦"
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

# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#   Main Install
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
main() {
  # â”€â”€ Flag-Erkennung â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        echo "    --repair            Konfiguration prÃ¼fen & reparieren"
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

  # â”€â”€ Bestehende Installation erkennen
  if [[ -d "$DATA_DIR" && -f "$DATA_DIR/.env" && -f "$DATA_DIR/docker-compose.yml" ]]; then
    echo ""
    warn "Bestehende Installation erkannt in $DATA_DIR"
    echo ""
    echo -e "  ${BOLD}1)${RESET} Neu installieren (Konfiguration wird Ã¼berschrieben!)"
    echo -e "  ${BOLD}2)${RESET} Reparieren (Konfiguration bleibt erhalten)"
    echo -e "  ${BOLD}3)${RESET} Update (Konfiguration bleibt erhalten, neuster Code)"
    echo -e "  ${BOLD}4)${RESET} Abbrechen"
    echo ""
    local reinstall_choice; reinstall_choice=$(ask "Wahl" "2")
    case "$reinstall_choice" in
      2) run_repair; return ;;
      3) run_update; return ;;
      4) info "Abgebrochen."; return ;;
      1) warn "Fahre mit Neuinstallation fortâ€¦" ;;
    esac
  fi

  # â”€â”€ OS Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if [[ "$(uname -s)" != "Linux" ]]; then
    error "Dieser Installer unterstÃ¼tzt nur Linux."
    exit 1
  fi

  if [[ "$EUID" -ne 0 ]] && ! groups | grep -q docker 2>/dev/null; then
    warn "Nicht root und nicht in der Docker-Gruppe. Einige Befehle kÃ¶nnten sudo benÃ¶tigen."
  fi

  # â”€â”€ Storage Mode (Lite vs Full) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Speicher-Modus (E2EE Datei-Uploads)"
  local total_ram_mb; total_ram_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 2048)
  echo ""
  echo -e "  ${BOLD}1) Lite-Modus${RESET}  â€” Lokales Dateisystem (kein MinIO, ~50 MB RAM)"
  echo "     Ideal fÃ¼r: VPS mit 1-2 GB RAM, kleine Instanzen"
  echo ""
  echo -e "  ${BOLD}2) Voll-Modus${RESET}  â€” MinIO S3-kompatibler Storage (~200 MB RAM)"
  echo "     Ideal fÃ¼r: Server mit 4+ GB RAM, groÃŸe Instanzen, S3-Backups"
  echo ""
  if [[ $total_ram_mb -lt 3000 ]]; then
    warn "Erkannter RAM: ${total_ram_mb} MB â†’ Lite-Modus empfohlen"
    local storage_default="1"
  else
    info "Erkannter RAM: ${total_ram_mb} MB"
    local storage_default="2"
  fi
  local storage_mode; storage_mode=$(ask "WÃ¤hle 1 oder 2" "$storage_default")

  # â”€â”€ Worker-Anzahl (CPU-basiert) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  local cpu_cores; cpu_cores=$(nproc 2>/dev/null || echo 1)
  local workers=1
  if [[ $cpu_cores -ge 4 ]]; then
    workers=2
  fi
  info "CPU-Kerne: ${cpu_cores} â†’ Backend-Workers: ${workers}"

  # â”€â”€ Mode Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Installations-Modus"

  # Auto-Erkennung: Sind Port 80/443 belegt?
  local port_80_busy=false port_443_busy=false recommended_mode="1"
  if ! is_port_free 80; then port_80_busy=true; fi
  if ! is_port_free 443; then port_443_busy=true; fi

  if $port_80_busy || $port_443_busy; then
    echo ""
    if $port_80_busy; then warn "Port 80 ist bereits belegt."; fi
    if $port_443_busy; then warn "Port 443 ist bereits belegt."; fi
    info "Modus 3 (Reverse Proxy) wird empfohlen."
    recommended_mode="3"
  fi

  echo ""
  echo -e "  ${BOLD}1) Schnellstart${RESET}  â€” HTTP, Ã¼ber IP oder Domain erreichbar"
  echo "     Ideal fÃ¼r: Tests, privates Netzwerk"
  echo ""
  echo -e "  ${BOLD}2) Produktiv${RESET}     â€” HTTPS mit eigenem SSL (Caddy, Let's Encrypt)"
  echo "     Voraussetzung: Port 80+443 frei, Domain zeigt auf diesen Server"
  echo ""
  echo -e "  ${BOLD}3) Reverse Proxy${RESET} â€” Hinter bestehendem Webserver (Nginx/Apache/Caddy)"
  echo "     Ideal fÃ¼r: Server mit bestehendem Webserver, geteilte Umgebungen"
  echo ""
  local mode; mode=$(ask "WÃ¤hle 1, 2 oder 3" "$recommended_mode")

  # â”€â”€ Instance Name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Server-Name"
  echo -e "  ${DIM}Der Name, der in der App und bei Einladungen angezeigt wird.${RESET}"
  local instance_name; instance_name=$(ask "Name deiner Singra-Vox-Instanz" "Mein Singra Vox")

  # â”€â”€ Mode-specific config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  local frontend_url cors_origins cookie_secure
  local livekit_internal livekit_public
  local domain rtc_domain http_port api_url compose_flag
  local detected_webserver="" lk_signal_port=""

  if [[ "$mode" == "2" ]]; then
    # â”€â”€ Produktiv-Modus: Domain + SSL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    local public_ip; public_ip=$(get_public_ip)
    echo ""
    header "Domain-Konfiguration"
    echo "" >&2
    info "Erkannte Ã¶ffentliche IP dieses Servers: ${BOLD}${public_ip}${RESET}" >&2
    echo "" >&2
    echo -e "  ${BOLD}Haupt-Domain${RESET} â€” Ãœber diese URL Ã¶ffnen Nutzer die App im Browser." >&2
    echo -e "  ${DIM}Beispiel: chat.deinserver.de â€” muss per A-Record auf ${public_ip} zeigen.${RESET}" >&2
    echo "" >&2
    echo -e "  ${BOLD}Voice-Domain${RESET} â€” Separater Endpunkt fÃ¼r Sprach- & Videoanrufe (LiveKit/WebRTC)." >&2
    echo -e "  ${DIM}Muss eine eigene Subdomain sein (z.B. rtc.deinserver.de), weil${RESET}" >&2
    echo -e "  ${DIM}LiveKit eigene Ports (7881/TCP + 7882/UDP) fÃ¼r Medienstreams braucht.${RESET}" >&2
    echo "" >&2
    echo -e "  ${YELLOW}Beide Domains mÃ¼ssen per DNS (A-Record) auf ${public_ip} zeigen.${RESET}" >&2
    echo "" >&2
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

    # Ports prÃ¼fen und ggf. UFW konfigurieren
    local firewall_ports=(
      "80:HTTP (Caddy / Let's Encrypt)"
      "443:HTTPS (App & API)"
      "7881/tcp:LiveKit Signaling"
      "7882/udp:LiveKit Media (WebRTC)"
    )
    configure_firewall "${firewall_ports[@]}"

  elif [[ "$mode" == "3" ]]; then
    # â”€â”€ Reverse-Proxy-Modus: Hinter bestehendem Webserver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    local public_ip; public_ip=$(get_public_ip)
    echo ""
    header "Domain-Konfiguration"
    echo ""
    info "Erkannte Ã¶ffentliche IP: ${BOLD}${public_ip}${RESET}"
    echo ""
    echo -e "  Dein bestehender Webserver Ã¼bernimmt SSL und leitet Traffic weiter."
    echo -e "  Singra Vox bindet sich nur auf ${BOLD}127.0.0.1${RESET} (lokal erreichbar)."
    echo ""
    domain=$(ask "Haupt-Domain (z.B. chat.example.com)" "")
    if [[ -z "$domain" ]]; then error "Domain darf nicht leer sein."; exit 1; fi
    rtc_domain=$(ask "Voice-Domain (z.B. rtc.example.com)" "rtc.${domain#*.}")

    echo ""
    header "Webserver-Erkennung"
    detected_webserver=$(detect_existing_webserver)
    case "$detected_webserver" in
      nginx)  success "Erkannt: Nginx" ;;
      apache) success "Erkannt: Apache" ;;
      caddy)  success "Erkannt: Caddy (System)" ;;
      *)      info "Kein bekannter Webserver automatisch erkannt." ;;
    esac

    local default_local_port; default_local_port=$(find_free_port 8443)
    http_port=$(ask "Lokaler Port fÃ¼r Singra Vox" "$default_local_port")
    http_port=$(find_free_port "$http_port")

    lk_signal_port=$(find_free_port 7880)

    frontend_url="https://$domain"
    cors_origins="https://$domain,tauri://localhost,http://tauri.localhost"
    cookie_secure="true"
    livekit_internal="ws://livekit:7880"
    livekit_public="wss://$rtc_domain"
    api_url="http://127.0.0.1:$http_port"
    compose_flag="reverse_proxy"

    # Nur WebRTC-Ports brauchen Firewall (App lÃ¤uft lokal)
    local firewall_ports=(
      "7881/tcp:LiveKit Signaling (WebRTC)"
      "7882/udp:LiveKit Media (WebRTC)"
    )
    configure_firewall "${firewall_ports[@]}"

  else
    # â”€â”€ Schnellstart-Modus: IP + HTTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    local public_ip; public_ip=$(get_public_ip)
    echo ""
    header "Netzwerk-Konfiguration"
    echo "" >&2
    info "Erkannte Ã¶ffentliche IP: ${BOLD}${public_ip}${RESET}" >&2
    echo "" >&2
    echo -e "  Du kannst die App direkt Ã¼ber die IP-Adresse erreichen," >&2
    echo -e "  oder eine Domain eingeben, die auf diesen Server zeigt." >&2
    echo "" >&2
    local public_host; public_host=$(ask "IP-Adresse oder Domain" "$public_ip")

    # Port mit automatischer Kollisionserkennung
    local default_port="8080"
    default_port=$(find_free_port "$default_port")
    http_port=$(ask "HTTP Port" "$default_port")
    http_port=$(find_free_port "$http_port")

    domain="$public_host"
    rtc_domain="$public_host"

    frontend_url="http://$public_host:$http_port"
    cors_origins="$frontend_url,http://localhost:$http_port,http://127.0.0.1:$http_port,tauri://localhost,http://tauri.localhost"
    cookie_secure="false"
    livekit_internal="ws://livekit:7880"
    livekit_public="ws://$public_host:7880"
    api_url="http://localhost:$http_port"
    compose_flag="quickstart"

    # LiveKit-Port prÃ¼fen
    local lk_port; lk_port=$(find_free_port 7880)

    # Ports prÃ¼fen und ggf. UFW konfigurieren
    local firewall_ports=(
      "${http_port}:HTTP (Singra Vox App)"
      "${lk_port}:LiveKit Signaling"
      "7882/udp:LiveKit Media (WebRTC)"
    )
    configure_firewall "${firewall_ports[@]}"
  fi

  # â”€â”€ SMTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  local smtp_config; smtp_config=$(configure_smtp)
  IFS='|' read -r smtp_host smtp_port smtp_user smtp_pass smtp_from smtp_tls smtp_ssl <<< "$smtp_config"
  local smtp_builtin=false
  [[ "$smtp_host" == "mailpit" ]] && smtp_builtin=true

  # â”€â”€ Generate secrets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Konfiguration wird erstelltâ€¦"
  info "Generiere SchlÃ¼sselâ€¦"

  local livekit_key="lk$(openssl rand -hex 6)"
  local livekit_secret; livekit_secret="$(gen_secret)"
  local s3_key="singravox"
  local s3_secret; s3_secret="$(gen_secret | head -c 32)"
  local vapid_keys; vapid_keys="$(generate_vapid)"
  local vapid_private; vapid_private="$(echo "$vapid_keys" | cut -d' ' -f1)"
  local vapid_public;  vapid_public="$(echo "$vapid_keys" | cut -d' ' -f2)"

  # â”€â”€ Ensure Docker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "System-Vorbereitung"
  ensure_docker
  mkdir -p "$DATA_DIR"

  # â”€â”€ Write configs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  write_livekit_config "$livekit_key" "$livekit_secret"

  if [[ "$compose_flag" == "production" ]]; then
    write_caddy_config "$domain" "$rtc_domain"
    write_docker_compose_production
  elif [[ "$compose_flag" == "reverse_proxy" ]]; then
    write_nginx_conf
    write_docker_compose_reverse_proxy "$http_port" "$lk_signal_port"
  else
    write_nginx_conf
    write_docker_compose_quickstart "$http_port"
  fi

  success "Konfiguration erstellt in $DATA_DIR"

  # â”€â”€ Reverse-Proxy: Bestehenden Webserver automatisch konfigurieren â”€â”€â”€â”€â”€â”€
  if [[ "$compose_flag" == "reverse_proxy" ]]; then
    configure_external_proxy "$detected_webserver" "$domain" "$http_port" "$rtc_domain" "$lk_signal_port"
  fi

  # â”€â”€ Build / Pull images â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Docker Images"
  prepare_build_context

  info "Baue Images (das kann 2-5 Minuten dauern)â€¦"
  cd "$DATA_DIR"
  $COMPOSE_BIN build --quiet 2>&1 | tail -5 || true
  success "Images fertig"

  # â”€â”€ Start services â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  header "Dienste starten"

  # Stop any existing Singra Vox containers that might block ports
  cd "$DATA_DIR"
  if $COMPOSE_BIN ps --quiet 2>/dev/null | grep -q .; then
    info "Stoppe laufende Singra-Vox-Diensteâ€¦"
    $COMPOSE_BIN down --remove-orphans 2>/dev/null || true
    sleep 2
  fi

  info "Starte alle Diensteâ€¦"
  if ! $COMPOSE_BIN up -d 2>&1; then
    # Check if a specific port is blocked
    local failed_port=""
    local _check_ports=(80 443)
    if [[ "$compose_flag" == "reverse_proxy" ]]; then
      _check_ports=("$http_port")
      [[ -n "$lk_signal_port" ]] && _check_ports+=("$lk_signal_port")
    elif [[ "$compose_flag" == "quickstart" ]]; then
      _check_ports=("$http_port")
    fi
    for check_port in "${_check_ports[@]}"; do
      if ! is_port_free "$check_port"; then
        local blocker
        blocker=$(ss -tlnp 2>/dev/null | grep ":${check_port} " | awk '{print $NF}' | head -1)
        failed_port="$check_port"
        error "Port $check_port wird von einem anderen Prozess blockiert: $blocker"
      fi
    done
    if [[ -n "$failed_port" ]]; then
      echo "" >&2
      warn "Singra Vox konnte nicht starten, weil Port(s) blockiert sind." >&2
      echo -e "  ${DIM}MÃ¶gliche LÃ¶sung:${RESET}" >&2
      echo "    sudo systemctl stop caddy nginx apache2 2>/dev/null  # Webserver stoppen" >&2
      echo "    docker stop \$(docker ps -q --filter 'publish=$failed_port')  # Container stoppen" >&2
      echo "" >&2
      echo -e "  Danach erneut starten:" >&2
      echo "    cd $DATA_DIR && $COMPOSE_BIN up -d" >&2
      exit 1
    fi
    error "Dienste konnten nicht gestartet werden. PrÃ¼fe: $COMPOSE_BIN logs"
    exit 1
  fi
  success "Dienste gestartet"

  # â”€â”€ Wait for API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  sleep 5
  wait_for_api "$api_url/api/setup/status"

  # â”€â”€ Admin setup via Web UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  info "Admin-Account wird beim ersten Ã–ffnen der App Ã¼ber den Setup-Wizard erstellt."

  # â”€â”€ Save version info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if [[ -d "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" rev-parse HEAD > "$VERSION_FILE" 2>/dev/null || true
  fi

  # â”€â”€ Optional: Singra Vox ID? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  if ask_yes_no "MÃ¶chtest du Singra Vox ID (Identity Server) einrichten?" "n"; then
    run_identity_setup
  else
    info "Singra Vox ID Ã¼bersprungen. Jederzeit nachholen: bash install.sh --identity"
  fi

  # â”€â”€ Optional: Auto-Update? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  if ask_yes_no "Automatische Updates aktivieren? (tÃ¤glich um 04:00)" "j"; then
    local tmpfile
    tmpfile=$(mktemp)
    crontab -l 2>/dev/null | grep -v "singravox.*install.sh.*--update" > "$tmpfile" || true
    echo "0 4 * * * cd $REPO_DIR && bash install.sh --update >> /var/log/singravox-update.log 2>&1 # singravox-auto-update" >> "$tmpfile"
    crontab "$tmpfile"
    rm -f "$tmpfile"
    success "Auto-Update aktiviert (tÃ¤glich 04:00)"
  fi

  # â”€â”€ Done! â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  echo ""
  divider
  echo ""
  echo -e "${BOLD}${GREEN}  Singra Vox lÃ¤uft!${RESET}"
  echo ""
  echo -e "  ${BOLD}App Ã¶ffnen:${RESET}      $frontend_url"
  echo -e "  ${BOLD}Voice (LiveKit):${RESET} $livekit_public"

  if [[ "$compose_flag" == "reverse_proxy" ]]; then
    echo ""
    echo -e "  ${BOLD}Reverse Proxy:${RESET}   App lauscht auf 127.0.0.1:$http_port"
    echo -e "  ${BOLD}LiveKit Signal:${RESET}  127.0.0.1:${lk_signal_port:-7880}"
    if [[ "$detected_webserver" != "unknown" && -n "$detected_webserver" ]]; then
      success "${detected_webserver^}-Proxy wurde automatisch konfiguriert."
    fi
  fi

  if $smtp_builtin; then
    if [[ "$compose_flag" == "quickstart" ]]; then
      echo -e "  ${BOLD}Mail-Postfach:${RESET}   http://${public_host:-localhost}:8025"
    fi
    warn "SMTP: Eingebautes Mailpit aktiv. E-Mails sind NICHT nach auÃŸen sichtbar."
    warn "FÃ¼r echte E-Mails: .env in $DATA_DIR bearbeiten und SMTP_HOST Ã¤ndern."
  fi

  echo ""
  echo -e "  ${BOLD}NÃ¤chste Schritte:${RESET}"
  echo "  1. App im Browser Ã¶ffnen: $frontend_url"
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
