# Full Project Review

- Review-Datum: 2026-04-02
- Review-Typ: Read-only QA- und Security-Review
- Review-Basis: Git-Stand `f5a5e17afde32c1d53f06c98fbcafab0c524f0d8`
- Scope: gesamtes Projekt inkl. Frontend, Backend, Tauri-Runtime, Deployment-Konfiguration und vorhandener Architektur-Dokumente

## 1. Executive Summary

Die Codebasis ist funktional breit ausgebaut, aber in mehreren sicherheits- und architekturkritischen Bereichen noch nicht belastbar genug für die Sicherheits- und Konsistenzversprechen einer Discord-ähnlichen Plattform. Die größten Risiken liegen aktuell in vier Bereichen:

1. Die aktuelle E2EE-Implementierung ist **nicht** auf dem Niveau von Signal/MLS und belegt weder Forward Secrecy noch Post-Compromise Security. Gleichzeitig beschreiben Teile der Dokumentation die Lösung stärker, als der Code es hergibt.
2. Das Rollen- und Berechtigungssystem ist **serverseitig nicht vollständig zentralisiert**. Kanal-Overrides werden zwar gespeichert, aber nicht in der zentralen Permission-Auswertung berücksichtigt.
3. Der Streaming-Stack erzwingt **`join_voice`**, aber nicht sauber **`speak`/`stream`**. Der Voice-Token erlaubt Publishing für jeden Join-berechtigten Nutzer.
4. Das Login-/Session-System nutzt langlebige JWT-Refresh-Tokens **ohne Rotation und ohne serverseitige Revocation**. `Logout` beendet die aktuelle Sitzung optisch, invalidiert aber keine bestehenden Refresh-Tokens.

Wichtigste Blocker:

- E2EE: fehlende ratchet-basierte Kryptografie und widersprüchliche Produkt-/Architekturaussagen
- Streaming: fehlende serverseitige Enforcement für `speak`/Publishing
- RBAC/ABAC: Kanal-Overrides werden nicht im zentralen Permission-Pfad ausgewertet
- Login: keine Refresh-Token-Rotation / Revocation

Positiv belegt:

- Desktop-Token und Desktop-Secrets werden nicht in `localStorage`, sondern im OS-Keyring abgelegt: `desktop/src-tauri/src/main.rs:88-105`, `frontend/src/lib/authStorage.js:1-39`
- E2EE-Datei-Blobs werden als Ciphertext gespeichert und erst clientseitig entschlüsselt: `backend/app/main.py:1483-1554`, `frontend/src/contexts/E2EEContext.js:257-303`
- Private E2EE-Pfade verlangen ein verifiziertes Desktop-Gerät: `backend/app/main.py:421-430`

## 2. Bewertungsmatrix

| Kategorie | Status | Risiko |
|---|---|---|
| E2EE | BLOCKER | Critical |
| Streaming | BLOCKER | Critical |
| Login-System | BLOCKER | Critical |
| RBAC / ABAC | BLOCKER | Critical |
| Namenskonventionen | FAIL | Minor |
| i18n | FAIL | Major |
| Skalierbarkeit & Performance | FAIL | Major |

## 3. Detaillierte Findings pro Kategorie

## [E2EE] Keine belegbare Forward Secrecy oder Post-Compromise Security

- Status: BLOCKER

- Schweregrad: Critical

- Betroffene Datei(en): `frontend/src/lib/e2ee/crypto.js`, `frontend/src/contexts/E2EEContext.js`, `docs/mls-group-e2ee.md`, `docs/architecture.md`

- Code-Stelle: `frontend/src/lib/e2ee/crypto.js:24-151`, `frontend/src/contexts/E2EEContext.js:27-47`, `frontend/src/contexts/E2EEContext.js:198-239`, `docs/mls-group-e2ee.md:1-5`, `docs/mls-group-e2ee.md:156-168`, `docs/architecture.md:128-159`

- Beschreibung:

  Die produktive Implementierung basiert auf statischen Box-Keypairs, `crypto_box_seal`-Envelopes und XChaCha20-Poly1305 für Payloads. Im Code sind keine X3DH-, Double-Ratchet-, HKDF-, MLS- oder vergleichbaren ratchet-basierten Verfahren nachweisbar. Das eigene MLS-Dokument bezeichnet MLS explizit als Architektur-/Zukunftskonzept und „nicht implementiert als Code“. Die aktuelle Lösung verschlüsselt Nachrichten zwar clientseitig, liefert aber nicht die in modernen Messengern erwartete Forward Secrecy oder Post-Compromise Security.

- Warum relevant:

  Für eine Plattform, die sensible Kommunikation und „echte“ Ende-zu-Ende-Verschlüsselung beansprucht, ist dieser Unterschied fundamental. Ohne Ratchet-Mechanismen bleiben Kompromittierungen langlebiger und Key-Reuse-/Session-Compromise-Folgen größer als bei Signal-/MLS-artigen Protokollen.

- Empfehlung:

  Das Produktversprechen auf die tatsächlich implementierte Sicherheitsstufe zurückführen oder die Kryptografie auf ein belastbares Protokoll mit Pre-Keys, Ratcheting und dokumentierter Trust-/Rotation-Story anheben. Bis dahin die aktuelle Lösung explizit als „verschlüsselte Desktop-Kommunikation ohne Signal-/MLS-Eigenschaften“ kommunizieren.

