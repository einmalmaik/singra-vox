# Singra Vox

Eine selbst-gehostete, verschlüsselte Chat-Plattform. Wie Discord – nur unter deiner Kontrolle.

- **Ende-zu-Ende-Verschlüsselung** für Nachrichten und Dateien in privaten Kanälen
- **Voice & Video** über LiveKit (selbst-gehostet)
- **Desktop-App** für Windows, macOS und Linux (Tauri)
- **Kein Cloud-Zwang** – läuft komplett auf deinem Server

---

## Schnellstart

```bash
git clone https://github.com/DEIN_USER/singra-vox.git
cd singra-vox
bash install.sh
```

Der Installer fragt 5 Dinge und richtet alles ein:
1. **Modus** – HTTP (Test) oder HTTPS mit eigener Domain
2. **Server-Name** – z.B. "Mein Singra Vox"
3. **Admin-E-Mail**
4. **Admin-Passwort**
5. **Domain** *(nur bei HTTPS-Modus)*

Danach öffnest du die App im Browser und loggst dich ein.

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

---

## Updates (Server)

```bash
bash install.sh --update
```

Bestehende Konfiguration und Daten bleiben erhalten. Aktive Sessions werden nicht unterbrochen.

---

## Architektur

```
Browser / Desktop-App
        ↓  HTTPS
    nginx / Caddy  ──→  Frontend (React, Port 80)
        ↓  /api/
    FastAPI Backend (Port 8001)
        ├── MongoDB         (Daten)
        ├── MinIO           (verschlüsselte Dateien)
        ├── LiveKit         (Voice/Video)
        └── Mailpit / SMTP  (E-Mail-Verifikation)
```

Alle Services laufen in Docker-Containern und werden von `docker compose` verwaltet.

Technischer Überblick: [`docs/architecture.md`](docs/architecture.md)

---

## Firewall-Ports

| Port     | Protokoll | Zweck                            |
|----------|-----------|----------------------------------|
| 80       | TCP       | HTTP (Weiterleitung auf HTTPS)   |
| 443      | TCP/UDP   | HTTPS + HTTP/3                   |
| 8080     | TCP       | Quickstart-Modus (HTTP)          |
| 7880     | TCP       | LiveKit Voice-Signaling          |
| 7882     | UDP       | LiveKit Voice-Daten (RTP/SRTP)   |

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
| `SMTP_HOST` | SMTP-Server für E-Mail-Verifikation |
| `LIVEKIT_PUBLIC_URL` | Öffentliche URL für Voice-Verbindungen |
| `S3_ENDPOINT_URL` | S3-kompatibler Storage (Standard: internes MinIO) |
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
