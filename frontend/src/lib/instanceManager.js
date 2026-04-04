/**
 * InstanceManager – Gespeicherte Server-Instanzen verwalten
 *
 * Speichert Name, URL und optionale Auto-Login-Daten (Passwort einfach
 * verschlüsselt via btoa – für echte Absicherung im Desktop nutzt das
 * OS-Keychain via authStorage.js).
 */

const INSTANCES_KEY = "singravox.saved_instances";

function _obfuscate(str) {
  if (!str) return "";
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return ""; }
}
function _deobfuscate(str) {
  if (!str) return "";
  try { return decodeURIComponent(escape(atob(str))); } catch { return ""; }
}

/** Gibt alle gespeicherten Instanzen zurück. */
export function getSavedInstances() {
  try {
    const raw = window.localStorage.getItem(INSTANCES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Speichert oder aktualisiert eine Instanz (matching via URL). */
export function saveInstance({ name, url, email = "", password = "" }) {
  const instances = getSavedInstances();
  const normalizedUrl = url.trim().replace(/\/+$/, "");
  const existingIdx = instances.findIndex((i) => i.url === normalizedUrl);
  const entry = {
    id: existingIdx >= 0 ? instances[existingIdx].id : crypto.randomUUID(),
    name: name || normalizedUrl,
    url: normalizedUrl,
    savedAt: new Date().toISOString(),
    email: email || "",
    _pw: _obfuscate(password),
  };
  if (existingIdx >= 0) {
    instances[existingIdx] = entry;
  } else {
    instances.push(entry);
  }
  window.localStorage.setItem(INSTANCES_KEY, JSON.stringify(instances));
  return instances;
}

/** Löscht eine gespeicherte Instanz nach ID. */
export function removeInstance(id) {
  const next = getSavedInstances().filter((i) => i.id !== id);
  window.localStorage.setItem(INSTANCES_KEY, JSON.stringify(next));
  return next;
}

/** Gibt Klartext-Passwort einer Instanz zurück. */
export function getInstancePassword(instance) {
  return _deobfuscate(instance?._pw || "");
}

/** Gibt die aktuell aktive Instance-URL zurück. */
export function getActiveInstanceUrl() {
  return window.localStorage.getItem("singravox.instance_url") || "";
}
