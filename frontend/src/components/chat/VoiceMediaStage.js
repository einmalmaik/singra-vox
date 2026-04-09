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
import { observeVideoReadiness } from "@/lib/videoReadiness";

// ─── Konstanten ────────────────────────────────────────────────────────────────

/** Maximale Anzahl von Attach-Versuchen bevor wir aufgeben */
const MAX_RETRIES = 8;

/** Millisekunden zwischen jedem Retry-Versuch */
const RETRY_INTERVAL_MS = 500;

/** Zeitfenster, in dem nach einem erfolgreichen attach der erste Frame kommen muss. */
const FRAME_READY_GRACE_MS = 1_500;

/** Maximale Wartezeit in ms bevor Loading aufgegeben wird. Danach wird
 *  ein Fehlerzustand angezeigt statt endlosem Spinner. */
const LOADING_TIMEOUT_MS = 10_000;

// ─── Komponente ────────────────────────────────────────────────────────────────

export default function VoiceMediaStage({
  open,
  onClose,
  voiceEngineRef,
  trackRefId,
  participantId,
  participantName,
  source,
  mediaRevision,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const videoRef = useRef(null);
  const stageSurfaceRef = useRef(null);

  // Verfolgt ob der Browser-Tab aktuell sichtbar ist
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);

  // Zeigt einen Lade-Indikator wenn der Track noch nicht bereit ist
  const [videoLoading, setVideoLoading] = useState(true);

  // Zeigt eine Fehlermeldung wenn der Track nicht geladen werden konnte
  const [videoError, setVideoError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);

  // ── Sichtbarkeits-Tracking ────────────────────────────────────────────────

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement;
      setFullscreenActive(Boolean(
        fullscreenElement
        && stageSurfaceRef.current
        && (
          fullscreenElement === stageSurfaceRef.current
          || stageSurfaceRef.current.contains(fullscreenElement)
        )
      ));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // ── Loading-State zurücksetzen wenn sich der Track/Teilnehmer ändert ───────

  useEffect(() => {
    if (open) {
      setVideoLoading(true);
      setVideoError(false);
      setRetryNonce(0);
    }
  }, [open, source, trackRefId]);

  // ── Callback: Video hat Daten und spielt → Loading beenden ────────────────

  const handleVideoPlaying = useCallback(() => {
    setVideoError(false);
    setVideoLoading(false);
  }, []);

  const handleVideoLoadedData = useCallback(() => {
    // loadeddata feuert bevor playing – wir warten lieber auf playing,
    // setzen aber trotzdem Loading auf false falls playing nicht kommt
    // (z.B. bei muted autoplay ohne explizites play-Event)
    setVideoError(false);
    setVideoLoading(false);
  }, []);

  const refreshTrackPlayback = useCallback(() => {
    if (documentHidden || !open || !trackRefId || !voiceEngineRef?.current || !videoRef.current) {
      return;
    }

    voiceEngineRef.current.prepareTrackRefPlayback(trackRefId, {
      width: videoRef.current.clientWidth || videoRef.current.offsetWidth || 0,
      height: videoRef.current.clientHeight || videoRef.current.offsetHeight || 0,
    });
  }, [documentHidden, open, trackRefId, voiceEngineRef]);

  const toggleFullscreen = useCallback(async () => {
    const stageSurface = stageSurfaceRef.current;
    if (!stageSurface) {
      return;
    }

    try {
      if (document.fullscreenElement === stageSurface) {
        await document.exitFullscreen?.();
        return;
      }
      await stageSurface.requestFullscreen?.();
    } catch {
      // Ignore fullscreen API failures on unsupported shells.
    }
  }, []);

  useEffect(() => {
    if (documentHidden || !open || !trackRefId || !videoRef.current) {
      return undefined;
    }

    refreshTrackPlayback();
    if (typeof ResizeObserver !== "function") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      refreshTrackPlayback();
    });
    observer.observe(videoRef.current);
    return () => observer.disconnect();
  }, [documentHidden, open, refreshTrackPlayback, trackRefId]);

  // ── Track-Attach mit Retry-Logik ─────────────────────────────────────────

  useEffect(() => {
    if (documentHidden || !open || !voiceEngineRef?.current || !trackRefId || !source || !videoRef.current) {
      return undefined;
    }

    const videoElement = videoRef.current;
    let detachFn = null;
    let stopReadinessObserver = null;
    let retryCount = 0;
    let retryTimer = null;
    let frameReadyTimer = null;
    let cancelled = false;
    let frameReady = false;

    const cleanupAttachment = () => {
      stopReadinessObserver?.();
      stopReadinessObserver = null;
      detachFn?.();
      detachFn = null;
      try {
        videoElement.srcObject = null;
      } catch {
        // Ignore partial detach cleanup failures on fast retries.
      }
    };

    const failAttachment = () => {
      cleanupAttachment();
      setVideoLoading(false);
      setVideoError(true);
    };

    const scheduleRetry = () => {
      cleanupAttachment();
      if (retryCount >= MAX_RETRIES) {
        failAttachment();
        return;
      }
      retryCount += 1;
      retryTimer = setTimeout(tryAttach, RETRY_INTERVAL_MS);
    };

    const tryAttach = () => {
      if (cancelled) {
        return;
      }

      frameReady = false;
      clearTimeout(frameReadyTimer);
      refreshTrackPlayback();
      cleanupAttachment();

      // LiveKit can hand us an attachable track before the decoder has produced
      // a renderable frame. Treating attach() as success causes the stage to
      // stall until some unrelated room event forces another bind.
      detachFn = voiceEngineRef.current?.attachTrackRefElement(trackRefId, videoElement);
      if (!detachFn) {
        scheduleRetry();
        return;
      }

      stopReadinessObserver = observeVideoReadiness(videoElement, () => {
        if (cancelled) {
          return;
        }
        frameReady = true;
        clearTimeout(frameReadyTimer);
        setVideoError(false);
        setVideoLoading(false);
      });
      void videoElement.play?.().catch(() => {});
      frameReadyTimer = setTimeout(() => {
        if (cancelled || frameReady) {
          return;
        }
        scheduleRetry();
      }, FRAME_READY_GRACE_MS);
    };

    tryAttach();

    const safetyTimer = setTimeout(() => {
      if (!cancelled && !frameReady) {
        failAttachment();
      }
    }, LOADING_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      clearTimeout(frameReadyTimer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      videoElement?.pause?.();
      cleanupAttachment();
    };
  }, [documentHidden, mediaRevision, open, refreshTrackPlayback, retryNonce, source, trackRefId, voiceEngineRef]);

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
          <div ref={stageSurfaceRef} className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 relative">
            <div className="absolute right-4 top-4 z-20">
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="rounded-xl border border-white/10 bg-black/55 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-black/75"
                data-testid="media-stage-fullscreen"
              >
                {fullscreenActive
                  ? t("mediaStage.exitFullscreen", { defaultValue: "Vollbild verlassen" })
                  : t("mediaStage.enterFullscreen", { defaultValue: "Vollbild" })}
              </button>
            </div>
            {documentHidden ? (
              <div className="flex h-[70vh] w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_35%),linear-gradient(180deg,#05070b,#09090b)] px-6 text-center text-sm text-zinc-400">
                {t("mediaStage.previewPaused")}
              </div>
            ) : (
              <>
                {/* Lade-Indikator über dem Video – verschwindet sobald Daten ankommen */}
                {videoLoading && !videoError && (
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
                {/* Fehler-Anzeige wenn Track nicht geladen werden konnte */}
                {videoError && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/80"
                    data-testid="media-stage-error"
                  >
                    <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                      <MonitorPlay size={32} className="text-zinc-500" />
                      <p className="text-sm text-zinc-400">
                        {t("mediaStage.loadFailed", { defaultValue: "Stream konnte nicht geladen werden. Die Quelle ist m\u00F6glicherweise nicht mehr verf\u00FCgbar." })}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setVideoError(false);
                          setVideoLoading(true);
                          setRetryNonce((currentValue) => currentValue + 1);
                        }}
                        className="rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15 transition-colors"
                        data-testid="media-stage-retry"
                      >
                        {t("common.retry", { defaultValue: "Erneut versuchen" })}
                      </button>
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
