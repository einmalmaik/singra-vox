# Singra Vox

Eine selbst-gehostete, verschlüsselte Chat-Plattform. Wie Discord – nur unter deiner Kontrolle.

- **Ende-zu-Ende-Verschlüsselung** für Nachrichten und Dateien in privaten Kanälen
- **Voice & Video** über LiveKit (selbst-gehostet oder LiveKit Cloud)
- **Desktop-App** für Windows, macOS und Linux (Tauri)
- **Kein Cloud-Zwang** – läuft komplett auf deinem Server

---

## Schnellstart

```bash
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox
bash install.sh
```

Der Installer fragt 5 Dinge und richtet alles ein:
1. **Modus** – HTTP (Test) oder HTTPS mit eigener Domain
2. **Server-Name** – z.B. "Mein Singra Vox"
3. **Admin-E-Mail**
4. **Admin-Passwort**
5. **Domain** *(nur bei HTTPS-Modus)*

Danach öffnest du die App im Browser, loggst dich ein und erstellst deinen ersten Server.

### Voraussetzungen
- Linux (Ubuntu 22.04+, Debian 12, Rocky Linux 9)
- Min. 1 GB RAM, 10 GB Freier Speicher
- Internetverbindung beim ersten Start (Docker-Images)

Docker wird automatisch installiert, falls nicht vorhanden.

---

## Desktop-App

Für Windows, macOS und Linux unter [Releases](../../releases) herunterladbar.

Die App verbindet sich zu deinem selbst-gehosteten Server. Beim ersten Start gibst du die Server-URL ein (z.B. `https://chat.beispiel.de`).

**Aktualisierungen** werden automatisch beim App-Start erkannt und können mit einem Klick installiert werden – ohne Datenverlust oder erneutes Einloggen.

### Installer bauen (GitHub Actions)

Beim Pushen eines Tags wird automatisch ein Release gebaut:

```bash
git tag v0.3.0
git push origin v0.3.0
```

GitHub Actions baut dann:
- **Windows** – `.msi` + `.exe` (NSIS)
- **Linux** – `.deb` + `.AppImage`
- **macOS** – `.dmg` (Intel + Apple Silicon)

Voraussetzung: Im GitHub-Repository unter `Settings → Secrets` folgende Secrets hinterlegen:
- `TAURI_SIGNING_PRIVATE_KEY` – Signierungsschlüssel (mit `tauri signer generate` erzeugen)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` – Passwort des Schlüssels

---

## Updates (Server)

```bash
bash install.sh --update
```

Bestehende Konfiguration und Daten bleiben erhalten. Aktive Sessions werden nicht unterbrochen.

---

## E-Mail-Konfiguration (Resend)

Singra Vox unterstützt transaktionale E-Mails über **Resend** (Verifizierungs-Codes, Passwort-Reset).

**Einrichtung:**
1. Account bei [resend.com](https://resend.com) erstellen
2. API-Key generieren
3. Optional: eigene Domain verifizieren (empfohlen für Produktion)

`.env` Variablen:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_DEIN_API_KEY
SMTP_FROM_EMAIL=noreply@deine-domain.de
SMTP_FROM_NAME=Singra Vox
SMTP_USE_TLS=false
SMTP_USE_SSL=true
```

> Ohne verifizierte Domain kann nur von `onboarding@resend.dev` gesendet werden.
> Ohne SMTP-Konfiguration werden neue User automatisch verifiziert (nur für Entwicklung).

---

## Voice & Video (LiveKit)

Singra Vox unterstützt zwei LiveKit-Betriebsmodi:

### Option A: LiveKit Cloud (empfohlen)

