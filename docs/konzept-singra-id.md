# Singra Vox – Konzept: Zentrale Identität × dezentrales Self-Hosting

## Problem

Aktuell erstellt jede Singra-Vox-Instanz eigene Benutzerkonten. Das bedeutet:
- Jeder Self-Hoster hat seine eigene User-Datenbank
- Wer auf drei Instanzen aktiv ist, braucht drei Konten
- Kein einheitliches Profil, keine Freundesliste über Instanzen hinweg
- Passwort-Recovery ist instanzabhängig

**Ziel:** EIN Konto, VIELE Instanzen – ohne die Self-Hosting-Freiheit zu opfern.

---

## Architektur-Varianten

### Variante A: Föderiertes Identitätsprotokoll (empfohlen)

```
┌─────────────────────────────────────────────────────┐
│                  SINGRA ID (zentral)                 │
│                  id.singravox.com                    │
│                                                     │
│  • Konto-Erstellung (Email + Passwort)              │
│  • Profil (Username, Avatar, Display Name)           │
│  • OAuth2/OIDC Provider                              │
│  • Instanz-Registry (welche Instanzen nutze ich?)    │
│  • Konto-Recovery (Passwort vergessen)               │
│  • Öffentlicher Schlüssel für E2EE                   │
│                                                     │
│  SPEICHERT NICHT: Nachrichten, Channels, Server      │
└──────────────────────┬──────────────────────────────┘
                       │ OAuth2 / OIDC
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Instanz A  │ │  Instanz B  │ │  Instanz C  │
│ gaming.xyz  │ │ work.corp   │ │ family.home │
│             │ │             │ │             │
│ • Server    │ │ • Server    │ │ • Server    │
│ • Channels  │ │ • Channels  │ │ • Channels  │
│ • Messages  │ │ • Messages  │ │ • Messages  │
│ • Rollen    │ │ • Rollen    │ │ • Rollen    │
│ • Voice     │ │ • Voice     │ │ • Voice     │
│ • E2EE Keys │ │ • E2EE Keys │ │ • E2EE Keys │
└─────────────┘ └─────────────┘ └─────────────┘
     Self-Hosted     Self-Hosted     Self-Hosted
```

#### Wie funktioniert das?

1. **Einmal registrieren** auf `id.singravox.com` → Singra ID
2. **Auf Instanz A beitreten** → "Anmelden mit Singra ID" (OAuth2-Flow)
3. Instanz A erhält: `singra_id`, `username`, `display_name`, `avatar_url`
4. Instanz A erstellt einen **lokalen User-Datensatz** verknüpft mit der Singra ID
5. Alle Nachrichten, Server, Rollen bleiben auf der Instanz (100% Self-Hosted)
6. Singra ID kennt nur: "User X ist auf Instanz A, B, C"

#### Datenaufteilung

| Daten | Wo gespeichert? | Warum? |
|-------|-----------------|--------|
| Email, Passwort-Hash | Singra ID (zentral) | Einmaliges Konto |
| Username, Avatar, Display Name | Singra ID (synchronisiert) | Konsistentes Profil |
| Server, Channels, Messages | Instanz (lokal) | Self-Hosting-Prinzip |
| Rollen & Permissions | Instanz (lokal) | Instanz-Owner bestimmt |
| E2EE Schlüssel | Instanz (lokal) | Zero-Knowledge |
| Voice States | Instanz (lokal) | Echtzeit, instanzgebunden |
| Instanz-Liste des Users | Singra ID (zentral) | Instance Switcher |
| Freundesliste | Singra ID (zentral) | Instanz-übergreifend |

#### Ablauf: Neuer User kommt auf eine Instanz

```
User ──→ instanz-a.example.com/login
            │
            │  "Anmelden mit Singra ID"
            ▼
         id.singravox.com/oauth/authorize
            │
            │  User gibt Email + Passwort ein
            │  (oder ist schon eingeloggt)
            ▼
         Redirect zurück zu instanz-a.example.com
         mit OAuth2 Authorization Code
            │
            ▼
         Instanz A tauscht Code gegen Token
         → Erhält: { singra_id, username, avatar, ... }
         → Erstellt lokalen User-Datensatz
         → User ist eingeloggt
```

#### Ablauf: Instance Switcher

