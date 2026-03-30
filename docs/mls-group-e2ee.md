# Singra Vox – MLS Group E2EE Architecture

## Status

**Architektur und Design** – nicht implementiert als Code, weil eine ehrliche MLS-Implementierung den Rahmen des MVP sprengt. Dieses Dokument definiert das belastbare Konzept für die spätere Umsetzung.

## Warum MLS und nicht einfach "Gruppen-ECDH"?

| Eigenschaft | ECDH Pairwise | MLS (RFC 9420) |
|------------|---------------|----------------|
| Skalierung | O(n²) Schlüssel | O(n) per Ratchet Tree |
| Forward Secrecy | Nein (statisch) | Ja (Epoch-basiert) |
| Post-Compromise Security | Nein | Ja (Update) |
| Member Add/Remove | Kompletter Re-Key | Effizientes Commit |
| Standardisiert | Nein | IETF RFC 9420 |

**MLS ist der richtige Ansatz für Gruppen-E2EE.** Eine vereinfachte Eigenentwicklung wäre unsicher.

## Architektur-Design

### Überblick

```
Client A                   Delivery Service (Backend)            Client B
   │                              │                                │
   │  1. KeyPackage Upload        │                                │
   │ ────────────────────────────►│  Store KeyPackages             │
   │                              │                                │
   │  2. Create Group             │                                │
   │     Generate TreeKEM tree    │                                │
   │     Create Welcome message   │                                │
   │ ────────────────────────────►│  3. Fan-out Welcome            │
   │                              │ ──────────────────────────────►│
   │                              │     Client B joins group       │
   │                              │                                │
   │  4. Commit (Add/Remove/Update)                                │
   │ ────────────────────────────►│  5. Fan-out Commit             │
   │                              │ ──────────────────────────────►│
   │                              │     All members process        │
   │                              │                                │
   │  6. Encrypt message          │                                │
   │     AEAD with group key      │                                │
   │ ────────────────────────────►│  7. Fan-out ciphertext         │
   │                              │ ──────────────────────────────►│
   │                              │     Decrypt with group key     │
```

### Rollen des Backends (Delivery Service)

Das Backend fungiert **nicht** als Key Server und **sieht keine Klartext-Inhalte**. Es ist ein reiner Delivery Service:

1. **KeyPackage Storage**: Speichert öffentliche KeyPackages der Clients
2. **Message Fan-out**: Verteilt MLS Handshake- und Application-Messages
3. **Group State Tracking**: Optional: speichert verschlüsselten Group-State für Offline-Clients
4. **Authentication**: Validiert Client-Identitäten (JWT)

### Datenmodell

```
mls_key_packages: {
    id, user_id, key_package_data (opaque bytes),
    created_at, consumed: bool
}

mls_groups: {
    group_id (= channel_id), epoch, 
    encrypted_state (opaque, optional for offline sync),
    member_ids, created_at
}

mls_messages: {
    id, group_id, epoch, sender_id,
    message_type: "commit" | "proposal" | "application",
    payload (opaque ciphertext),
    created_at
}
```

### API-Endpoints (vorbereitet)

```
POST   /api/mls/key-packages          – Upload KeyPackage
GET    /api/mls/key-packages/{user_id} – Fetch KeyPackage (consumed on use)
POST   /api/mls/groups                 – Create MLS group for a channel
POST   /api/mls/groups/{id}/welcome    – Send Welcome to new member
POST   /api/mls/groups/{id}/commit     – Submit Commit (add/remove/update)
POST   /api/mls/groups/{id}/messages   – Send encrypted application message
GET    /api/mls/groups/{id}/messages   – Fetch pending messages
```

### Client-Implementierung

Empfohlene Libraries:
- **Web**: `openmls` compiled to WebAssembly (via `openmls-wasm`)
- **Tauri/Desktop**: `openmls` native Rust crate
- **Fallback**: `mls-rs` (Rust) oder `hpke-js` + custom TreeKEM

```
Client Initialization:
1. Generate Credential (identity key pair)
2. Generate KeyPackages (one-time-use)
3. Upload KeyPackages to Delivery Service

Channel Join (E2EE enabled):
1. Creator fetches KeyPackages of all members
2. Create MLS Group with TreeKEM tree
3. Generate Welcome messages per new member
4. Send Commits + Welcomes via Delivery Service
5. Members receive Welcome → derive group key

Message Send:
1. Encrypt with current epoch's group key (AEAD)
2. Send ciphertext to Delivery Service
3. DS fans out to group members
4. Members decrypt with their copy of group key

Member Add:
1. Fetch new member's KeyPackage
2. Create Add Proposal + Commit
3. Generate Welcome for new member
4. New epoch begins, all keys rotate

Member Remove:
1. Create Remove Proposal + Commit
2. New epoch, removed member can't decrypt new messages
```

### Auswirkungen auf bestehende Features

| Feature | Auswirkung |
|---------|-----------|
| **Channel Permissions** | Nur Mitglieder mit `read_messages` erhalten MLS Welcome |
| **Member Join** | Triggers MLS Add Commit |
| **Member Leave/Kick/Ban** | Triggers MLS Remove Commit |
| **Device Wechsel** | Neues KeyPackage nötig, Re-Join via Welcome |
| **History-Zugriff** | Neue Mitglieder sehen nur Nachrichten ab ihrem Join-Epoch |
| **Offline-Clients** | Delivery Service puffert Messages, Client verarbeitet beim Reconnect |
| **Admin Server-Zugriff** | Server sieht nur Ciphertext, kein Klartext |
| **Search** | Serverseitige Suche in E2EE-Channels nicht möglich (clientseitig) |
| **Moderation** | Nutzer-Reports mit expliziter Freigabe (Client sendet Klartext an Moderator) |

### Trade-offs

| Entscheidung | Begründung |
|-------------|-----------|
| MLS statt custom Protokoll | Standardisiert, auditierbar, battle-tested |
| Kein serverseitiger Klartext | Privacy by Design, DSGVO-konform |
| Kein History für neue Mitglieder | Forward Secrecy ist wichtiger als Komfort |
| Clientseitige Suche | Ehrliche E2EE schließt serverseitige Suche aus |
| Optional pro Channel | Nicht jeder Channel braucht E2EE, Admin entscheidet |

### Migrationspfad

1. **Phase A**: `openmls-wasm` evaluieren und in Test-Build integrieren
2. **Phase B**: KeyPackage-Upload und Delivery-Service-Endpoints implementieren
3. **Phase C**: MLS Group Creation für private Channels implementieren
4. **Phase D**: Application Messages (verschlüsselte Nachrichten) in MLS-Channels
5. **Phase E**: Member Add/Remove mit automatischem Re-Keying
6. **Phase F**: Multi-Device-Support mit KeyPackage-Management

### Empfehlung

Die aktuelle DM-E2EE (ECDH + AES-GCM) ist **ausreichend und ehrlich für 1:1-Kommunikation**. Für Gruppen-Channels sollte MLS erst implementiert werden, wenn:
- `openmls-wasm` stabil als WebAssembly verfügbar ist
- Der Tauri-Desktop-Client native `openmls` nutzen kann
- Genügend Testabdeckung für Key-Rotation und Edge Cases besteht

**Keine Pseudo-E2EE für Channels bauen.** Besser: klar kommunizieren, dass Server-Channels derzeit nicht Ende-zu-Ende-verschlüsselt sind, und den Migrationspfad offenhalten.
