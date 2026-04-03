# Troubleshooting – Häufige Probleme & Lösungen

## Backend startet nicht

**Symptom:** `docker compose logs backend` zeigt Fehler

```bash
# Logs anzeigen
cd /opt/singravox
docker compose logs backend --tail=50

# Häufige Ursachen:
```

| Fehlermeldung | Ursache | Lösung |
|---|---|---|
| `S3 credentials not configured` | MinIO nicht gestartet | `docker compose up -d minio` |
| `MongoDB connection failed` | MongoDB noch nicht bereit | Kurz warten, dann `docker compose restart backend` |
| `JWT_SECRET not set` | .env fehlt | `cat .env` prüfen, `bash install.sh` erneut ausführen |
| `Address already in use` | Port belegt | `sudo lsof -i :8001` → Prozess beenden |

---

## E-Mail-Verifikation kommt nicht an

```bash
# Im Quickstart-Modus: Mailpit Web-UI öffnen
http://DEINE-IP:8025

# E-Mails manuell anzeigen (API)
curl http://localhost:8025/api/v1/messages
```

Im Produktions-Modus: Prüfe `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME` in `/opt/singravox/.env`.

---

## Voice-Chat funktioniert nicht

**1. Ports prüfen:**
```bash
# Müssen offen sein:
ufw allow 7880/tcp   # LiveKit Signaling
ufw allow 7882/udp   # LiveKit Media (RTP/SRTP)
```

**2. LIVEKIT_PUBLIC_URL prüfen:**
```bash
grep LIVEKIT_PUBLIC_URL /opt/singravox/.env
# Muss die öffentlich erreichbare URL sein:
# Quickstart: ws://DEINE-IP:7880
# Produktion: wss://rtc.beispiel.de
```

**3. LiveKit-Logs:**
```bash
docker compose logs livekit --tail=30
```

---

## Dateien können nicht hochgeladen werden

**Fehler 413:** Datei zu groß
- Max: 50 MB (`MAX_E2EE_BLOB_BYTES` in `.env`)
- nginx: `client_max_body_size 100M` – bereits konfiguriert

**Fehler 403:** Keine Berechtigung
- Rolle des Users prüfen: hat sie `attach_files = true`?
- Server-Einstellungen → Rollen → Berechtigungen prüfen

**MinIO nicht erreichbar:**
```bash
docker compose logs minio --tail=20
docker compose restart minio
```

---

## Admin-Account vergessen / gesperrt

```bash
# Direkt in MongoDB: Passwort zurücksetzen
cd /opt/singravox
docker compose exec mongodb mongosh singravox --eval "
  db.users.updateOne(
    {email: 'admin@beispiel.de'},
    {\$set: {email_verified: true}}
  )
"
# Dann: Passwort-Reset-E-Mail anfordern über /forgot-password
```

---

## Update schlägt fehl

```bash
cd /pfad/zu/singra-vox
git pull
bash install.sh --update

# Falls Build-Fehler:
cd /opt/singravox
docker compose build --no-cache backend
docker compose up -d
```

---

## Desktop-App verbindet sich nicht

1. Server-URL korrekt? → `https://chat.beispiel.de` (kein Slash am Ende)
2. SSL-Zertifikat gültig? → `curl -I https://chat.beispiel.de/api/health`
3. CORS-Fehler in Browser-Konsole? → `CORS_ORIGINS` in `.env` prüfen

---

## Logs prüfen

```bash
cd /opt/singravox

# Alle Services
docker compose logs -f

# Einzelner Service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f livekit
docker compose logs -f minio
docker compose logs -f mailpit

# Letzten 100 Zeilen
docker compose logs --tail=100 backend
```

---

## Kompletter Neustart (Notfall)

```bash
cd /opt/singravox
docker compose down
docker compose up -d
```

> **Achtung:** `docker compose down -v` löscht alle Daten (MongoDB, MinIO, Caddy-Zertifikate)!