- Re-Test:

  Architektur-Review gegen eine formale Protokollbeschreibung, Nachweis von X3DH/Double-Ratchet oder MLS im produktiven Code, plus gezielte Tests für Key Rotation, Session Recovery, Forward Secrecy und Device Compromise.

## [E2EE] Dokumentation und Legacy-Kryptopfad widersprechen der produktiven Implementierung

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/lib/crypto.js`, `docs/architecture.md`, `docs/mls-group-e2ee.md`

- Code-Stelle: `frontend/src/lib/crypto.js:1-57`, `docs/architecture.md:52`, `docs/architecture.md:113`, `docs/architecture.md:145`, `docs/architecture.md:159`, `docs/mls-group-e2ee.md:163-168`

- Beschreibung:

  Das Repository enthält parallel zur produktiven libsodium-basierten E2EE-Implementierung noch einen älteren WebCrypto-Pfad mit ECDH, AES-GCM und `localStorage`-Keypersistenz. Gleichzeitig beschreibt `docs/architecture.md` die E2EE-Implementierung weiterhin als „ECDH + AES-GCM“ und nennt `localStorage` als Key Storage, obwohl die produktive Desktop-Implementierung inzwischen OS Secure Storage und libsodium nutzt. Das MLS-Dokument sagt dagegen explizit, dass Channel-MLS noch nicht implementiert ist.

- Warum relevant:

  Kryptografische Altpfade und widersprüchliche Architekturtexte erhöhen das Risiko, dass spätere Änderungen, Audits oder Incident-Reaktionen auf falschen Annahmen aufbauen. Für Security-Claims ist diese Inkonsistenz besonders problematisch.

- Empfehlung:

  Einen kanonischen Kryptopfad definieren, Legacy-Kryptomodul und veraltete Dokumentation entweder entfernen oder klar als veraltet markieren, und die tatsächlichen Vertrauensgrenzen pro Raumtyp dokumentieren.

- Re-Test:

  Repo-weite Prüfung, dass nur noch ein produktiver Kryptostack vorhanden ist und alle Architektur-/Produkttexte dieselbe E2EE-Realität beschreiben.

## [E2EE] Metadaten-Exposition ist real, wird aber in Teilen der Doku überdeckt

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `backend/app/main.py`, `frontend/src/contexts/E2EEContext.js`, `docs/architecture.md`

- Code-Stelle: `backend/app/main.py:520-545`, `backend/app/main.py:2494-2533`, `backend/app/main.py:2557-2567`, `frontend/src/contexts/E2EEContext.js:49-55`, `docs/architecture.md:145`

- Beschreibung:

  Die Implementierung trennt Inhalt und Routing grundsätzlich sinnvoll, aber der Server sieht weiterhin relevante Metadaten wie Empfängerliste, `mentioned_user_ids`, `mentioned_role_ids`, `mentions_everyone`, Blob-Scopes, `participant_user_ids` und Kanal-/Zeitinformationen. `docs/architecture.md` formuliert dagegen pauschal „Server sieht nur Ciphertext. Klartext verlässt nie den Client.“ Das ist für Payload-Inhalte näherungsweise richtig, aber für Metadaten ungenau.

- Warum relevant:

  Metadaten sind bei Kommunikationsplattformen sicherheits- und datenschutzrelevant. Eine zu starke Formulierung im Produkttext erzeugt falsche Erwartungen und erschwert eine ehrliche Risikoabwägung für sensible Nutzung.

- Empfehlung:

  Die Dokumentation auf „Inhalte sind clientseitig verschlüsselt; Routing- und Zustellmetadaten bleiben serverseitig sichtbar“ korrigieren und diese Trennung auch in UI/Policy kommunizieren.

- Re-Test:

  Doku- und Produktreview gegen die tatsächlich gespeicherten Nachrichtendokumente und Blob-Metadaten.

## [Streaming] `join_voice` reicht aus, um Publishing zu erhalten; `speak` wird serverseitig nicht durchgesetzt

- Status: BLOCKER

- Schweregrad: Critical

- Betroffene Datei(en): `backend/app/main.py`, `backend/app/permissions.py`, `frontend/src/lib/workspacePermissions.js`

- Code-Stelle: `backend/app/permissions.py:16-20`, `frontend/src/lib/workspacePermissions.js:14-18`, `backend/app/main.py:2294-2323`

- Beschreibung:

  Das Berechtigungsmodell enthält `speak` und `priority_speaker`, aber der serverseitige Voice-Token-Pfad prüft nur `join_voice`. Anschließend wird im LiveKit-Token pauschal `can_publish=True` und `can_subscribe=True` gesetzt. Damit kann jeder Nutzer mit Join-Recht Audio/Video veröffentlichen, auch wenn `speak` im Modell eigentlich deaktiviert wäre.

- Warum relevant:

  Das ist eine echte Rechteumgehung im Runtime-Pfad. Der Code modelliert feinere Rechte, setzt sie aber beim Streaming nicht durch. Für Voice-Moderation, Stage-/Presenter-Modelle und Abuse-Prevention ist das ein Kernproblem.

- Empfehlung:

  Publishing- und Speak-Rechte serverseitig separat autorisieren und im Voice-Token nur die tatsächlich erlaubten Grants setzen. Falls ein separates Stream-/Screen-Share-Recht geplant ist, muss es ebenfalls serverseitig erzwungen werden.

- Re-Test:

  API-Tests für Kombinationen aus `join_voice=true/false`, `speak=true/false`, `stream=true/false` und anschließender Prüfung der LiveKit-Grants sowie realer Publish-Versuche.

## [Streaming] Architektur ist zwischen LiveKit-SFU und altem P2P-Signaling inkonsistent

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/lib/voiceEngine.js`, `backend/app/main.py`, `deploy/turnserver.conf`

