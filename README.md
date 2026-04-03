# Singra Vox

**Privater, selbst-gehosteter Chat mit Ende-zu-Ende-Verschlüsselung.**
Wie Discord oder TeamSpeak – nur unter deiner Kontrolle. Keine Cloud. Keine Telemetrie. Deine Daten gehören dir.

---

## Installation (1 Befehl)

```bash
bash install.sh
```

Das war's. Der Installer:
- Installiert Docker automatisch (falls nicht vorhanden)
- Fragt 4 Dinge: Name, Admin-E-Mail, Passwort, Modus
- Konfiguriert alles selbstständig
- Startet alle Dienste in Docker
- Erstellt deinen Admin-Account

### Voraussetzungen
- Linux (Ubuntu 22.04+, Debian 12, Rocky Linux 9 empfohlen)
- Min. 1 GB RAM, 10 GB Speicher
- Internetverbindung (für Docker-Images)

### Modi

**Schnellstart (Modus 1)** — für Tests oder privates Netzwerk
```
http://DEINE-IP:8080
```
- Kein SSL-Zertifikat nötig
- Direkt über IP+Port erreichbar
- Funktioniert sofort ohne Domain

**Produktiv (Modus 2)** — für öffentliche Server
```
https://chat.beispiel.de
```
- Automatisches SSL-Zertifikat (Let's Encrypt)
- Eigene Domain erforderlich
- Ports 80 und 443 müssen offen sein

---

## Nach der Installation

1. App im Browser öffnen
2. Mit deinem Admin-Account einloggen
3. Ersten Server erstellen → Kanäle anlegen
4. Freunde per Einladungs-Link einladen

---

## Wichtige Befehle

```bash
# Ins Installations-Verzeichnis wechseln
cd /opt/singravox

# Live-Logs anzeigen
docker compose logs -f

# Neu starten
docker compose restart

# Update (neuen Code pullen + neu bauen)
cd /pfad/zu/singravox && git pull
bash install.sh  # nochmal ausführen

# Stoppen
docker compose down

# Alles löschen (inkl. Daten!)
docker compose down -v
```

---

## Dienste

| Dienst       | Beschreibung                     | Port (intern) |
|-------------|----------------------------------|---------------|
| Backend      | FastAPI REST + WebSocket API     | 8001          |
| Frontend     | React Web-App                    | 80            |
| MongoDB      | Datenbank                        | 27017         |
| LiveKit      | Voice/Video Streaming            | 7880          |
| MinIO        | Verschlüsselte Datei-Speicherung | 9000          |
| Mailpit      | E-Mail-Postfach (Dev-Modus)      | 1025/8025     |
| nginx/Caddy  | Reverse Proxy                    | 80 / 443      |

---

## Konfiguration anpassen

Die Konfiguration liegt in `/opt/singravox/.env`. Nach Änderungen:

```bash
cd /opt/singravox
docker compose restart backend
```

### Wichtige Variablen

```env
# E-Mail (SMTP)
SMTP_HOST=smtp.gmail.com      # SMTP-Server
SMTP_PORT=587                  # Port
SMTP_USERNAME=dein@gmail.com   # Benutzername
SMTP_PASSWORD=app-passwort     # Passwort
SMTP_USE_TLS=true

# Voice (LiveKit)
LIVEKIT_PUBLIC_URL=wss://rtc.beispiel.de  # Öffentliche Voice-URL

# Speicher (S3)
S3_ENDPOINT_URL=http://minio:9000   # Interner MinIO
# Oder: https://s3.amazonaws.com für AWS
```

---

## Firewall-Ports öffnen

```bash
# Schnellstart
ufw allow 8080/tcp   # Web-App
ufw allow 7880/tcp   # LiveKit (Voice)
ufw allow 7882/udp   # LiveKit UDP (Voice-Qualität)

# Produktiv
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp    # HTTP/3
ufw allow 7880/tcp
ufw allow 7882/udp
```

---

## Hetzner / Netcup / Contabo

Getestet auf:
- **Hetzner** CX22 (2 vCPU, 4 GB RAM) — empfohlen für 50+ Benutzer
- **Netcup** VPS 500 — gut für Testinstanzen
- **Contabo** VPS S — günstige Option

**Hetzner Quickstart:**
1. Cloud-Console öffnen → Neuen Server erstellen (Ubuntu 22.04)
2. SSH-Verbindung aufbauen
3. Code klonen:
   ```bash
   git clone https://github.com/DEIN-USER/singra-vox.git
   cd singra-vox
   bash install.sh
   ```
4. Modus 2 wählen → Domain eingeben → Fertig!

---

## E2EE (Ende-zu-Ende-Verschlüsselung)

Singra Vox verschlüsselt Nachrichten in privaten Kanälen **komplett auf deinem Gerät**.
Der Server sieht nur verschlüsselten Ciphertext — niemals den Klartext.

- Schlüssel werden lokal im Browser generiert
- Dateien werden vor dem Upload verschlüsselt und in MinIO gespeichert
- Voice-Kanäle nutzen SFrame E2EE via LiveKit

---

## Support & Community

- GitHub Issues für Bugs und Feature-Requests
- Dokumentation: `/docs/` Ordner
