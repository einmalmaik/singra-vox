# Cleanup Changelog (2026-04-03)

## Entfernt

### Repository-/Tooling-Artefakte (nicht Teil des Produkts)
- `/.gitconfig`
  - Grund: lokales Git-Userprofil eines Tools; gehört nicht ins Repository und überschreibt potenziell Entwickler-Setups.
- `/.emergent/`
  - Grund: platform-/job-spezifische Metadaten; nicht nötig für Build/Run der Anwendung.
- `/test_result.md`
  - Grund: agent-spezifisches Protokoll-/Kommunikationsdokument; nicht projekt-relevant.

### Unsichere/extern gekoppelte Test-Skripte (Secrets/Hardcodings)
- `/backend_test.py`
  - Grund: enthält hardcodierte Admin-Credentials und eine externe Preview-Base-URL; nicht geeignet für ein öffentliches Repo.
- `/phase35_backend_test.py`
  - Grund: enthält hardcodierte Admin-Credentials und eine externe Preview-Base-URL; nicht geeignet für ein öffentliches Repo.

### Unbenutzte UI-Template-Dateien
- `/template/`
  - Grund: offensichtlich nicht in Build- oder Runtime-Pfaden referenziert; Datei-Inhalt ist eine React-Komponente, aber liegt als `index.html` im Template-Ordner.

## Hinweise
- Keine produktiven Laufzeit-Abhängigkeiten entfernt.
- Keine in `docs/` referenzierten Setup-Skripte (`install.sh`, Desktop-Helper-Skripte) entfernt.