1. Account bei [livekit.io](https://livekit.io) → Cloud-Projekt erstellen
2. API-Key und Secret aus dem Dashboard kopieren

```env
LIVEKIT_URL=wss://dein-projekt.livekit.cloud
LIVEKIT_PUBLIC_URL=wss://dein-projekt.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=dein-api-secret
```

### Option B: Selbst-gehostet (Docker)

```env
LIVEKIT_URL=ws://livekit:7880
LIVEKIT_PUBLIC_URL=wss://rtc.deine-domain.de
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=min-32-zeichen-langes-secret!!
```

Port `7880` (TCP) und `7882` (UDP) in der Firewall öffnen.

---

## E2EE-Datei-Uploads (MinIO / S3)

Verschlüsselte Datei-Uploads werden in einem S3-kompatiblen Speicher abgelegt.

**Standard (selbst-gehostet, MinIO):**
```env
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY=singravox
S3_SECRET_KEY=sicheres-passwort
S3_BUCKET=singravox-e2ee
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

**Extern (z.B. AWS S3, Backblaze B2):**
```env
S3_ENDPOINT_URL=https://s3.amazonaws.com
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET=mein-bucket
S3_REGION=eu-central-1
S3_FORCE_PATH_STYLE=false
```

---

## Architektur

```
Browser / Desktop-App
        ↓  HTTPS
    nginx / Caddy  ──→  Frontend (React, Port 80)
        ↓  /api/
    FastAPI Backend (Port 8001)
        ├── MongoDB         (Daten)
        ├── MinIO / S3      (verschlüsselte Dateien)
        ├── LiveKit Cloud   (Voice/Video)
        └── Resend / SMTP   (E-Mail-Verifikation)
```

Alle Services laufen in Docker-Containern und werden von `docker compose` verwaltet.

Technischer Überblick: [`docs/architecture.md`](docs/architecture.md)

---

## Firewall-Ports

| Port     | Protokoll | Zweck                                       |
|----------|-----------|---------------------------------------------|
| 80       | TCP       | HTTP (Weiterleitung auf HTTPS)              |
| 443      | TCP/UDP   | HTTPS + HTTP/3                              |
| 8080     | TCP       | Quickstart-Modus (HTTP)                     |
| 7880     | TCP       | LiveKit Voice-Signaling (nur selbst-gehostet) |
| 7882     | UDP       | LiveKit Voice-Daten (nur selbst-gehostet)   |

> Bei Nutzung von **LiveKit Cloud** sind keine zusätzlichen Ports nötig.

---

## Wichtige Befehle

```bash
cd /opt/singravox

docker compose logs -f          # Live-Logs
docker compose restart backend  # Backend neu starten
docker compose down             # Stoppen
docker compose up -d            # Starten
bash install.sh --update        # Update
```

---

## Konfiguration

Alle Einstellungen in `/opt/singravox/.env`. Nach Änderungen:

```bash
cd /opt/singravox && docker compose restart backend
```

Wichtige Variablen:

| Variable | Bedeutung |
|----------|-----------|
| `SMTP_HOST` | SMTP-Server (z.B. `smtp.resend.com`) |
| `SMTP_PASSWORD` | SMTP-Passwort / API-Key |
| `LIVEKIT_URL` | LiveKit WebSocket URL (Cloud oder selbst-gehostet) |
| `LIVEKIT_API_KEY` | LiveKit API-Key |
| `LIVEKIT_API_SECRET` | LiveKit API-Secret (aus Dashboard) |
| `S3_ENDPOINT_URL` | S3-kompatibler Storage |
| `JWT_SECRET` | Wird beim Install automatisch generiert – nicht ändern! |

---

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| [`docs/architecture.md`](docs/architecture.md) | Code-Struktur, Services, Datenmodelle |
| [`docs/deployment-linux.md`](docs/deployment-linux.md) | VPS-Setup, Firewall, Domain |
| [`docs/docker-setup.md`](docs/docker-setup.md) | Docker-Services, Volumes, Netzwerk |
| [`docs/tauri-guide.md`](docs/tauri-guide.md) | Desktop-App bauen und veröffentlichen |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Release-Prozess, Signing, GitHub Actions |

---

## Mitwirken

Pull Requests sind willkommen. Bitte:
- Neue Features mit Tests absichern (pytest für Backend, Jest für Frontend)
- Permissions über `backend/app/permissions.py` prüfen
- Kein direktes Commit auf `main` – Feature-Branch + PR

---

## Lizenz

MIT – siehe `LICENSE`
