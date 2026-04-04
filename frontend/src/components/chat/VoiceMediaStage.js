/**
 * VoiceMediaStage – Vollbild-Vorschau für Kamera- und Screen-Share-Tracks
 *
 * Kernaufgabe:
 *   Ein Dialog zeigt das <video>-Element eines bestimmten Teilnehmers (lokal oder remote).
 *   Der Track wird über `voiceEngine.attachParticipantMediaElement()` an das Element gehängt.
 *
 * Retry-Mechanismus:
 *   Wenn der Track zum Zeitpunkt des Öffnens noch nicht bereit ist (z.B. Screen-Share
 *   wurde gerade erst gestartet und die Publikation an LiveKit läuft noch), versucht
 *   die Komponente bis zu MAX_RETRIES mal im Abstand von RETRY_INTERVAL_MS erneut.
 *   Dadurch wird der Black-Screen-Bug zuverlässig verhindert.
 *
 * Sichtbarkeits-Optimierung:
 *   Wenn der Browser-Tab nicht sichtbar ist (`document.hidden`), wird das Video
 *   pausiert und ein Hinweistext angezeigt. Das spart CPU und verhindert
 *   Chromium-Throttling-Artefakte.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MonitorPlay, VideoCamera } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRuntime } from "@/contexts/RuntimeContext";

// ─── Konstanten ────────────────────────────────────────────────────────────────

/** Maximale Anzahl von Attach-Versuchen bevor wir aufgeben */
const MAX_RETRIES = 8;

/** Millisekunden zwischen jedem Retry-Versuch */
const RETRY_INTERVAL_MS = 500;

// ─── Komponente ────────────────────────────────────────────────────────────────

export default function VoiceMediaStage({
  open,
  onClose,
  voiceEngineRef,
  participantId,
  participantName,
  source,
  mediaRevision,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const videoRef = useRef(null);

  // Verfolgt ob der Browser-Tab aktuell sichtbar ist
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);

  // Zeigt einen Lade-Indikator wenn der Track noch nicht bereit ist
  const [videoLoading, setVideoLoading] = useState(true);

  // ── Sichtbarkeits-Tracking ────────────────────────────────────────────────

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // ── Loading-State zurücksetzen wenn sich der Track/Teilnehmer ändert ───────

  useEffect(() => {
    if (open) {
      setVideoLoading(true);
    }
  }, [open, participantId, source]);

  // ── Callback: Video hat Daten und spielt → Loading beenden ────────────────

  const handleVideoPlaying = useCallback(() => {
    setVideoLoading(false);
  }, []);

  const handleVideoLoadedData = useCallback(() => {
    // loadeddata feuert bevor playing – wir warten lieber auf playing,
    // setzen aber trotzdem Loading auf false falls playing nicht kommt
    // (z.B. bei muted autoplay ohne explizites play-Event)
    setVideoLoading(false);
  }, []);

  // ── Track-Attach mit Retry-Logik ─────────────────────────────────────────

  useEffect(() => {
    // Nicht attachen wenn Dialog zu, Tab unsichtbar oder Daten fehlen
    if (documentHidden || !open || !voiceEngineRef?.current || !participantId || !source || !videoRef.current) {
      return undefined;
    }

    const videoElement = videoRef.current;
    let detachFn = null;
    let retryCount = 0;
    let retryTimer = null;
    let cancelled = false;

    /**
     * Versucht den Track an das Video-Element zu hängen.
     * Wenn attachParticipantMediaElement() null zurückgibt (kein Track vorhanden),
     * wird nach RETRY_INTERVAL_MS erneut versucht – bis zu MAX_RETRIES mal.
     */
    const tryAttach = () => {
      if (cancelled) return;

      detachFn = voiceEngineRef.current?.attachParticipantMediaElement(
        participantId,
        source,
        videoElement,
      );

      if (!detachFn && retryCount < MAX_RETRIES) {
        retryCount += 1;
        retryTimer = setTimeout(tryAttach, RETRY_INTERVAL_MS);
      } else if (detachFn) {
        // Track erfolgreich angehängt – play() erzwingen für den Fall
        // dass autoplay vom Browser blockiert wurde
        void videoElement.play?.().catch(() => {});
      }
    };

    tryAttach();

    // Cleanup: Timer stoppen und Track sauber lösen
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      videoElement?.pause?.();
      detachFn?.();
    };
  }, [documentHidden, mediaRevision, open, participantId, source, voiceEngineRef]);

  // ── Rendering ─────────────────────────────────────────────────────────────

  const isScreenShare = source === "screen_share";
  const title = isScreenShare
    ? t("mediaStage.screenShareTitle", { name: participantName || t("common.unknown") })
    : t("mediaStage.cameraTitle", { name: participantName || t("common.unknown") });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose?.() : null)}>
      <DialogContent className="workspace-panel-solid max-w-5xl text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold" style={{ fontFamily: "Manrope" }}>
            {isScreenShare ? <MonitorPlay size={18} /> : <VideoCamera size={18} />}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 relative">
            {documentHidden ? (
              <div className="flex h-[70vh] w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_35%),linear-gradient(180deg,#05070b,#09090b)] px-6 text-center text-sm text-zinc-400">
                {t("mediaStage.previewPaused")}
              </div>
            ) : (
              <>
                {/* Lade-Indikator über dem Video – verschwindet sobald Daten ankommen */}
                {videoLoading && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/80"
                    data-testid="media-stage-loading"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                      <p className="text-sm text-zinc-400">{t("mediaStage.loading", { defaultValue: "Stream wird geladen..." })}</p>
                    </div>
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  controls={false}
                  onPlaying={handleVideoPlaying}
                  onLoadedData={handleVideoLoadedData}
                  className="h-[70vh] w-full bg-black object-contain"
                  data-testid="media-stage-video"
                />
              </>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {documentHidden
              ? t("mediaStage.previewPausedHint")
              : (config?.isDesktop
                ? t("mediaStage.desktopHint")
                : t("mediaStage.webHint"))}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