- Code-Stelle: `frontend/src/lib/voiceEngine.js:260-290`, `backend/app/main.py:3076-3085`, `deploy/turnserver.conf:2-5`

- Beschreibung:

  Der produktive Voice-Client nutzt LiveKit und kommentiert browserseitiges Signaling als „not needed“. Gleichzeitig relayed der WebSocket-Server weiterhin `voice_offer`, `voice_answer` und `voice_ice`. Zusätzlich ist TURN nur als separate Infrastruktur vorhanden; `turnserver.conf` nutzt `static-auth-secret=change-me-turn-secret`, und im Review ist kein kurzlebiger TURN-Credential-Flow nachweisbar.

- Warum relevant:

  Parallel laufende oder veraltete Signaling-Pfade erhöhen Komplexität und Fehlkonfigurationen. Für Streaming-Sicherheit und Skalierung muss klar sein, ob das System SFU-zentriert oder P2P-zentriert arbeitet. Ein statisches TURN-Secret ist kein belastbarer Nachweis für sichere, kurzlebige ICE-Credentials.

- Empfehlung:

  Einen einzigen produktiven Signaling-/Media-Pfad definieren, Altpfade entfernen oder isolieren und TURN-Credential-Ausstellung serverseitig mit kurzer Lebensdauer dokumentieren und testen.

- Re-Test:

  Architekturtest mit deaktiviertem Alt-Signaling, Prüfung der tatsächlich verwendeten ICE-Server und Review der TURN-Credential-Generierung inklusive TTL.

## [Streaming] Native Desktop-Capture ist funktional unvollständig und plattformseitig eingeschränkt

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `desktop/src-tauri/src/native_capture.rs`, `frontend/src/lib/voiceEngine.js`

- Code-Stelle: `desktop/src-tauri/src/native_capture.rs:321-331`, `desktop/src-tauri/src/native_capture.rs:443-509`, `frontend/src/lib/voiceEngine.js:559-655`, `frontend/src/lib/voiceEngine.js:690-733`

- Beschreibung:

  Der native Capture-Pfad liefert mittlerweile rohe RGBA-Frames statt JPEG/Base64, ist aber explizit nur für Windows implementiert und meldet `has_audio: false`. Im Rust-Code ist Desktop-Audio „not wired into the public frontend bridge yet“. Damit ist der native Share-Pfad für das Zielbild „Discord-artiges Screen Sharing mit System-/Programmaudio“ noch nicht vollständig umgesetzt.

- Warum relevant:

  Für eine Kommunikationsplattform mit Screen-Sharing ist Video ohne konsistenten Audio-Pfad nur ein Teilfeature. Zusätzlich erzeugt die Windows-Only-Implementierung eine erhebliche Plattformlücke.

- Empfehlung:

  Den nativen Capture-Pfad erst nach vollständigem Audio- und Cross-Platform-Konzept als fertig kommunizieren. System- und App-Audio müssen im nativen Pfad klar nachweisbar werden.

- Re-Test:

  Plattformmatrix mit Windows/Linux/macOS, Video + Systemaudio + App-Audio, Qualitätsstufen und Rechteprüfung für Share-Start/-Stop.

## [Login-System] Refresh-Tokens werden nicht rotiert und serverseitig nicht widerrufen

- Status: BLOCKER

- Schweregrad: Critical

- Betroffene Datei(en): `backend/app/main.py`, `frontend/src/lib/api.js`, `frontend/src/contexts/AuthContext.js`

- Code-Stelle: `backend/app/main.py:148-152`, `backend/app/main.py:1215-1249`, `frontend/src/lib/api.js:56-88`, `frontend/src/contexts/AuthContext.js:179-186`

- Beschreibung:

  Refresh-Tokens sind einfache JWTs mit 7 Tagen Laufzeit. Der `/auth/refresh`-Pfad akzeptiert sie direkt, erstellt aber keinen neuen Refresh-Token und führt keine Rotation oder serverseitige Revocation-Prüfung durch. `/auth/logout` löscht Cookies und lokale Sessiondaten, invalidiert aber keine bereits ausgestellten Refresh-Tokens.

- Warum relevant:

  Ein exfiltrierter Refresh-Token bleibt bis zum Ablauf gültig. „Logout überall“, Session-Revocation und Geräte-Sperrung lassen sich so nicht belastbar erzwingen. Das ist für Desktop- und Mehrgeräte-Sessions ein kritischer Sicherheitsmangel.

- Empfehlung:

  Serverseitig verwaltete Refresh-Sessions mit Rotation, Revocation und Gerätebindung einführen. `logout` und sicherheitsrelevante Kontoänderungen müssen bestehende Refresh-Sessions serverseitig invalidieren.

- Re-Test:

  Tests für Refresh-Rotation, Reuse-Erkennung, Logout-all-devices, Passwortwechsel und Geräte-spezifische Token-Invalidierung.

