/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import api from "./api";
import { isDesktopApp } from "./desktop";

let cachedPublicKey = null;

export function clearVapidKeyCache() {
  cachedPublicKey = null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function requestNotificationPermission() {
  if (isDesktopApp()) {
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    let permission = await isPermissionGranted();
    if (!permission) {
      permission = await requestPermission() === "granted";
    }
    return permission;
  }

  if (!("Notification" in window)) {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Check the current notification permission state WITHOUT triggering a prompt.
 * Returns "granted" | "denied" | "default".
 */
export async function getNotificationPermissionState() {
  if (isDesktopApp()) {
    try {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      const granted = await isPermissionGranted();
      return granted ? "granted" : "default";
    } catch {
      return "default";
    }
  }

  if ("Notification" in window) {
    return Notification.permission;
  }
  return "denied";
}

async function getVapidPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  try {
    const res = await api.get("/notifications/vapid-public-key");
    cachedPublicKey = res.data.publicKey;
    return cachedPublicKey;
  } catch {
    return null;
  }
}

export async function subscribeToPush() {
  if (isDesktopApp()) {
    // Desktop notifications are handled via WebSocket + Tauri Plugin
    return;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return;
  }

  const publicKey = await getVapidPublicKey();
  if (!publicKey) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    // If an existing subscription uses a different key (e.g. after key rotation), re-subscribe
    if (subscription) {
      const existingKey = subscription.options?.applicationServerKey;
      const newKeyBytes = urlBase64ToUint8Array(publicKey);
      const existingBase64 = existingKey
        ? btoa(String.fromCharCode(...new Uint8Array(existingKey)))
        : null;
      const newBase64 = btoa(String.fromCharCode(...newKeyBytes));
      if (existingBase64 !== newBase64) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api.post("/users/me/notifications/subscriptions", {
      subscription: subscription.toJSON(),
      platform: "web",
    });
  } catch (error) {
    console.error("Failed to subscribe to push notifications", error);
  }
}

export async function updateNotificationPreferences(prefs) {
  return api.put("/users/me/notifications/preferences", prefs);
}

export async function getNotificationPreferences() {
  const res = await api.get("/users/me/notifications/preferences");
  return res.data;
}
