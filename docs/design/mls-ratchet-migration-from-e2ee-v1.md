# E2EE: Vollständiger MLS-/Ratchet-Migrationspfad (Ablösung von “encrypted_v1” / sv-e2ee-v1)

## Kontext (Ist-Zustand)
- Produktives E2EE ist aktuell **sv-e2ee-v1** (nicht “encrypted_v1”) und basiert auf:
  - Per-Message random MessageKey (XChaCha20-Poly1305).
  - Key-Wrapping via `crypto_box_seal` pro Empfängergerät (und optional Recovery).
  - Keine Ratchets, kein Session-State; Backend behandelt Ciphertext opaque.
  - Referenzen: [E2EEContext.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/contexts/E2EEContext.js), [crypto.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/lib/e2ee/crypto.js), [main.py](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/backend/app/main.py#L1373-L1740).
- Dokumentation beschreibt MLS als Zielbild, nicht implementiert: [mls-group-e2ee.md](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/docs/mls-group-e2ee.md).

## Ziele
- Einführung eines **sv-e2ee-v2** mit:
  - MLS für Gruppen-/Channel-E2EE (FS + PCS), inklusive Membership-Updates und epoch-based Key-Rotation.
  - Double Ratchet für 1:1 DMs (FS, Out-of-order Handling, Break-in Recovery) und optional “Small Group DM”.
- Backward Compatibility:
  - v1 bleibt entschlüsselbar.
  - Neue Clients können v2 sprechen; Migration pro Conversation (DM/Group/Channel).
- Automatische Schlüsselrotation und sichere Key-Deletion.
- Sicherer Downgrade-Pfad (kontrolliert, auditierbar, UI sichtbar).
- Klare Interfaces, TS-Deklarationen + JSDoc, isolierte Test-Suites.

Quellen/Best Practices:
- MLS bietet Gruppen-Kryptographie mit FS/PCS und ist als RFC standardisiert; Architektur-Überblick: https://messaginglayersecurity.rocks/mls-architecture/ (IETF MLS Architecture, basiert auf RFC 9420).
- OpenMLS bietet WASM Support via `openmls` “js feature”: https://book.openmls.tech/user_manual/wasm.html
- Double Ratchet Spezifikation (Signal): https://signal.org/docs/specifications/doubleratchet/

## Design-Entscheidung: “Hybrid v2”

### Warum nicht “MLS für alles”?
- MLS ist ideal für Gruppen, aber 1:1 DMs profitieren von etablierten Ratchet-Properties und einfacherer Session-Handhabung.
- Ergebnis: **MLS für Gruppen/Channels**, **Double Ratchet für 1:1**.

### Protokoll-Scope
- `sv-e2ee-v2-dm` (Double Ratchet)
- `sv-e2ee-v2-mls` (MLS Group State)
- Optional später: “MLS 1:1 groups” (intern auch möglich, aber nicht v1 der Migration).

## Datenformate (v2)

### Gemeinsames Envelope
```json
{
  "protocol_version": "sv-e2ee-v2-mls|sv-e2ee-v2-dm",
  "sender_device_id": "uuid",
  "header": { "opaque": true },
  "ciphertext": "base64",
  "aad": { "type": "channel_message|dm_message|voice_media_key|attachment_manifest", "meta": {} }
}
```

### v2 MLS (Gruppen/Channels)
- `header` enthält MLS framing (group_id, epoch, sender, authenticated_data, ggf. signature).
- `ciphertext` ist MLS Application Message (opaque).
- Backend speichert:
  - `group_id`, `epoch`, `mls_message` (opaque bytes/base64), `sender_device_id`, `protocol_version`.

### v2 DM (Double Ratchet)
- `header` enthält Ratchet header:
  - `dh_pub`, `pn`, `n`, optional “header encryption” (später).
- `ciphertext` ist AEAD payload (XChaCha20-Poly1305 oder AES-GCM).
- Device speichert per DM-Partner pro Device ein Ratchet-State (RootKey, ChainKeys, SkippedKeys).

## Komponenten & Module

### Frontend (neu/erweitert)
**Ordnerstruktur (Vorschlag)**
- `frontend/src/lib/e2ee/v2/`
  - `protocolRegistry.js` (+ `.d.ts`)
  - `dmRatchet.js` (+ `.d.ts`)
  - `mlsGroup.js` (+ `.d.ts`)
  - `storage.js` (+ `.d.ts`) (persistenter State, Keyring-backed)
  - `adapters/` (Payload framing: message/attachment/voice)

**E2EEContext Erweiterung**
- `encryptForConversation(conversation, plaintextPayload) -> Envelope`
- `decryptEnvelope(envelope) -> plaintextPayload`
- Registry entscheidet anhand `protocol_version`:
  - v1 decrypt: bestehender Codepfad.
  - v2 decrypt: Ratchet/MLS.

**TypeScript Deklarationen (Beispiel)**
```ts
export type ProtocolVersion =
  | "sv-e2ee-v1"
  | "sv-e2ee-v2-dm"
  | "sv-e2ee-v2-mls";

export type E2EEEnvelope = {
  protocol_version: ProtocolVersion;
  sender_device_id: string;
  header: string;      // base64 (opaque for backend)
  ciphertext: string;  // base64
  aad?: unknown;       // json
};
```

### Backend (neu/erweitert)
**Prinzip**
- Backend bleibt kryptographisch “blind” (keine Klartexte).
- Backend wird zum **Delivery Service (DS)** für MLS und verwaltet:
  - KeyPackage Distribution
  - Group State Message Ordering pro `group_id`
  - Persistenz/Replay für verpasste Commits/Welcomes

**Neue Endpoints (Vorschlag)**
- KeyPackages:
  - `POST /api/e2ee/v2/keypackages` (upload batch pro device)
  - `GET /api/e2ee/v2/keypackages/{user_id}` (fetch für add proposals)
- MLS Groups:
  - `POST /api/e2ee/v2/mls/groups` (create group_id, initial commit/welcome upload)
  - `POST /api/e2ee/v2/mls/groups/{group_id}/messages` (upload MLS handshake/app messages)
  - `GET /api/e2ee/v2/mls/groups/{group_id}/messages?after=...` (ordered fetch)
  - `GET /api/e2ee/v2/mls/groups/{group_id}/state` (metadata: epoch, members, policy; kein Secret)
- DM Ratchet Support:
  - optional “PreKey Directory” (falls X3DH/PQXDH geplant); sonst initial secret via sealed-box wie v1.

**DB Collections (Vorschlag)**
- `e2ee_keypackages_v2`
- `e2ee_mls_groups`
- `e2ee_mls_messages` (ordered by (group_id, seq))
- `e2ee_dm_sessions` (optional: nur public meta; secrets bleiben clientseitig)

## Migrationspfad (v1 → v2)

### Phase A: Capability Discovery
- Backend liefert pro Recipient:
  - `supported_protocols: ["sv-e2ee-v1", "sv-e2ee-v2-mls", "sv-e2ee-v2-dm"]`
- Frontend wählt “beste gemeinsame” Version:
  - Channel/Group: v2-mls nur wenn alle aktiven/verifizierten Devices der Members v2 unterstützen.
  - DM: v2-dm wenn beide Seiten v2 unterstützen.

### Phase B: Parallelbetrieb
- Persistenz von v1 bleibt unverändert.
- Neue Messages werden pro Conversation entweder v1 oder v2 gesendet (kein globaler Cutover).
- UI zeigt “Security level” pro Conversation.

### Phase C: Upgrade (automatisch)
- Wenn alle Participants v2-fähig:
  - Channel/Group: Creator (oder Policy-Engine) initiiert MLS Group Erstellung.
  - Welcome/Commit wird verteilt; Clients speichern Group State.
  - Danach sendet der Channel nur noch v2-mls.
- DM: Initial Ratchet secret wird etabliert (z.B. über bestehendes sealed-box “bootstrap msg”), danach nur v2-dm.

### Phase D: Deprecation von v1 (“encrypted_v1”)
- Konfigurierbar per Policy:
  - `min_protocol_version` pro Server/Channel.
  - Nach Stichtag (Policy-basiert) wird v1 für neue Messages blockiert.

## Key Rotation, PFS, Secure Deletion

### MLS
- Rotation:
  - Trigger: membership change, device add/revoke, periodische “Update proposals”.
- Secure deletion:
  - Clients löschen Secrets alter Epochen nach erfolgreichem Commit Apply (keine “retain old epochs” außer für begrenztes Fork-Resolution-Fenster).
- PCS:
  - Nach Kompromittierung kann ein Update/Commit den State “heilen” (MLS-Property PCS, Architektur-Dokument).

### Double Ratchet
- Rotation per Nachricht (Chain Keys) + DH ratchet on peer key update.
- Skipped message keys werden begrenzt (LRU/TTL), um Memory/Leakage zu kontrollieren.

## Sicherer Downgrade-Pfad

### Policy
- Default: **kein automatischer Downgrade** wenn v2 bereits aktiv war.
- Downgrade nur wenn:
  - (a) ein notwendiger Teilnehmer dauerhaft v2 nicht unterstützt, und
  - (b) Conversation Policy `allow_downgrade=true`, und
  - (c) Downgrade als **sichtbares Security Event** im Chat erscheint.

### Technische Mechanik
- `protocol_downgrade_notice` wird als signiertes Control-Event im Klartext in Metadaten (nicht im Ciphertext) gespeichert, aber enthält keine Secrets.
- Backend audit-loggt Downgrades (serverseitig).

## Tests

### Unit Tests
- v2 Envelope framing/unframing.
- Ratchet state machine: out-of-order, skipped keys limit, replay detection.
- MLS: group state transitions, commit ordering, welcome handling.

### Integration Tests
- Mixed-version matrix:
  - v1-only device + v2 device in gleicher DM → expected v1.
  - Nach Upgrade beider Seiten → v2-dm.
- Gruppenmigration:
  - Neue Members join/leave, epoch increments, alte Member kann nicht decrypten nach Remove.

### Performance Tests
- MLS group size scaling (N=2..1000) für commits/proposals.
- Message throughput in großen Channels (ciphertext size overhead, CPU).

## Implementierungsschritte (milestone-basiert)
- M0: Protocol Registry + Envelope Schema + Feature Flags.
- M1: v2 DM Ratchet (1:1) + Storage + Tests.
- M2: v2 MLS DS APIs (KeyPackages, ordered message feed) + minimal client MLS via OpenMLS WASM.
- M3: Channel/Group Migration Flow + UI Surfacing + Policies.
- M4: Key rotation automation + secure deletion hardening.
- M5: v1 deprecation gates + telemetry-freies Security Logging (lokal/serverseitig).

## Risiken & Fallstricke
- MLS erfordert strikte Message Ordering pro group_id; DS muss konsistent liefern (Ordering + Replay).
- WASM Crypto muss sichere Randomness/Time haben (OpenMLS “js feature” setzt JS APIs voraus).
- Storage-Sicherheit: Ratchet/MLS state muss im Keyring/Encrypted Storage liegen; niemals in plain localStorage.

