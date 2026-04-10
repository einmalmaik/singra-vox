/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  getNotificationPreferences,
  getNotificationPermissionState,
  requestNotificationPermission,
  subscribeToPush,
} from "@/lib/pushNotifications";

/**
 * Bootstraps notification preferences and push registration independently from
 * the workspace rendering tree so the page layout stays free of side effects.
 */
export function useNotificationBootstrap({ isDesktop, token }) {
  const notificationPreferencesRef = useRef({
    web_push_enabled: true,
    desktop_push_enabled: true,
  });

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        // Let the workspace mount first so notification setup never blocks the
        // initial shell render or route transition.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (cancelled) {
          return;
        }

        const nextPreferences = await getNotificationPreferences();
        if (cancelled) {
          return;
        }
        notificationPreferencesRef.current = nextPreferences;

        const notificationsEnabled = isDesktop
          ? nextPreferences.desktop_push_enabled !== false
          : nextPreferences.web_push_enabled !== false;
        if (!notificationsEnabled) {
          return;
        }

        const currentPermission = await getNotificationPermissionState();
        if (currentPermission === "denied") {
          return;
        }

        if (currentPermission === "granted") {
          if (!isDesktop) {
            await subscribeToPush();
          }
          return;
        }

        if (isDesktop) {
          return;
        }

        const granted = await requestNotificationPermission();
        if (!granted || cancelled) {
          return;
        }

        toast.success("Benachrichtigungen aktiviert!", { duration: 3000, id: "push-granted" });
        await subscribeToPush();
      } catch {
        // Notification setup should never block the workspace bootstrap.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDesktop, token]);

  return notificationPreferencesRef;
}
