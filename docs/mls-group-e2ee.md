# Singra Vox MLS-Gruppen-E2EE

## Status

Dieses Dokument beschreibt den **Zielpfad**, nicht produktiven Code.

MLS ist in Singra Vox aktuell **nicht implementiert**. Die produktive Gruppenverschlüsselung in v1 ist `encrypted_v1` und soll später sauber auf einen MLS-basierten Pfad migriert werden, statt heute bereits eine halbfertige Ratchet-Behauptung auszusprechen.

## Warum MLS der Zielpfad ist

MLS ist für Gruppenkommunikation der richtige langfristige Standard, weil es Eigenschaften liefert, die die aktuelle v1-Implementierung nicht belegt:
- Forward Secrecy
- Post-Compromise Security
- effiziente Member-Änderungen
- standardisierte Group-State-Übergänge

## Was heute produktiv gilt

Der aktuelle produktive Stand:
- DMs: verschlüsselt v1
- Gruppen-DMs: verschlüsselt v1
- private Server-Kanäle: verschlüsselt v1
- private Voice-Räume: LiveKit-E2EE + app-seitige Schlüsselverteilung

Das ist **nicht** MLS.

## Migrationsgrenze

Die produktive Codebasis sollte MLS später hinter klaren Versionierungsgrenzen einführen:
- `ConversationSecurityModel`
- `RecipientKeyProvider`
- `EnvelopeService`

Damit bleibt `encrypted_v1` ein stabiler Legacy-/Migrationspfad und MLS kann ohne semantisches Durcheinander ergänzt werden.

## Produktanforderung für eine spätere MLS-Einführung

Vor einer echten MLS-Einführung müssen mindestens erfüllt sein:
1. stabile Bibliotheksbasis für Desktop und Web
2. belastbare Tests für Add/Remove/Rotate/Recovery
3. klare UX für Gerätevertrauen und Schlüsseländerungen
4. nachvollziehbare Migration bestehender `encrypted_v1`-Räume

## Harte Regel

Bis MLS produktiv implementiert und getestet ist, darf Singra Vox nicht behaupten, dass Gruppen-E2EE Signal-/MLS-Eigenschaften wie Forward Secrecy oder Post-Compromise Security vollständig liefert.
