# Singra Vox – Linux-Server Deployment

Schritt-für-Schritt-Anleitung zum Deployment auf einem Linux-VPS.

---

## A. Server vorbereiten

### Voraussetzungen
- Ubuntu 22.04+ oder Debian 12+ (empfohlen)
- Mindestens 1 GB RAM, 1 vCPU, 10 GB Disk
- Root-Zugang oder sudo-Berechtigungen
- Eine Domain (optional, für HTTPS)

### 1. System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Benutzer anlegen (empfohlen)

```bash
sudo adduser singravox
sudo usermod -aG sudo singravox
su - singravox
```

### 3. Firewall einrichten

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 4. SSH absichern (empfohlen)

```bash
# In /etc/ssh/sshd_config:
# PermitRootLogin no
# PasswordAuthentication no  (nach SSH-Key-Setup)
sudo systemctl restart sshd
```

---

## B. Docker einrichten

### 1. Docker installieren

```bash
# Docker GPG Key + Repository
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2. Docker ohne sudo

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Prüfen

```bash
docker --version
docker compose version
docker run hello-world
```

### Wichtige Docker-Befehle

| Befehl | Funktion |
|--------|----------|
| `docker compose up -d` | Starten (im Hintergrund) |
| `docker compose down` | Stoppen |
| `docker compose logs -f` | Logs live ansehen |
| `docker compose logs backend` | Logs eines Services |
| `docker compose restart backend` | Einen Service neu starten |
| `docker compose pull` | Images aktualisieren |
| `docker compose build --no-cache` | Neu bauen |
| `docker ps` | Laufende Container |
| `docker system prune` | Aufräumen |

---

## C. Singra Vox deployen

### 1. Projekt auf den Server bringen

```bash
# Option A: Git Clone
git clone https://your-repo.git /opt/singravox
cd /opt/singravox

# Option B: SCP / rsync
rsync -avz ./singravox/ user@server:/opt/singravox/
```

### 2. Konfiguration

```bash
cd /opt/singravox/deploy
cp .env.example .env
```

**`.env` bearbeiten:**

```bash
nano .env
```

```ini
# MUSS geändert werden:
JWT_SECRET=hier_einen_langen_zufälligen_string_setzen
ADMIN_PASSWORD=ein_sicheres_passwort

# Für Produktion mit Domain:
DOMAIN=singravox.example.com
BACKEND_PUBLIC_URL=https://singravox.example.com
FRONTEND_URL=https://singravox.example.com
CORS_ORIGINS=https://singravox.example.com
```

**JWT_SECRET generieren:**

```bash
openssl rand -hex 64
```

### 3. Starten

**Entwicklung / ohne Domain:**

```bash
cd /opt/singravox/deploy
docker compose up -d
```

Erreichbar unter: `http://server-ip:8080`

**Produktion mit Domain + HTTPS:**

```bash
cd /opt/singravox/deploy
docker compose -f docker-compose.prod.yml up -d
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat. Erreichbar unter: `https://singravox.example.com`

### 4. Logs prüfen

```bash
# Alle Services
docker compose logs -f

# Nur Backend
docker compose logs -f backend

# Nur letzte 50 Zeilen
docker compose logs --tail 50 backend
```

### 5. Erster Login

1. Browser öffnen → `http://server-ip:8080` (oder `https://domain`)
2. Login: E-Mail und Passwort aus `.env` (ADMIN_EMAIL / ADMIN_PASSWORD)
3. Ersten Server erstellen
4. Einladungslinks generieren für andere Nutzer

---

## D. Domain + HTTPS

### Option 1: Caddy (empfohlen, automatisch)

`docker-compose.prod.yml` nutzt Caddy. Einfach `DOMAIN` in `.env` setzen:

```ini
DOMAIN=singravox.example.com
```

**DNS-Eintrag setzen:**
- A-Record: `singravox.example.com` → `Server-IP`

Caddy holt automatisch ein TLS-Zertifikat von Let's Encrypt.

### Option 2: Nginx + Certbot (manuell)

Falls du einen eigenen nginx nutzt:

```nginx
server {
    listen 80;
    server_name singravox.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name singravox.example.com;

    ssl_certificate /etc/letsencrypt/live/singravox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/singravox.example.com/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d singravox.example.com
```

---

## E. Betrieb

### Backups

```bash
# MongoDB-Backup
docker compose exec mongodb mongodump --out /data/backup
docker cp singravox-db:/data/backup ./backup-$(date +%Y%m%d)

# Oder per Cronjob:
0 3 * * * cd /opt/singravox/deploy && docker compose exec -T mongodb mongodump --archive | gzip > /opt/backups/singravox-$(date +\%Y\%m\%d).gz
```

### Restore

```bash
docker cp ./backup-20260330 singravox-db:/data/backup
docker compose exec mongodb mongorestore /data/backup
```

### Neustart

```bash
cd /opt/singravox/deploy
docker compose restart           # Alle Services
docker compose restart backend   # Nur Backend
```

### Updates einspielen

```bash
cd /opt/singravox
git pull                                    # Neue Version holen
cd deploy
docker compose build --no-cache             # Neu bauen
docker compose up -d                        # Starten
docker compose logs -f                      # Logs prüfen
```

### Logs

```bash
# Live-Logs
docker compose logs -f

# Backend-Fehler
docker compose logs backend 2>&1 | grep -i error

# Disk-Usage
docker system df
```

### Datenbankpersistenz

MongoDB-Daten liegen in einem Docker Volume (`mongo_data`). Dieses überlebt Container-Neustarts und Rebuilds.

```bash
# Volume anzeigen
docker volume inspect singravox_mongo_data

# ACHTUNG: Löscht alle Daten!
docker volume rm singravox_mongo_data
```

### Typische Fehlerquellen

| Problem | Lösung |
|---------|--------|
| "Connection refused" | Prüfe ob Container laufen: `docker ps` |
| "502 Bad Gateway" | Backend noch nicht gestartet: `docker compose logs backend` |
| MongoDB startet nicht | Disk voll? `df -h` |
| CORS-Fehler | `CORS_ORIGINS` in `.env` prüfen |
| WebSocket trennt sich | Reverse Proxy Timeout prüfen (nginx: `proxy_read_timeout`) |
| Zertifikat-Fehler | DNS-Eintrag prüfen, Port 80/443 offen? |

---

## Zusammenfassung: Server-Seite vs. Client-Seite

### Server (was du deployest)
- Backend (FastAPI) → Docker Container
- MongoDB → Docker Container
- Reverse Proxy (nginx/Caddy) → Docker Container
- Web-Client → Wird als statischer Build vom Proxy ausgeliefert

### Clients (was Nutzer verwenden)
- **Web-Client**: Öffnet `https://dein-server.de` im Browser
- **Desktop-Client** (Tauri): Wird separat gebaut und installiert, verbindet sich mit `https://dein-server.de`
- Beide Clients nutzen **dieselbe API**
