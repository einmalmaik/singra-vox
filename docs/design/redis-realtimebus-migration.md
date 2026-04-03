# Backend: Redis-basierter RealtimeBus (Migration von In-Memory Fanout)

## Kontext (Ist-Zustand)
- Fanout ist aktuell single-process in-memory über `WSManager` umgesetzt: [ws.py](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/backend/app/ws.py).
- WebSocket Endpoint `/api/ws` lebt in [main.py](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/backend/app/main.py#L3235-L3304).
- Konsequenz: horizontale Skalierung (mehrere Backend-Instanzen) führt zu “split brain” Fanout (Clients auf anderer Instanz bekommen Events nicht).

## Ziele
- Redis-basiertes Fanout für Multi-Instance Backends, ohne Änderung am Client-Protokoll.
- Cluster-Support, Connection-Pooling, resiliente Reconnects.
- Publish/Subscribe mit Message-Queuing, so dass Instanzen Events nicht “verlieren” (z.B. kurze Redis/Netzwerk-Hiccup).
- Klare Migrationsstrategie ohne Datenverlust.
- Modulare Architektur: austauschbares Bus-Backend (local, redis).

## Architektur-Überblick

```mermaid
flowchart LR
  subgraph API[FastAPI Instanz A..N]
    APP[Domain Code\n(main.py)]
    WS[WSManager\n(ws.py)]
    BUS[RealtimeBus Interface]
    RX[BusReceiver Task]
    APP --> BUS
    RX --> WS
  end

  subgraph R[Redis]
    STREAMS[(Streams)]
    PUBSUB((Pub/Sub))
  end

  BUS -->|XADD + PUBLISH| STREAMS
  BUS -->|PUBLISH| PUBSUB
  RX -->|XREAD catch-up| STREAMS
  RX -->|SUBSCRIBE low-latency| PUBSUB
```

### Design-Prinzip
- **Streams** sind die “Quelle der Wahrheit” (persistente Queue). Pub/Sub ist optionaler Low-Latency-Hinweis.
- Jede Instanz hält Cursor pro Topic und kann nach Restart/Disconnect aus Streams nachlesen.
- Events werden idempotent verarbeitet (dedupe via `event_id`), da Streams at-least-once liefern können.

Quellen/Best Practices:
- Redis Streams sind persistent, ordered, replayable und unterstützen ACK/consumer state; Pub/Sub ist fire-and-forget (Missed messages gehen verloren). Siehe Redis Learning/Howto https://redis.com/learn/howtos/solutions/microservices/interservice-communication

## Datenmodell

### Event Envelope (kanonisch)
```json
{
  "event_id": "uuid",
  "type": "new_message|presence_update|dm_message|voice_join|...",
  "scope": "server|user|session|global",
  "scope_id": "server_id|user_id|session_id|*",
  "ts_ms": 0,
  "payload": { "opaque": true },
  "schema_version": 1
}
```

### Redis Keys
- Streams:
  - `rt:server:{server_id}` für Server-Scoped Events (Channel/Voice/Presence/Notifications innerhalb eines Servers).
  - `rt:user:{user_id}` für User-Scoped Events (DMs, persönliche Notifications).
  - `rt:session:{session_id}` optional für Session-revoke (wenn benötigt).
- Cursor pro Instanz:
  - `rt:cursor:{instance_id}:{topic}` = zuletzt verarbeitete Stream-ID.
- Dedupe:
  - `rt:dedupe:{instance_id}` als LRU-Set/Sorted-Set mit TTL für `event_id` (nur kurzzeitig).

## Komponenten & Interfaces

### Python: RealtimeBus Interface (neu)
**Dateien (neu)**
- `backend/app/realtime_bus/base.py`
- `backend/app/realtime_bus/local.py`
- `backend/app/realtime_bus/redis_bus.py`
- `backend/app/realtime_bus/config.py`

**Interface**
- `publish(scope, scope_id, event_type, payload) -> None`
- `subscribe(scope, scope_id) -> SubscriptionHandle`
- `unsubscribe(handle) -> None`
- `start_receiver(ws_mgr) -> AsyncTask` (liest Streams/PubSub und ruft `ws_mgr.send/broadcast_*`)

### Integration in bestehendes WSManager
- Domain-Code ruft künftig nicht mehr direkt `ws_mgr.broadcast_*` aus “jedem” Pfad heraus, sondern:
  - `realtime_bus.publish(...)`
  - Receiver übernimmt Delivery zu lokalen WS-Verbindungen.
- Optionaler “Short-circuit”:
  - Wenn `REALTIME_BUS_MODE=local`, publish direkt `ws_mgr.*` (heutiges Verhalten).

## Konfiguration (Cluster/Pooling)

### Environment Variables (Vorschlag)
- `REALTIME_BUS_MODE=local|redis|dual`
- `REDIS_URL=redis://user:pass@host:6379/0` (single-node)
- `REDIS_CLUSTER_NODES=host1:6379,host2:6379,...` (cluster)
- `REDIS_TLS=0|1`
- `REDIS_MAX_CONNECTIONS=50`
- `REDIS_SOCKET_TIMEOUT_MS=2000`
- `REDIS_HEALTHCHECK_INTERVAL_S=5`
- Streams:
  - `RT_STREAM_MAXLEN=200000` (XTRIM, approximate)
  - `RT_STREAM_TTL_S=86400` (optional housekeeping)

### Cluster Support
- Python: `redis-py` unterstützt Redis Cluster; für Performance optional `hiredis`.
- Connection pooling erfolgt über `redis.asyncio.Redis(..., max_connections=...)` bzw. Cluster-Pool.

## Migrationsstrategie (ohne Datenverlust)

### Phase 0: Vorbereitungen
- Redis im Stack deployen (dev/prod), Monitoring/Alerting (Latency, memory, AOF/RDB).
- Backends erhalten eindeutige `INSTANCE_ID` (z.B. Pod Name).

### Phase 1: Dual-Write (sicher)
- `REALTIME_BUS_MODE=dual`:
  - Domain-Code schreibt in Redis Streams **und** liefert weiterhin direkt über `WSManager` aus (bestehender Pfad).
  - Zusätzlich: Receiver läuft und protokolliert, wie viele Events “gesehen” werden (aber noch nicht aktiv ausliefert) → Validierung ohne Impact.

### Phase 2: Dual-Read mit Dedupe
- Receiver liefert aktiv aus Redis; Direct-Delivery bleibt an.
- Dedupe im `WSManager` (oder vor `ws.send_json`) nach `event_id`, um Doppelzustellungen zu verhindern.

### Phase 3: Redis-Only
- Direct-Delivery wird entfernt/deaktiviert.
- `WSManager` bleibt als reine Connection Registry.

Rollback:
- Mode zurück auf `local`. Streams bleiben liegen (keine Datenlöschung nötig).

## Tests

### Unit Tests
- Envelope validation, key mapping (scope→stream), cursor persistence, dedupe TTL.
- Retry/Backoff bei Redis Disconnect.

### Integration Tests
- Multi-instance Simulation:
  - zwei FastAPI Instanzen (verschiedene Ports), ein Redis.
  - Client A verbindet zu Instanz 1, Client B zu Instanz 2.
  - Trigger in Instanz 1 → Event muss Client B erreichen.
- Redis Failover:
  - Redis restart → Receiver reconnect, catch-up aus Streams, keine Lücke.

### Performance Tests
- Throughput: `new_message` Fanout bei N=10k WS-Verbindungen.
- Latency Budget: Pub/Sub hint + Stream catch-up ≤ definierte P95.

## Implementierungsschritte (milestone-basiert)
- M0: `RealtimeBus` Interface + Local impl (Wrapper um `WSManager`).
- M1: Redis Streams Writer + Cursor Store + Receiver (XREAD BLOCK).
- M2: Pub/Sub Hint Channel (optional), Dedupe, Backpressure.
- M3: Dual-Mode Rollout (dual-write → dual-read → redis-only).
- M4: Test-Harness für Multi-Instance + Load.

## Risiken & Fallstricke
- Streams speichern “alles”: Trimming/TTL ist Pflicht (sonst Memory-Wachstum).
- At-least-once delivery: Clients/State-Reducer müssen idempotent sein (oder event_id dedupe).
- Reorder: Streams geben pro Topic Ordnung; cross-topic Ordnung ist nicht garantiert (z.B. server vs user).

