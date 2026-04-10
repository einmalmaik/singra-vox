# Singra Vox – Entwickler-Handbuch (Contributing Guide)

## Inhaltsverzeichnis

1. [Projekt einrichten](#projekt-einrichten)
2. [Code-Architektur-Prinzipien](#code-architektur-prinzipien)
3. [Backend erweitern](#backend-erweitern)
4. [Frontend erweitern](#frontend-erweitern)
5. [Verschlüsselung erweitern](#verschlüsselung-erweitern)
6. [Berechtigungen erweitern](#berechtigungen-erweitern)
7. [Internationalisierung (i18n)](#internationalisierung-i18n)
8. [Tests schreiben](#tests-schreiben)
9. [Code-Konventionen](#code-konventionen)
10. [Audit-Checkliste](#audit-checkliste)

---

## Projekt einrichten

```bash
# Repository klonen
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox

# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Konfigurieren!

# Frontend
cd ../frontend
yarn install

# MongoDB starten (lokal)
mongod --dbpath /data/db

# Backend starten
cd backend && uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend starten
cd frontend && yarn start
```

---

## Code-Architektur-Prinzipien

### 1. Wartbarkeit
- **Modulare Dateien:** Jede Datei hat EINE Verantwortung
- **Zentrale Module:** Verschlüsselung, Berechtigungen, Datenbank – jeweils eine Datei
- **Docstrings:** Jede Funktion/Klasse/Route dokumentiert (Deutsch oder Englisch)

### 2. Wiederverwendbarkeit
- **Verschlüsselung:** `core/encryption.py` – ALLE Module nutzen diese eine Datei
- **Berechtigungen:** `permissions.py` – ALLE Permission-Checks laufen hier durch
- **Auth:** `auth_service.py` – EINE Stelle für Token-Logik
- **DB:** `core/database.py` – EIN geteilter Motor-Client
- **Frontend:** Workspace-CSS-Klassen statt inline Styles

### 3. Skalierbarkeit
- **Neue Routes:** Datei unter `routes/` erstellen, in `main.py` registrieren
- **Neue Verschlüsselung:** encrypt_X/decrypt_X in `encryption.py` hinzufügen
- **Neue Berechtigungen:** Permission-String in `PERMISSIONS` dict hinzufügen
- **Neue Sprache:** JSON-Datei unter `frontend/src/i18n/locales/` erstellen

### 4. Privacy First
- **Kein Klartext in DB/Disk** – INSTANCE_ENCRYPTION_SECRET für at-rest
- **Minimale Metadaten** – nur was für Funktionalität nötig ist
- **Berechtigungsprüfung** vor JEDER Entschlüsselung
- **GDPR-Compliance** – Datenexport und Account-Löschung eingebaut

---

## Backend erweitern

### Neue API-Route

```python
# 1. Neue Datei: backend/app/routes/mein_modul.py
"""
Singra Vox – Mein neues Modul
================================
Kurze Beschreibung was dieses Modul macht.

Routes
------
    GET  /api/mein-modul           → Liste abrufen
    POST /api/mein-modul           → Neuen Eintrag erstellen
"""
from fastapi import APIRouter, Request
from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.core.encryption import encrypt_metadata, decrypt_metadata

router = APIRouter(prefix="/api", tags=["mein-modul"])

async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user

@router.get("/mein-modul")
async def get_list(request: Request):
    user = await _current_user(request)
    items = await db.mein_modul.find(
        {"owner_id": user["id"]}, {"_id": 0}
    ).to_list(100)
    return items

@router.post("/mein-modul")
async def create_item(request: Request):
    user = await _current_user(request)
    body = await request.json()
    item = {
        "id": new_id(),
        "owner_id": user["id"],
        "content": encrypt_metadata("modul:" + new_id(), body.get("content", "")),
        "created_at": now_utc(),
    }
    await db.mein_modul.insert_one(item)
    item.pop("_id", None)
    return item
```

```python
# 2. In main.py registrieren:
from app.routes.mein_modul import router as mein_modul_r
app.include_router(mein_modul_r)
```

### Berechtigungsprüfung einbauen

```python
from app.permissions import assert_server_permission, assert_channel_permission

# Server-weite Berechtigung
await assert_server_permission(
    db, user["id"], server_id, "manage_server",
    "Keine Berechtigung"
)

# Kanal-spezifische Berechtigung
await assert_channel_permission(
    db, user["id"], channel, "send_messages",
    "Keine Berechtigung, in diesem Kanal zu schreiben"
)
```

### Audit-Log schreiben

```python
await log_audit(
    server_id=server_id,
    actor_id=user["id"],
    action="mein_modul_create",
    target_type="mein_modul",
    target_id=item["id"],
    details={"name": item_name}  # Details werden automatisch verschlüsselt
)
```

---

## Frontend erweitern

### Page-Schichtung

- `frontend/src/pages/*.js` sind Composition-Roots. Sie lesen Contexts und Routing, enthalten aber keine grossen fachlichen State-Maschinen.
- Seitenlogik gehoert in page-lokale Controller/Hooks, zum Beispiel unter `frontend/src/pages/main-layout/`.
- View-Komponenten bleiben API-, Socket- und Context-frei. Sie erhalten bereits vorbereitete Props aus dem Controller.
- Neue Workspace-Features gehoeren in die passende Domain-Hook-Schicht, etwa Server-Workspace, Direktnachrichten, Socket-Lifecycle oder Notification-Bootstrap.
- Wenn eine Datei wieder zu einem Container waechst, zuerst Responsibilities trennen, dann erst Feature-Code ergaenzen.

### Neue View-Komponente

```jsx
// frontend/src/components/mein-bereich/MeineKomponente.js
export default function MeineKomponente({ items, onSelectItem, t }) {
  return (
    <div data-testid="meine-komponente" className="workspace-card p-4">
      <h3 className="workspace-section-label">{t("mein.titel")}</h3>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectItem(item.id)}
          data-testid={`mein-item-${item.id}`}
          className="workspace-toolbar-button p-2 mb-1"
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}
```

```jsx
// frontend/src/components/mein-bereich/useMeineKomponenteController.js
import { useEffect, useState } from "react";
import api from "@/lib/api";

export default function useMeineKomponenteController({ serverId }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.get(`/api/mein-modul?server_id=${serverId}`)
      .then((res) => setItems(res.data))
      .catch(console.error);
  }, [serverId]);

  return { items };
}
```

Views bleiben damit API-, Socket- und Context-frei. Side Effects gehoeren in Controller/Hooks.

### API-Aufruf (api.js)

```jsx
import api from "@/lib/api";

// GET
const { data } = await api.get("/api/mein-modul");

// POST
const { data } = await api.post("/api/mein-modul", { content: "..." });

// PUT
await api.put(`/api/mein-modul/${id}`, { content: "..." });

// DELETE
await api.delete(`/api/mein-modul/${id}`);
```

---

## Verschlüsselung erweitern

### Server-Side (Encryption at Rest)

```python
# In backend/app/core/encryption.py hinzufügen:

def encrypt_mein_typ(context_id: str, plaintext: str) -> str:
    """Verschlüsselt Daten meines neuen Typs."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"mein_typ:{context_id}")
    return _aes_gcm_encrypt(plaintext, key)

def decrypt_mein_typ(context_id: str, stored: str) -> str:
    """Entschlüsselt Daten meines neuen Typs."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"mein_typ:{context_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored
```

### Client-Side (E2EE)

```javascript
// In frontend/src/lib/e2ee/crypto.js:
import { encryptPayload, decryptPayload } from "./crypto";

// Verschlüsseln (vor dem Senden)
const { ciphertext, nonce, keyEnvelopes } = await encryptPayload(
  plaintext, recipientDevices
);

// Entschlüsseln (nach dem Empfangen)
const plaintext = await decryptPayload(
  ciphertext, nonce, sealedKey
);
```

---

## Berechtigungen erweitern

### Neue Berechtigung hinzufügen

```python
# In backend/app/permissions.py:
# 1. PERMISSIONS dict erweitern
PERMISSIONS = {
    ...,
    "mein_neues_recht": False,  # Standard: deaktiviert für @everyone
}

# Die Auflösungslogik (resolve_member_permissions) funktioniert automatisch.
```

```python
# 2. In der Route prüfen:
await assert_server_permission(
    db, user["id"], server_id, "mein_neues_recht",
    "Keine Berechtigung"
)
```

---

## Internationalisierung (i18n)

### Neue Übersetzung hinzufügen

```json
// frontend/src/i18n/locales/de.json
{
  "mein": {
    "titel": "Mein Bereich",
    "erstellen": "Erstellen",
    "loeschen": "Löschen"
  }
}
```

```json
// frontend/src/i18n/locales/en.json
{
  "mein": {
    "titel": "My Area",
    "erstellen": "Create",
    "loeschen": "Delete"
  }
}
```

### In Komponente nutzen

```jsx
const { t } = useTranslation();
<h3>{t("mein.titel")}</h3>
```

### Neue Sprache hinzufügen

1. JSON-Datei unter `frontend/src/i18n/locales/<code>.json` erstellen
2. In `frontend/src/i18n/index.js` importieren und registrieren

---

## Tests schreiben

### Backend-Tests

```python
# tests/test_mein_modul.py
import httpx
import pytest

BASE = "http://localhost:8001/api"

@pytest.mark.asyncio
async def test_mein_modul_crud():
    async with httpx.AsyncClient() as client:
        # Login
        r = await client.post(f"{BASE}/auth/login", json={
            "email": "admin@test.com",
            "password": "TestAdmin123!"
        })
        cookies = r.cookies

        # Create
        r = await client.post(f"{BASE}/mein-modul",
            json={"content": "Test"},
            cookies=cookies
        )
        assert r.status_code == 200
        item_id = r.json()["id"]

        # Read
        r = await client.get(f"{BASE}/mein-modul", cookies=cookies)
        assert any(i["id"] == item_id for i in r.json())
```

---

## Code-Konventionen

### Python (Backend)
- Type Hints für alle Funktionsparameter und Rückgabewerte
- Docstrings für alle öffentlichen Funktionen (Google-Style)
- Keine Wildcards (`from x import *`)
- MongoDB: Immer `{"_id": 0}` in Projektionen
- Passwort-Hashes NIE zurückgeben: `.pop("password_hash", None)`

### JavaScript (Frontend)
- Funktionale Komponenten (keine Klassen)
- `data-testid` auf jedem interaktiven Element
- Tailwind-Klassen statt inline Styles
- i18n für alle nutzer-sichtbaren Texte
- API-Aufrufe über `lib/api.js` (nicht direkt fetch/axios)

### Allgemein
- Commit-Messages auf Englisch
- Branch-Naming: `feature/<name>`, `fix/<name>`, `docs/<name>`
- PR-Reviews vor Merge in `main`

---

## Audit-Checkliste

Vor jedem Release/Merge:

### Sicherheit
- [ ] Kein Klartext in MongoDB (alle content-Felder verschlüsselt?)
- [ ] Kein Klartext auf Disk (Dateien verschlüsselt?)
- [ ] Kein Passwort-Hash in API-Responses?
- [ ] Berechtigungsprüfung in neuen Routes?
- [ ] CSRF/XSS-Schutz intakt?
- [ ] Rate-Limiting auf sensiblen Endpoints?

### Qualität
- [ ] Docstrings vorhanden?
- [ ] i18n für neue Texte?
- [ ] data-testid auf neuen Elementen?
- [ ] Lint-Errors behoben?
- [ ] Tests geschrieben/aktualisiert?

### Wartbarkeit
- [ ] Verschlüsselung in encryption.py (nicht in Routes)?
- [ ] Berechtigungen über permissions.py (nicht inline)?
- [ ] Keine hardkodierten Farben/Werte im Frontend?
- [ ] Wiederverwendbare Workspace-Klassen genutzt?

### Datenschutz
- [ ] Minimale Metadaten gespeichert?
- [ ] GDPR-Export aktualisiert (neue Datentypen)?
- [ ] Account-Löschung aktualisiert?
- [ ] Audit-Log für neue Admin-Aktionen?