```
User ist auf Instanz A eingeloggt
            │
            │  Öffnet "Instanzen" Tab in Einstellungen
            ▼
         Singra ID API: GET /api/me/instances
         → [
             { url: "gaming.xyz", name: "Gaming Hub", icon: "..." },
             { url: "work.corp", name: "Work", icon: "..." },
           ]
            │
            │  Klickt auf "Work"
            ▼
         Desktop: Wechselt Instance-URL
         Web: Öffnet neuen Tab / Redirect
         → Automatisch eingeloggt (SSO über Singra ID)
```

---

### Variante B: Dezentral mit DID (Decentralized Identifiers)

```
┌──────────────────────────────────┐
│  User's Device (Wallet)          │
│                                  │
│  • Privater Schlüssel            │
│  • DID: did:singra:abc123def     │
│  • Profil (lokal signiert)       │
└──────────┬───────────────────────┘
           │ Signierte Auth-Tokens
     ┌─────┼─────┐
     ▼     ▼     ▼
  Instanz A  B  C   (verifizieren Signatur)
```

**Pro:** Kein zentraler Server, maximale Dezentralisierung
**Contra:** Komplexes Key-Management, Konto-Recovery schwieriger, UX-Hürde

→ Für Singra Vox **nicht empfohlen** als V1 (zu komplex für Users)

---

### Variante C: Hybrid – Singra ID optional

```
Instanz-Betreiber wählt:
  ☑ Lokale Konten erlauben (wie bisher)
  ☑ Singra ID Login erlauben
  ☐ Nur Singra ID (lokale Konten deaktiviert)
```

**Das ist die pragmatischste Lösung:**
- Bestehende Instanzen funktionieren weiter wie bisher
- Neue Instanzen können Singra ID aktivieren
- User können ihr lokales Konto nachträglich mit Singra ID verknüpfen

---

## Empfohlene Architektur: Variante A + C (Hybrid-Föderation)

### Phase 1: Singra ID Server (MVP)

Minimaler OpenID Connect Provider:

```
singra-id/
├── server/
│   ├── auth.py          # Registration, Login, Password Reset
│   ├── oauth.py         # OAuth2 Authorization Server
│   ├── profile.py       # Profil-API (username, avatar, bio)
│   ├── instances.py     # Instanz-Registry pro User
│   └── federation.py    # .well-known/openid-configuration
├── frontend/
│   ├── RegisterPage     # Konto erstellen
│   ├── LoginPage        # Anmelden
│   ├── ProfilePage      # Profil bearbeiten
│   ├── InstancesPage    # Meine Instanzen verwalten
│   └── ConsentPage      # OAuth2 Consent Screen
└── db/
    ├── users            # { singra_id, email, password_hash, ... }
    ├── profiles         # { singra_id, username, avatar_url, ... }
    ├── oauth_clients    # { client_id, client_secret, instance_url }
    ├── user_instances   # { singra_id, instance_url, joined_at }
    └── sessions         # { session_id, singra_id, ... }
```

### Phase 2: Instanz-Integration

Änderungen an bestehender Singra Vox Instanz:

```python
# backend/.env (neue Variablen)
SINGRA_ID_ENABLED=true
SINGRA_ID_URL=https://id.singravox.com
SINGRA_ID_CLIENT_ID=instance-xyz
SINGRA_ID_CLIENT_SECRET=secret-abc

# Lokale Konten weiterhin möglich:
ALLOW_LOCAL_ACCOUNTS=true
```

```python
# Neuer Auth-Flow in auth_service.py

@auth_r.get("/singra-id/login")
async def singra_id_login():
    """Redirect to Singra ID OAuth2 authorize endpoint"""
    # → id.singravox.com/oauth/authorize?client_id=...&redirect_uri=...

@auth_r.get("/singra-id/callback")
async def singra_id_callback(code: str):
    """Handle OAuth2 callback from Singra ID"""
    # 1. Exchange code for tokens
    # 2. Fetch user profile from Singra ID
    # 3. Find or create local user linked to singra_id
    # 4. Issue local session (wie bisher)
```

### Phase 3: Instance Switcher

```
User öffnet Singra Vox Desktop App
    │
    ├── Instanz A (gaming.xyz) ← aktiv
    ├── Instanz B (work.corp)
    └── Instanz C (family.home)
    
    [+ Neue Instanz hinzufügen]
```

Instanzen werden sowohl lokal (localStorage) als auch in Singra ID gespeichert.
Bei neuem Gerät: Singra ID Login → alle Instanzen werden automatisch geladen.

---

## Offene Fragen & Entscheidungen

### 1. Wo wird Singra ID gehostet?

