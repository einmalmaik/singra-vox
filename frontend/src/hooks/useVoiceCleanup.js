/**
 * useVoiceCleanup – Stellt sicher, dass Voice-Sessions beim Schließen/
 * Neuladen der Seite sauber verlassen werden (Backend-State + LiveKit).
 *
 * Nutzt `navigator.sendBeacon` in `beforeunload`/`pagehide`, da fetch()
 * in diesen Events unzuverlässig ist. Beacon-Requests senden Cookies
 * automatisch, also funktioniert die Auth ohne manuelle Header.
 */
import { useEffect, useRef } from "react";

export function useVoiceCleanup({ serverId, voiceChannelId, voiceEngineRef }) {
  // Refs für den aktuellsten State – so muss der Effect nicht bei
  // jeder voiceChannel-Änderung neu registriert werden.
  const serverIdRef = useRef(serverId);
  const channelIdRef = useRef(voiceChannelId);

  useEffect(() => { serverIdRef.current = serverId; }, [serverId]);
  useEffect(() => { channelIdRef.current = voiceChannelId; }, [voiceChannelId]);

  useEffect(() => {
    const cleanup = () => {
      const sid = serverIdRef.current;
      const cid = channelIdRef.current;
      if (!sid || !cid) return;

      // Local media must stop immediately on unload so native capture does not
      // continue recording after the user closed the app or tab.
      try { voiceEngineRef?.current?.forceCleanupForUnload?.("pagehide"); } catch { /* ignore */ }
      try { void voiceEngineRef?.current?.disconnect?.(); } catch { /* ignore */ }

      // Backend-State per sendBeacon aufräumen. Cookies (access_token)
      // werden automatisch mitgesendet → Auth funktioniert.
      const apiBase = process.env.REACT_APP_BACKEND_URL || "";
      const url = `${apiBase}/api/servers/${sid}/voice/${cid}/leave`;
      const blob = new Blob(
        [JSON.stringify({})],
        { type: "application/json" },
      );
      try { navigator.sendBeacon(url, blob); } catch { /* best effort */ }
    };

    // pagehide ist zuverlässiger als beforeunload auf mobilen Browsern.
    // Beide registrieren als Sicherheitsnetz.
    window.addEventListener("beforeunload", cleanup);
    window.addEventListener("pagehide", cleanup);

    return () => {
      window.removeEventListener("beforeunload", cleanup);
      window.removeEventListener("pagehide", cleanup);
    };
  }, [voiceEngineRef]);
}