## [Login-System] Passwort- und Session-Hardening bleibt unter aktuellem Sicherheitsstandard

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `backend/app/main.py`, `backend/requirements.txt`, `frontend/src/lib/authStorage.js`, `desktop/src-tauri/src/main.rs`

- Code-Stelle: `backend/app/main.py:116-120`, `backend/requirements.txt:12`, `frontend/src/lib/authStorage.js:1-39`, `desktop/src-tauri/src/main.rs:88-105`

- Beschreibung:

  Passwörter werden mit `bcrypt` statt Argon2id gehasht. Im Review ist zudem kein 2FA-/MFA-/WebAuthn-/Passkey-Pfad und kein klarer Brute-Force-/Rate-Limit-Schutz nachweisbar. Positiv ist, dass Desktop-Secrets über das OS-Keyring abgelegt werden und nicht im ungeschützten Web-Storage.

- Warum relevant:

  Ohne stärkere Passwort- und Session-Härtung bleibt die Kontosicherheit stark von Einzelpasswörtern abhängig. Gerade für eine Plattform mit sensibler Kommunikation und Desktop-Clients ist das unter dem erwartbaren Niveau.

- Empfehlung:

  Argon2id, Login-/Reset-Rate-Limits, optional 2FA/WebAuthn und serverseitig verwaltete Gerätesessions priorisieren. Die Keyring-Nutzung sollte beibehalten werden.

- Re-Test:

  Review der Hash-Parameter, Rate-Limit-Tests für Login/Forgot-Password und End-to-End-Tests für 2FA/WebAuthn, sobald vorhanden.

## [RBAC / ABAC] Kanal-Overrides werden gespeichert, aber nicht im zentralen Permission-Pfad ausgewertet

- Status: BLOCKER

- Schweregrad: Critical

- Betroffene Datei(en): `backend/app/permissions.py`, `backend/app/main.py`, `backend/routes_phase2.py`, `backend/routes_phase3.py`

- Code-Stelle: `backend/app/permissions.py:34-110`, `backend/app/main.py:231-236`, `backend/routes_phase2.py:400-424`, `backend/routes_phase2.py:760-761`, `backend/routes_phase3.py:95-100`

- Beschreibung:

  Das zentrale Permission-Modul berechnet nur Server-Level-Rechte aus Default-Rolle und Rollenrechten. Kanal-Overrides (`channel_overrides`) werden separat gespeichert und verwaltet, tauchen aber in `resolve_server_permissions`/`check_permission` nicht auf. Private Kanäle werden nur über `channel_access` gesondert geschützt; reguläre Kanal-Overwrites für `read_messages`, `send_messages`, `join_voice` usw. sind im serverseitigen Kernpfad nicht sichtbar.

- Warum relevant:

  Damit können konfigurierte Kanal-Policies und tatsächliche API-Enforcement auseinanderlaufen. Für eine Discord-ähnliche Plattform ist das ein Kern-Blocker, weil Sichtbarkeit und Rechte häufig auf Kanalebene überschrieben werden.

- Empfehlung:

  Eine zentrale, serverseitige Permission-Engine für Server, Kategorie und Kanal schaffen, inklusive Allow/Deny-Regeln und konsistenter Nutzung in allen Routen.

- Re-Test:

  Matrix-Tests für Serverrolle + Kanal-Allow + Kanal-Deny + Kategorie-Override + private channel access, jeweils gegen Backend-Endpunkte und nicht nur gegen die UI.

