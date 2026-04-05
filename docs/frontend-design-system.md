# Singra Vox – Frontend Design System

## Überblick

Das Frontend nutzt ein **CSS-Variablen-basiertes Design-Token-System** kombiniert
mit Tailwind CSS.  Alle visuellen Entscheidungen sind zentral definiert und
können an EINER Stelle geändert werden.

---

## Architektur

```
index.css                    ← Design-Tokens (CSS-Variablen)
    │
    ▼
tailwind.config.js           ← Referenziert CSS-Variablen als Tailwind-Farben
    │
    ▼
Komponenten (.js/.jsx)       ← Nutzen Tailwind-Klassen (bg-primary, text-muted, etc.)
    │
App.css                      ← Komponentenspezifische Styles & Animationen
```

### Warum so?
- **Eine Quelle der Wahrheit:** CSS-Variablen in `index.css` `:root`
- **Tailwind-Integration:** `tailwind.config.js` mapped Variablen auf Klassennamen
- **Keine Magic Numbers:** Farben, Abstände, Radien aus Variablen
- **Theme-fähig:** Light/Dark-Theme durch Ändern der CSS-Variablen

---

## Design-Tokens (index.css :root)

### Farben

| Token | HSL-Wert | Verwendung |
|-------|----------|------------|
| `--background` | `0 0% 4%` | Haupt-Hintergrund (fast schwarz) |
| `--foreground` | `0 0% 100%` | Standard-Textfarbe (weiß) |
| `--card` | `0 0% 7%` | Karten-Hintergrund |
| `--popover` | `0 0% 9%` | Popover/Dropdown-Hintergrund |
| `--primary` | `189 94% 43%` | Primärfarbe (Cyan) |
| `--secondary` | `0 0% 15%` | Sekundäre Elemente |
| `--muted` | `0 0% 15%` | Gedämpfte Bereiche |
| `--muted-foreground` | `0 0% 64%` | Gedämpfter Text |
| `--accent` | `0 0% 15%` | Akzent-Farbe |
| `--destructive` | `0 84% 60%` | Warnungen/Löschaktionen (Rot) |
| `--border` | `0 0% 15%` | Rahmenfarbe |
| `--ring` | `189 94% 43%` | Fokus-Ring (Cyan) |
| `--radius` | `0.375rem` | Standard-Eckenradius |

### Schriften

| Schrift | Verwendung |
|---------|------------|
| `Manrope` (400-800) | Überschriften (h1-h6) |
| `IBM Plex Sans` (400-700) | Fließtext, UI-Elemente |
| `JetBrains Mono` (400-500) | Code-Blöcke, Monospace |

---

## Workspace-Klassen (index.css @layer components)

Wiederverwendbare CSS-Klassen für konsistente Panels und Elemente:

| Klasse | Verwendung | Beschreibung |
|--------|------------|--------------|
| `.workspace-panel` | Sidebar, Chatbereich | Runde Ecken, Glasmorphismus, Schatten |
| `.workspace-panel-solid` | Vollflächige Panels | Wie panel, aber opaker |
| `.workspace-card` | Eingebettete Karten | Leichtere Variante von panel |
| `.workspace-divider` | Trennlinien | Subtile weiße Linie (5% Opacity) |
| `.workspace-toolbar-button` | Toolbar-Buttons | Hover-Effekte, konsistente Größe |
| `.workspace-icon-button` | Icon-Buttons (9×9) | Rund, mit Hover-Animation |
| `.workspace-input-shell` | Nachrichteneingabe | Gerundet, Glasmorphismus |
| `.workspace-section-label` | Abschnitts-Titel | Uppercase, Tracking, Klein |
| `.workspace-cyan-glow` | Aktive Elemente | Cyan-Leuchteffekt (Box-Shadow) |

