import api from "./api";
import { isDesktopApp } from "./desktop";

let cachedPublicKey = null;

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