## [RBAC / ABAC] Client- und Server-Permission-Modell sind nicht äquivalent

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/lib/workspacePermissions.js`, `backend/app/permissions.py`, `backend/app/main.py`

- Code-Stelle: `frontend/src/lib/workspacePermissions.js:1-23`, `backend/app/permissions.py:3-25`, `backend/app/main.py:2294-2323`

- Beschreibung:

  Das Frontend modelliert Rechte wie `speak` und `priority_speaker`, das Backend kennt diese Flags ebenfalls, setzt sie aber im Voice-Runtime-Pfad nicht durch. Dadurch können UI-Capabilities und tatsächliche API-/Token-Rechte auseinanderlaufen.

- Warum relevant:

  Berechtigungssysteme sind nur dann belastbar, wenn die deklarierte Semantik im Frontend und die tatsächliche serverseitige Enforcement-Logik dieselbe Sprache sprechen. Hier ist das nachweisbar nicht der Fall.

- Empfehlung:

  Permission-Quellen vereinheitlichen und für jede relevante Aktion eine serverseitige Enforcement-Stelle definieren.

- Re-Test:

  Snapshot- und API-Tests, die dieselben Rollen einmal im Frontend und einmal gegen das Backend auswerten und Abweichungen sichtbar machen.

## [Namenskonventionen] Domänenbegriffe sind inkonsistent und erschweren Wartung

- Status: FAIL

- Schweregrad: Minor

- Betroffene Datei(en): `frontend/src/pages/MainLayout.js`, `frontend/src/i18n/locales/de.js`, `frontend/src/i18n/locales/en.js`, `docs/architecture.md`

- Code-Stelle: `frontend/src/pages/MainLayout.js:197`, `frontend/src/pages/OnboardingPage.js:32`, `frontend/src/i18n/locales/de.js:213-248`, `frontend/src/i18n/locales/en.js:211-248`, `docs/architecture.md:100-106`

- Beschreibung:

  Das Projekt verwendet für dasselbe Produktkonzept parallel Begriffe wie `server`, `community`, `workspace` und in Legacy-Dateien auch ältere UI-Bezeichnungen. Die aktive Codebasis ist damit zwar noch navigierbar, aber nicht begrifflich stringent.

- Warum relevant:

  In einer wachsenden Codebasis führt uneinheitliche Domänensprache zu Fehlannahmen, komplizierteren APIs und schwerer nachvollziehbaren Berechtigungs- und Datenmodellen.

- Empfehlung:

  Einen kanonischen Produktbegriff pro Ebene festlegen und Legacy-/UI-Terminologie danach ausrichten.

- Re-Test:

  Repo-weite Terminologieprüfung inklusive API-Namen, DTO-Feldern, UI-Texten und Dokumentation.

## [Namenskonventionen] Legacy-Komponenten und neue Settings-Shell existieren parallel

- Status: FAIL

- Schweregrad: Minor

- Betroffene Datei(en): `frontend/src/components/settings/GlobalSettingsOverlay.js`, `frontend/src/components/modals/UserSettingsModal.js`, `frontend/src/components/settings/ServerSettingsOverlay.js`, `frontend/src/components/modals/ServerSettingsModal.js`

- Code-Stelle: `frontend/src/components/modals/UserSettingsModal.js:58-97`, `frontend/src/components/modals/ServerSettingsModal.js:27-153`

- Beschreibung:

  Neben den neuen Settings-Overlays liegen weiterhin ältere Modal-Komponenten mit eigener Terminologie, eigenem Styling und eigenen Strings im Projekt. Das erhöht die Wahrscheinlichkeit, dass Fixes und Übersetzungen nur in einem Pfad landen.

- Warum relevant:

  Parallele UI-Pfade sind ein Wartbarkeitsrisiko und verschlechtern Konsistenz, besonders bei Security-, i18n- und Permission-bezogenen Oberflächen.

- Empfehlung:

  Veraltete Modal-Pfade klar stilllegen, entfernen oder als Legacy markieren, damit es nur noch einen aktiven UI-Pfad pro Feature gibt.

- Re-Test:

  Build-/Import-Review plus grep-basierte Prüfung, dass Legacy-UI nicht mehr im aktiven Nutzerpfad referenziert wird.

## [i18n] Deutsche Sprachdatei und Teile der Doku sind kodierungsbeschädigt

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/i18n/locales/de.js`, `docs/architecture.md`, `backend/routes_phase3.py`

- Code-Stelle: `frontend/src/i18n/locales/de.js:38-40`, `frontend/src/i18n/locales/de.js:110`, `frontend/src/i18n/locales/de.js:121`, `frontend/src/i18n/locales/de.js:263-268`, `docs/architecture.md:5`, `backend/routes_phase3.py:2-4`, `backend/routes_phase3.py:103`

- Beschreibung:

  Mehrere deutsche Strings enthalten Mojibake wie `verschlÃ¼sselte`, `WÃ¤hle`, `Ã¼bernehmen`, `lÃ¶schen`. Auch Kommentar-/Headerzeilen in Backend- und Doku-Dateien zeigen Encoding-Probleme.

- Warum relevant:

  Kodierungsfehler beschädigen nicht nur UX, sondern auch Vertrauen in sicherheitsrelevante Texte und Admin-Oberflächen. Bei einer mehrsprachigen Kommunikationsplattform ist das ein sichtbarer Qualitätsmangel.

- Empfehlung:

  Dateien konsequent UTF-8-korrigieren und Encoding-Checks in CI oder Pre-Commit aufnehmen.

- Re-Test:

  Locale-Snapshot-Review für alle aktiven Sprachdateien und Sichtprüfung zentraler UIs in mindestens DE/EN.

