/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * InstanceManager – Gespeicherte Server-Instanzen verwalten
 *
 * Speichert Name, URL und optionale Auto-Login-Daten (Passwort einfach
 * verschlüsselt via btoa – für echte Absicherung im Desktop nutzt das
 * OS-Keychain via authStorage.js).
 */

const INSTANCES_KEY = "singravox.saved_instances";
const ACTIVE_INSTANCE_URL_KEY = "singravox.instance_url";
const INSTANCE_SELECTION_REQUIRED_KEY = "singravox.instance_selection_required";

export function normalizeInstanceUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function persistInstances(instances) {
  window.localStorage.setItem(INSTANCES_KEY, JSON.stringify(instances));
  return instances;
}

function getReconnectTimestamp(instance) {
  const value = Date.parse(instance?.lastUsedAt || instance?.savedAt || "");
  return Number.isNaN(value) ? 0 : value;
}

function _obfuscate(str) {
  if (!str) return "";
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return ""; }
}
function _deobfuscate(str) {
  if (!str) return "";
  try { return decodeURIComponent(escape(atob(str))); } catch { return ""; }
}

function createInstanceId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `instance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const normalizedUrl = normalizeInstanceUrl(url);
  const existingIdx = instances.findIndex((i) => i.url === normalizedUrl);
  const entry = {
    id: existingIdx >= 0 ? instances[existingIdx].id : createInstanceId(),
    name: name || normalizedUrl,
    url: normalizedUrl,
    savedAt: new Date().toISOString(),
    lastUsedAt: existingIdx >= 0 ? (instances[existingIdx].lastUsedAt || null) : null,
    isFavorite: existingIdx >= 0 ? (instances[existingIdx].isFavorite || false) : false,
    email: email || "",
    _pw: _obfuscate(password),
  };
  if (existingIdx >= 0) {
    instances[existingIdx] = entry;
  } else {
    instances.push(entry);
  }
  return persistInstances(instances);
}

/** Setzt `lastUsedAt` auf jetzt (beim Verbinden aufrufen). */
export function markInstanceUsed(id) {
  const instances = getSavedInstances().map((i) =>
    i.id === id ? { ...i, lastUsedAt: new Date().toISOString() } : i
  );
  return persistInstances(instances);
}

/** Toggled den Favoriten-Stern einer Instanz. */
export function toggleInstanceFavorite(id) {
  const instances = getSavedInstances().map((i) =>
    i.id === id ? { ...i, isFavorite: !i.isFavorite } : i
  );
  return persistInstances(instances);
}

/** Sortiert Instanzen: Favoriten zuerst, dann nach lastUsedAt (neueste zuerst). */
export function sortedInstances(instances) {
  return [...instances].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    const ta = getReconnectTimestamp(a);
    const tb = getReconnectTimestamp(b);
    return tb - ta;
  });
}

/** Löscht eine gespeicherte Instanz nach ID. */
export function removeInstance(id) {
  const next = getSavedInstances().filter((i) => i.id !== id);
  return persistInstances(next);
}

/** Gibt Klartext-Passwort einer Instanz zurück. */
export function getInstancePassword(instance) {
  return _deobfuscate(instance?._pw || "");
}

/** Gibt die aktuell aktive Instance-URL zurück. */
export function getActiveInstanceUrl() {
  return normalizeInstanceUrl(window.localStorage.getItem(ACTIVE_INSTANCE_URL_KEY));
}

export function setActiveInstanceUrl(instanceUrl) {
  const normalizedUrl = normalizeInstanceUrl(instanceUrl);
  if (!normalizedUrl) {
    window.localStorage.removeItem(ACTIVE_INSTANCE_URL_KEY);
    return "";
  }
  window.localStorage.setItem(ACTIVE_INSTANCE_URL_KEY, normalizedUrl);
  return normalizedUrl;
}

export function clearActiveInstanceUrl() {
  window.localStorage.removeItem(ACTIVE_INSTANCE_URL_KEY);
}

export function requiresManualInstanceSelection() {
  return window.localStorage.getItem(INSTANCE_SELECTION_REQUIRED_KEY) === "1";
}

export function setManualInstanceSelectionRequired(required) {
  if (required) {
    window.localStorage.setItem(INSTANCE_SELECTION_REQUIRED_KEY, "1");
    return;
  }
  window.localStorage.removeItem(INSTANCE_SELECTION_REQUIRED_KEY);
}

export function getReconnectCandidate() {
  const [candidate] = [...getSavedInstances()]
    .filter((instance) => normalizeInstanceUrl(instance?.url))
    .sort((left, right) => getReconnectTimestamp(right) - getReconnectTimestamp(left));
  return candidate || null;
}

export function getReconnectInstanceUrl() {
  return normalizeInstanceUrl(getReconnectCandidate()?.url);
}

export function rememberConnectedInstance(instanceUrl) {
  const normalizedUrl = normalizeInstanceUrl(instanceUrl);
  if (!normalizedUrl) {
    clearActiveInstanceUrl();
    return [];
  }

  const now = new Date().toISOString();
  const instances = getSavedInstances();
  const existingIdx = instances.findIndex((instance) => normalizeInstanceUrl(instance?.url) === normalizedUrl);
  const fallbackName = (() => {
    try {
      return new URL(normalizedUrl).hostname;
    } catch {
      return normalizedUrl;
    }
  })();

  const nextEntry = {
    ...(existingIdx >= 0 ? instances[existingIdx] : {}),
    id: existingIdx >= 0 ? instances[existingIdx].id : createInstanceId(),
    name: (existingIdx >= 0 ? instances[existingIdx].name : "") || fallbackName,
    url: normalizedUrl,
    savedAt: existingIdx >= 0 ? (instances[existingIdx].savedAt || now) : now,
    lastUsedAt: now,
    isFavorite: existingIdx >= 0 ? Boolean(instances[existingIdx].isFavorite) : false,
    email: existingIdx >= 0 ? (instances[existingIdx].email || "") : "",
    _pw: existingIdx >= 0 ? (instances[existingIdx]._pw || "") : "",
  };

  if (existingIdx >= 0) {
    instances[existingIdx] = nextEntry;
  } else {
    instances.push(nextEntry);
  }

  setActiveInstanceUrl(normalizedUrl);
  setManualInstanceSelectionRequired(false);
  return persistInstances(instances);
}
