/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

function normalizeMainKeyToken(part) {
  if (!part) {
    return null;
  }

  const normalized = String(part).trim();
  if (!normalized) {
    return null;
  }

  if (/^key[a-z]$/i.test(normalized)) {
    return normalized.slice(3).toLowerCase();
  }

  if (/^digit[0-9]$/i.test(normalized)) {
    return normalized.slice(5);
  }

  const upper = normalized.toUpperCase();
  const aliases = {
    SPACEBAR: "Space",
    SPACE: "Space",
    ESC: "Esc",
    ESCAPE: "Esc",
    TAB: "Tab",
    ENTER: "Enter",
    BACKSPACE: "Backspace",
    INSERT: "Insert",
    DELETE: "Delete",
    HOME: "Home",
    END: "End",
    PAGEUP: "PageUp",
    PAGEDOWN: "PageDown",
    ARROWUP: "Up",
    UP: "Up",
    ARROWDOWN: "Down",
    DOWN: "Down",
    ARROWLEFT: "Left",
    LEFT: "Left",
    ARROWRIGHT: "Right",
    RIGHT: "Right",
    VOLUMEMUTE: "VolumeMute",
    AUDIOVOLUMEMUTE: "VolumeMute",
    VOLUMEUP: "VolumeUp",
    AUDIOVOLUMEUP: "VolumeUp",
    VOLUMEDOWN: "VolumeDown",
    AUDIOVOLUMEDOWN: "VolumeDown",
  };

  if (aliases[upper]) {
    return aliases[upper];
  }

  if (/^F\d{1,2}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (normalized.length === 1) {
    if (/^[a-z]$/i.test(normalized)) {
      return normalized.toLowerCase();
    }
    return normalized;
  }

  return normalized;
}

function formatModifierLabel(shortcut) {
  if (shortcut === "Ctrl") return "Strg";
  if (shortcut === "Meta") return "Win";
  return shortcut;
}

function normalizeMainKeyFromCode(code) {
  if (!code) {
    return null;
  }

  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;

  const explicit = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Escape: "Esc",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };

  return explicit[code] || null;
}

function normalizeMainKeyFromEvent(event) {
  const key = event?.key;
  if (!key) {
    return normalizeMainKeyFromCode(event?.code);
  }

  if (key === " ") {
    return "Space";
  }

  if (key.length === 1) {
    // Use the logical key value instead of the physical US keyboard position so
    // layouts like QWERTZ keep Z/Y and other printable keys aligned with the
    // user's actual system layout.
    if (/^[a-z0-9]$/i.test(key)) {
      return key.toLowerCase();
    }
    if (/^[\[\]\\;\',./`\-=]$/.test(key)) {
      return key;
    }
    return null;
  }

  const explicit = {
    Escape: "Esc",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    "AudioVolumeMute": "VolumeMute",
    "AudioVolumeUp": "VolumeUp",
    "AudioVolumeDown": "VolumeDown",
  };

  return explicit[key] || normalizeMainKeyFromCode(event?.code);
}

function normalizeShortcutParts(shortcut) {
  if (!shortcut) {
    return [];
  }

  return String(shortcut)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === "shift") return "Shift";
      if (normalized === "alt") return "Alt";
      if (normalized === "control") return "Ctrl";
      if (normalized === "cmdorctrl" || normalized === "commandorcontrol") return "Ctrl";
      if (normalized === "cmd" || normalized === "command" || normalized === "meta" || normalized === "super") return "Meta";
      if (normalized === "option") return "Alt";
      if (normalized === "esc" || normalized === "escape") return "Esc";
      if (normalized === "spacebar" || normalized === "space") return "Space";
      const mainKey = normalizeMainKeyToken(part);
      if (mainKey) {
        return mainKey;
      }
      return part;
    });
}

export function normalizePttShortcut(shortcut) {
  const parts = normalizeShortcutParts(shortcut);
  if (parts.length === 0) {
    return "";
  }

  const modifierSet = new Set();
  let mainKey = null;

  parts.forEach((part) => {
    if (part === "Ctrl" || part === "Alt" || part === "Shift" || part === "Meta") {
      modifierSet.add(part);
      return;
    }
    if (!mainKey) {
      mainKey = part;
    }
  });

  if (!mainKey) {
    return "";
  }

  const modifiers = ["Ctrl", "Alt", "Shift", "Meta"].filter((modifier) => modifierSet.has(modifier));
  return [...modifiers, mainKey].join("+");
}

export function describePttShortcut(shortcut, { locale = "en" } = {}) {
  const normalized = normalizePttShortcut(shortcut);
  if (!normalized) {
    return "";
  }

  return normalized
    .split("+")
    .map((part) => {
      if (part === "Space") {
        return locale.startsWith("de") ? "Leertaste" : "Space";
      }
      if (part.length === 1 && /^[a-z]$/i.test(part)) {
        return part.toUpperCase();
      }
      return locale.startsWith("de") ? formatModifierLabel(part) : part;
    })
    .join("+");
}

export function capturePttShortcut(event) {
  if (!event?.code || MODIFIER_CODES.has(event.code)) {
    return null;
  }

  const mainKey = normalizeMainKeyFromEvent(event);
  if (!mainKey) {
    return null;
  }

  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");

  const accelerator = [...modifiers, mainKey].join("+");
  return {
    accelerator,
    label: describePttShortcut(accelerator, {
      locale: typeof document !== "undefined" ? document.documentElement.lang || "en" : "en",
    }),
  };
}

export function matchesPttShortcut(event, shortcut) {
  const captured = capturePttShortcut(event);
  if (!captured) {
    return false;
  }
  return normalizePttShortcut(captured.accelerator) === normalizePttShortcut(shortcut);
}