## [i18n] Es verbleiben zahlreiche hartcodierte UI-, Fehler- und Tauri-/Backend-Strings

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/pages/LoginPage.js`, `frontend/src/pages/MainLayout.js`, `frontend/src/components/settings/GlobalSettingsOverlay.js`, `frontend/src/components/chat/ChannelSidebar.js`, `desktop/src-tauri/src/main.rs`, `backend/app/main.py`

- Code-Stelle: `frontend/src/pages/LoginPage.js:38`, `frontend/src/pages/MainLayout.js:870`, `frontend/src/components/settings/GlobalSettingsOverlay.js:513-551`, `frontend/src/components/chat/ChannelSidebar.js:605-609`, `desktop/src-tauri/src/main.rs:239-260`, `backend/app/main.py:126-129`

- Beschreibung:

  In der aktiven Codebasis sind weiterhin zahlreiche fest verdrahtete englische Texte vorhanden, z. B. „Joined community“, „Unknown error“, „Use a longer recovery passphrase for end-to-end encryption.“ oder Rust-Fehlermeldungen wie „Choose a valid push-to-talk key first.“. Auch viele Backend-HTTPExceptions bleiben nur englisch.

- Warum relevant:

  Fehlende Lokalisierung zentraler Fehlermeldungen und Sicherheitshinweise führt zu inkonsistenter UX und erschwert korrekte Bedienung in nicht-englischen Umgebungen.

- Empfehlung:

  Alle nutzerrelevanten Strings, inklusive Rust-/Desktop-Fehler und Backend-Fehlertexte, in einen konsistenten i18n-/Fehlermeldungspfad überführen.

- Re-Test:

  String-Audit für aktive Routen und UIs, kombiniert mit Integrationstests, die Fehlerpfade in DE/EN rendern.

## [Skalierbarkeit & Performance] WebSocket- und Presence-Architektur ist nicht horizontal skalierbar

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `backend/app/ws.py`, `backend/app/main.py`

- Code-Stelle: `backend/app/ws.py:11-68`, `backend/app/main.py:959-1007`, `backend/app/main.py:3066-3085`

- Beschreibung:

  Der WebSocket-Manager hält Verbindungen und `user_servers` rein in-memory pro Prozess. Broadcasts laufen direkt über diese In-Memory-Strukturen. Ein Redis-/PubSub-/fanout-fähiger Pfad ist im Review nicht nachweisbar.

- Warum relevant:

  Schon bei mehreren Backend-Instanzen oder Restarts gehen Presence- und Realtime-Annahmen auseinander. Für eine Discord-ähnliche Plattform ist das ein klarer Skalierungsengpass.

- Empfehlung:

  Realtime-State und Fanout auf einen horizontal skalierbaren Broker/PubSub-Pfad umstellen und Presence-/Voice-/Typing-Signale pro Instanz konsistent synchronisieren.

- Re-Test:

  Zwei-Instanzen-Test mit geteilter Last, Presence-Änderungen, Typing und Message-Fanout über beide Instanzen hinweg.

## [Skalierbarkeit & Performance] Eager Loading und unbegrenzte Listenabfragen erzeugen Last- und Missbrauchsrisiken

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `frontend/src/pages/MainLayout.js`, `backend/app/main.py`

- Code-Stelle: `frontend/src/pages/MainLayout.js:112-139`, `frontend/src/pages/MainLayout.js:291-302`, `backend/app/main.py:366-370`, `backend/app/main.py:1961`, `backend/app/main.py:2455-2479`

- Beschreibung:

  Die UI lädt beim Öffnen eines Channels aktiv bis zu 50 Seiten á 200 Nachrichten zurück. Der Backend-Endpunkt `/channels/{channel_id}/messages` akzeptiert zudem ein freies `limit` und reicht es direkt an `.to_list(limit)` weiter. Zusätzlich existieren mehrere großvolumige `.to_list(2000)`- und `.to_list(5000)`-Abfragen bei Channel-, Message- und Membership-Operationen.

- Warum relevant:

  Diese Muster funktionieren für kleine Instanzen, sind aber für große Server und aggressive Clients ein Performance- und Missbrauchsrisiko. Sie erhöhen Speicherbedarf, Antwortlatenz und DB-Last.

- Empfehlung:

  API-Limits hart deckeln, serverseitig paginieren, Lazy Loading im Client einführen und großvolumige Sammelabfragen durch gezieltere Fanout-/Index-Pfade ersetzen.

- Re-Test:

  Lasttests mit großen Servern, hohem Channel-Volumen und bewusst hohen `limit`-Parametern gegen die Messages-API.

## [Querschnitt / Notifications] Benachrichtigungen sind nur best effort und teilweise optional verdrahtet

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `backend/routes_phase3.py`, `frontend/src/lib/pushNotifications.js`, `frontend/src/components/chat/NotificationPanel.js`, `frontend/src/pages/MainLayout.js`, `frontend/public/service-worker.js`

- Code-Stelle: `backend/routes_phase3.py:21-25`, `backend/routes_phase3.py:130-153`, `frontend/src/components/chat/NotificationPanel.js:16-33`, `frontend/src/pages/MainLayout.js:742-786`, `frontend/public/service-worker.js:3-39`

- Beschreibung:

  In-App-Notifications werden weiterhin per Polling aktualisiert. Web Push wird nur versucht, wenn `pywebpush` installiert ist und keine aktive „web“-Verbindung besteht. Fehlt `pywebpush`, degradiert der Pfad still zu „kein Push“. Der Bell-Feed pollt alle 20 Sekunden, Unread-Counts alle 15 Sekunden.

- Warum relevant:

  Das System wirkt aus Nutzersicht wie ein echtes Notification-System, ist technisch aber nur teilweise push-basiert und stark von optionalen Komponenten abhängig. Das erzeugt inkonsistente Zustellung und unnötige Dauerlast.

- Empfehlung:

  Notification-Zustellung als eigenes, klar dokumentiertes System behandeln: harte Abhängigkeiten definieren, WS/WebPush/Desktop-Pfade explizit testen und Polling nur als Ausnahme verwenden.

- Re-Test:

  Matrix-Test für aktive Web-Session, inaktiven Web-Tab, Desktop-App, fehlendes `pywebpush`, neue Nachricht, Mention und Systemevent.

## [Querschnitt / Tauri Runtime Hardening] Desktop-Sicherheitsoberfläche ist unnötig breit geöffnet

- Status: FAIL

- Schweregrad: Major

- Betroffene Datei(en): `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`, `desktop/src-tauri/src/main.rs`

- Code-Stelle: `desktop/src-tauri/tauri.conf.json:25`, `desktop/src-tauri/capabilities/default.json:8-13`, `desktop/src-tauri/src/main.rs:119-131`

- Beschreibung:

  Die Tauri-Konfiguration setzt `csp` auf `null`. Gleichzeitig ist in den Standard-Capabilities unter anderem `shell:default` aktiv. Außerdem liefert `get_desktop_runtime_info()` den Elevation-Zustand hart als `false` zurück. Das ist keine direkte Remote-Code-Execution, aber ein unnötig breites Runtime-/Hardening-Profil.

- Warum relevant:

  Desktop-Clients mit Kamera, Mikrofon, Capture und Deep Links sollten möglichst restriktiv konfiguriert sein. Unklare oder zu breite Capabilities vergrößern die Angriffsfläche und erschweren Security Reviews.

- Empfehlung:

  CSP und Capabilities auf den tatsächlichen Bedarf beschränken, Shell-Zugriffe explizit begrenzen und Runtime-Sicherheitsinformationen nicht statisch vortäuschen.

- Re-Test:

  Capability-Audit, CSP-Review und Exploit-orientierter Tauri-Hardening-Check gegen Production-Builds.

## 4. Checkliste pro Kategorie

### E2EE

| Unterpunkt | Status | Beleg |
|---|---|---|
| DMs clientseitig verschlüsselt vor dem Versand | PASS | `frontend/src/contexts/E2EEContext.js:198-212`, `backend/app/main.py:2503-2533` |
| Private Channels erzwingen verschlüsselten Desktop-Nachrichtenpfad | PASS | `backend/app/main.py:2503-2508` |
| Anhänge werden vor Upload clientseitig verschlüsselt | PASS | `frontend/src/contexts/E2EEContext.js:257-290`, `backend/app/main.py:1483-1554` |
| Moderne Ratchet-Verfahren wie X3DH / Double Ratchet / MLS produktiv nachweisbar | BLOCKER | `frontend/src/lib/e2ee/crypto.js:24-151`, `docs/mls-group-e2ee.md:1-5` |
| Schutz gegen Forward Secrecy / Post-Compromise Security nachweisbar | BLOCKER | kein Nachweis im produktiven Code |
| Key Rotation / Device Linking / Recovery vorhanden | PASS | `backend/app/main.py:1323-1405`, `frontend/src/contexts/E2EEContext.js:143-187` |
| Trust Verification / Gesprächsnahe UI-Transparenz vollständig vorhanden | FAIL | Gerätefingerprint nur in Settings sichtbar, kein klarer per-Conversation-Key-Change-/Verification-Flow nachgewiesen |
| Metadaten sauber vom Schutzversprechen getrennt dokumentiert | FAIL | `docs/architecture.md:145`, `backend/app/main.py:2557-2567` |

### Streaming

| Unterpunkt | Status | Beleg |
|---|---|---|
| Server prüft Connect-/Join-Rechte | PASS | `backend/app/main.py:2294-2305` |
| Server prüft Speak-/Publish-/Stream-Rechte getrennt | BLOCKER | `backend/app/main.py:2294-2323`, `backend/app/permissions.py:16-20` |
| LiveKit/SFU-Pfad ist erkennbar | PASS | `frontend/src/lib/voiceEngine.js:260-290` |
| ICE / STUN / TURN / Credential-TTL belastbar dokumentiert | BLOCKER | kein kurzlebiger Credential-Flow nachweisbar; `deploy/turnserver.conf:2-5` |
| Alte P2P-/SDP-/ICE-Pfade entfernt oder klar inaktiv | FAIL | `backend/app/main.py:3076-3085` |
| Screen Share mit nativer Videoquelle vorhanden | PASS | `desktop/src-tauri/src/native_capture.rs:201-331`, `frontend/src/lib/voiceEngine.js:559-655` |
| Native System-/Programmaudio im nativen Share-Pfad fertig verdrahtet | FAIL | `desktop/src-tauri/src/native_capture.rs:330-331` |
| Rekonnektion / schwaches Netz / Jitter / Loss robust belegt | BLOCKER | kein belastbarer Nachweis im Review |

### Login-System

| Unterpunkt | Status | Beleg |
|---|---|---|
| Desktop speichert Tokens im Secure Storage statt localStorage | PASS | `frontend/src/lib/authStorage.js:1-39`, `desktop/src-tauri/src/main.rs:88-105` |
| Web-Session nutzt Cookies statt Local Storage | PASS | `frontend/src/contexts/AuthContext.js:84-90`, `frontend/src/lib/api.js:19-29` |
| Refresh-Token-Rotation | BLOCKER | `backend/app/main.py:1235-1249`, `frontend/src/lib/api.js:56-74` |
| Serverseitige Session-Revocation / Logout überall | BLOCKER | `backend/app/main.py:1215-1227` |
| Passwort-Hashing mit Argon2id | FAIL | `backend/app/main.py:116-120` |
| 2FA / MFA / WebAuthn / Passkeys | FAIL | kein Implementierungsnachweis im Review |
| Brute-Force-/Rate-Limit-Schutz | BLOCKER | kein Nachweis in Backend-Routen / Middleware |
| Deep-Link-/Desktop-Login-Redirect-Hardening | FAIL | Deep links vorhanden, aber kein zusätzlicher Validierungsnachweis im Review |

### RBAC / ABAC

| Unterpunkt | Status | Beleg |
|---|---|---|
| Zentrale Server-Permission-Quelle vorhanden | PASS | `backend/app/permissions.py:34-110` |
| Default-Rolle + Rollenrechte werden serverseitig ausgewertet | PASS | `backend/app/permissions.py:48-57`, `backend/app/permissions.py:85-98` |
| Kanal-Overrides in zentraler Permission-Auswertung | BLOCKER | `backend/routes_phase2.py:400-424` vs. `backend/app/permissions.py:34-110` |
| Private-Channel-Zugriff wird serverseitig geprüft | PASS | `backend/routes_phase3.py:95-100`, `backend/app/main.py:505-510` |
| Allow/Deny-Konflikte und Deny-Priorität klar implementiert | FAIL | im zentralen Resolver nicht nachweisbar |
| Voice-Rechte (`join_voice`, `speak`, `stream`) konsistent serverseitig enforced | BLOCKER | `backend/app/main.py:2294-2323` |
| Rechte lassen sich nicht nur per UI, sondern auch per API verhindern | FAIL | für Kanal-Overrides und `speak` nicht konsistent belegt |
| Auditierbare ACL-Änderungen unveränderbar protokolliert | BLOCKER | Audit-Log vorhanden, Unveränderbarkeit/Append-only nicht belegt |

### Namenskonventionen

| Unterpunkt | Status | Beleg |
|---|---|---|
| Einheitliche Begriffe für Hauptdomänenobjekte | FAIL | `community`, `server`, `workspace` parallel in Frontend/Doku |
| Datei-/Ordnerstruktur grundsätzlich nachvollziehbar | PASS | Frontend/Backend/Desktop klar getrennt |
| Legacy- und neue UI-Pfade sauber getrennt oder bereinigt | FAIL | `ServerSettingsOverlay` und `ServerSettingsModal` parallel vorhanden |
| Sprachdateien konsistent benannt | PASS | `frontend/src/i18n/locales/de.js`, `en.js` |

### i18n

| Unterpunkt | Status | Beleg |
|---|---|---|
| DE/EN-Sprachdateien vorhanden | PASS | `frontend/src/i18n/locales/de.js`, `en.js` |
| Kodierung der Sprachdateien sauber | FAIL | `frontend/src/i18n/locales/de.js:38-40`, `110`, `121`, `263-268` |
| Nutzerrelevante Strings vollständig lokalisiert | FAIL | harte Strings in `LoginPage.js`, `GlobalSettingsOverlay.js`, `ChannelSidebar.js`, Rust |
| Sicherheits- und Fehlermeldungen lokalisiert | FAIL | zahlreiche Backend-/Rust-/Toast-Strings nur Englisch |
| Weitere Zielsprachen wie FR/ES vorhanden | BLOCKER | im aktuellen Repo nicht nachweisbar |
| Plural-/ICU-Handling breit belegt | BLOCKER | kein belastbarer Nachweis im Review |

### Skalierbarkeit & Performance

| Unterpunkt | Status | Beleg |
|---|---|---|
| Horizontale Skalierung für WS/Presence belegt | FAIL | `backend/app/ws.py:11-68` |
| Redis / PubSub / Queueing für Fanout belegt | BLOCKER | kein Nachweis |
| Große Server werden inkrementell und effizient geladen | FAIL | `frontend/src/pages/MainLayout.js:115-139` |
| Messages-API hat harte Paging-/Limit-Grenzen | FAIL | `backend/app/main.py:2455-2479` |
| Presence / Typing / Notifications vermeiden Polling-Stürme | FAIL | `frontend/src/components/chat/NotificationPanel.js:16-33`, `frontend/src/pages/MainLayout.js:742-786` |
| Lasttests / P99 / Voice-Load-Nachweise vorhanden | BLOCKER | kein Nachweis im Review |

## 5. Re-Test-Vorschläge

1. Kryptografie-Audit gegen eine formale E2EE-Spezifikation:
   - Nachweis der tatsächlich eingesetzten Primitive
   - Nachweis von Session-Aufbau, Rotation, Recovery, Trust Verification
   - explizite Tests für Forward Secrecy / Device Revoke / Recovery Restore

2. Berechtigungs-Matrix-Test gegen das Backend:
   - Owner/Admin/Member/Guest
   - Server- und Kanal-Overrides
   - `read_messages`, `send_messages`, `attach_files`, `join_voice`, `speak`, `manage_channels`
   - API-Aufrufe direkt gegen versteckte oder deny-überschriebene Kanäle

3. Auth-/Session-Sicherheit:
   - Refresh-Rotation
   - Logout überall
   - Passwortwechsel invalidiert Sessions
   - Rate-Limit- und Brute-Force-Tests

4. Streaming-Rechte und Runtime:
   - Join ohne Speak
   - Speak ohne Stream
   - Screen Share ohne Presenter-Recht
   - LiveKit-Grant-Prüfung pro Rolle
   - TURN-Credential-TTL prüfen

5. Notifications:
   - Web aktiv / Web inaktiv / Desktop aktiv / Mobile später
   - Mention, DM, Systemevent
   - Mit und ohne `pywebpush`
   - Service Worker Registrierung, Subscription, Zustellung, Click-Handling

6. Performance:
   - großer Server mit vielen Kanälen
   - tiefe Chat-Historien
   - viele gleichzeitige Voice-States / Typing-Events
   - mehr als eine Backend-Instanz mit Presence- und Notification-Fanout

7. i18n:
   - DE/EN Smoke-Test über Auth, Settings, Voice, Fehlerpfade
   - UTF-8-/Encoding-Lint für Locale- und Doku-Dateien
   - grep-basierter Audit für harte Strings in Frontend, Backend und Tauri