### Beispiel
```jsx
<div className="workspace-panel p-4">
  <h3 className="workspace-section-label">Channels</h3>
  <button className="workspace-toolbar-button px-3 py-2">
    General
  </button>
</div>
```

---

## Animationen (App.css)

| Klasse | Animation | Dauer |
|--------|-----------|-------|
| `.server-icon` | Eckenradius-Übergang beim Hover | 0.2s |
| `.server-icon.active` | Cyan-Gradient + Leuchtschatten | — |
| `.channel-item` | Hintergrund/Farbe beim Hover | 0.15s |
| `.message-item:hover` | Subtiler Hintergrund | — |
| `.typing-dot` | Pulsierender Tipp-Indikator | 1.4s |
| `.voice-active` | Cyan-Puls-Animation | 1.8s |
| `.fade-in` | Einblend-Animation (translateY) | 0.2s |
| `.status-*` | Status-Punkt-Farben (online/offline/away/dnd) | — |

---

## Theme ändern

### Dark Theme anpassen (Standard)
Ändere die CSS-Variablen in `index.css`:

```css
:root {
  --background: 0 0% 4%;      /* ← Dunkler/heller machen */
  --primary: 189 94% 43%;     /* ← Andere Akzentfarbe */
  --destructive: 0 84% 60%;   /* ← Warnfarbe ändern */
}
```

### Light Theme hinzufügen

```css
.light {
  --background: 0 0% 98%;
  --foreground: 0 0% 4%;
  --card: 0 0% 95%;
  --primary: 189 94% 35%;
  --muted-foreground: 0 0% 40%;
  --border: 0 0% 85%;
}
```

### Eigene Akzentfarbe

```css
/* Lila statt Cyan */
:root {
  --primary: 270 90% 55%;
  --ring: 270 90% 55%;
}
```
→ Alle Buttons, Links, Fokus-Ringe, Glow-Effekte ändern sich automatisch.

---

## Neue Komponente erstellen (Konventionen)

1. **Datei:** `frontend/src/components/<bereich>/<Name>.js`
2. **Styling:** Nur Tailwind-Klassen + Workspace-Klassen
3. **Farben:** NUR aus Design-Tokens (`bg-primary`, `text-muted-foreground`)
4. **Keine hardkodierten Farben** in Komponenten
5. **data-testid** auf jedem interaktiven Element
6. **Übersetzungen** via `useTranslation()` (i18n)

### Beispiel-Vorlage
```jsx
import { useTranslation } from "react-i18next";

export default function MyComponent({ onAction }) {
  const { t } = useTranslation();

  return (
    <div data-testid="my-component" className="workspace-card p-4">
      <h3 className="workspace-section-label">
        {t("my.sectionTitle")}
      </h3>
      <button
        data-testid="my-component-action-btn"
        className="workspace-toolbar-button px-4 py-2"
        onClick={onAction}
      >
        {t("my.actionButton")}
      </button>
    </div>
  );
}
```

---

## Status-Farben

In `App.css` definiert, konsistent verwendbar:

| Status | Klasse | Farbe |
|--------|--------|-------|
| Online | `.status-online` | #22C55E (Grün) |
| Offline | `.status-offline` | #71717A (Grau) |
| Abwesend | `.status-away` | #F59E0B (Gelb) |
| Nicht stören | `.status-dnd` | #EF4444 (Rot) |

---

## Sounds & Notifications

### Voice-Sounds
- **Join:** Aufsteigende Töne (880Hz → 1047Hz)
- **Leave:** Absteigende Töne (1047Hz → 659Hz)
- Generiert via Web Audio API (Oszillator), keine Audiodateien nötig
- **DND-Modus:** Keine Sounds bei join/leave anderer Nutzer

### Notifications
- **Push Notifications:** Web Push API (VAPID)
- **In-App Toast:** Nur wenn nicht DND
- **DND-Modus:** Alle UI-Benachrichtigungen unterdrückt, Daten werden weiterhin gespeichert