| Option | Pro | Contra |
|--------|-----|--------|
| **singravox.com** (du hostest) | Einfach, zuverlässig | Zentraler Punkt |
| **Self-Hosted Singra ID** | Maximale Kontrolle | Jede Org braucht eigenen ID-Server |
| **Beides** | Flexibel | Mehr Entwicklungsaufwand |

**Empfehlung:** Singra ID als Service auf `id.singravox.com` betreiben + optional Self-Hosting für Enterprise.

### 2. Was passiert wenn Singra ID down ist?

- Instanzen funktionieren weiter (lokale Sessions bleiben gültig)
- Neue Logins über Singra ID sind temporär nicht möglich
- Lokale Konten (falls aktiviert) funktionieren immer
- Token-Refresh kann mit langer TTL (30 Tage) überbrücken

### 3. Wie verknüpft ein bestehender User sein lokales Konto?

```
Direktnachrichten / Freunde → "Singra-ID einrichten"
    │
    ▼
Singra-ID Setup-Screen mit vorausgefüllten lokalen Profildaten
    │
    ▼
Singra-ID Registrierung + E-Mail-Bestätigung
    │
    ▼
Explizites Linking:
  users.svid_account_id = "abc123"
  svid_accounts.linked_user_id = "<lokale user id>"
    │
    ▼
Server, Einstellungen, Mitgliedschaften und lokale Daten bleiben bestehen.
Optional kann der lokale Passwort-Login danach deaktiviert werden.
```

### 4. Können Instanzen untereinander kommunizieren?

**Nicht in V1.** Jede Instanz ist isoliert. Cross-Instance-Messaging (wie Matrix Federation) wäre ein späteres Feature.

Aber: Über Singra ID könnten Freundeslisten instanz-übergreifend sein:
- "Hey, dein Freund Max ist auch auf Instanz B – möchtest du beitreten?"

### 5. E2EE und Singra ID

E2EE-Schlüssel bleiben IMMER auf der Instanz. Singra ID hat keinen Zugriff auf:
- Private Keys
- Nachrichten-Inhalte
- Passphrases

Singra ID speichert maximal den öffentlichen Schlüssel für die Identitätsverifikation.

---

## Zusammenfassung

```
HEUTE:                          ZIEL:
                                
User ──→ Instanz A (Konto 1)    User ──→ id.singravox.com (1 Konto)
User ──→ Instanz B (Konto 2)         ├──→ Instanz A (via OAuth2)
User ──→ Instanz C (Konto 3)         ├──→ Instanz B (via OAuth2)
                                      └──→ Instanz C (via OAuth2)
3 Passwörter, 3 Profile         1 Passwort, 1 Profil
```

**Kernprinzipien:**
1. **Self-Hosting bleibt:** Jede Instanz bleibt unabhängig, alle Daten lokal
2. **Singra ID ist optional:** Instanzen können auch ohne funktionieren
3. **Zero-Knowledge:** Singra ID sieht keine Nachrichten oder E2EE-Schlüssel
4. **Open Source:** Sowohl Singra ID als auch die Instanz bleiben OSS
5. **Progressive Adoption:** Bestehende Instanzen können schrittweise migrieren

---

## Technologie-Stack für Singra ID

| Komponente | Technologie | Begründung |
|-----------|-------------|------------|
| Backend | FastAPI (Python) | Konsistent mit Singra Vox |
| Auth | OAuth2 / OIDC (authlib) | Industriestandard |
| Database | PostgreSQL | Relationale Daten, besser für User-Directory |
| Frontend | React | Konsistent mit Singra Vox |
| Hosting | Docker / Kubernetes | Skalierbar, Self-Host-fähig |

---

## Roadmap (geschätzt)

| Phase | Scope | Aufwand |
|-------|-------|---------|
| **Phase 1** | Singra ID MVP (Register, Login, OAuth2, Profil) | ~3-4 Wochen |
| **Phase 2** | Instanz-Integration ("Login mit Singra ID" Button) | ~1-2 Wochen |
| **Phase 3** | Account-Verknüpfung (bestehendes Konto → Singra ID) | ~1 Woche |
| **Phase 4** | Instance Switcher (Desktop + Web) | ~1 Woche |
| **Phase 5** | Freundesliste instanz-übergreifend | ~2 Wochen |
| **Phase 6** | Self-Hosted Singra ID (Docker Image) | ~1-2 Wochen |

**Gesamt: ~10-12 Wochen für Full Feature Set**

MVP (Phase 1+2) in **~5 Wochen** nutzbar.
