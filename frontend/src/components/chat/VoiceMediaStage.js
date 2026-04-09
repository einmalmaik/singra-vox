/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MonitorPlay, VideoCamera } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRuntime } from "@/contexts/RuntimeContext";
import { observeVideoReadiness } from "@/lib/videoReadiness";

const MAX_RETRIES = 8;
const RETRY_INTERVAL_MS = 500;
const FRAME_READY_GRACE_MS = 1_500;
const LOADING_TIMEOUT_MS = 10_000;

/**
 * The stage renders exactly one selected LiveKit-backed track ref.
 *
 * Why the retry path still exists:
 * LiveKit can report an attachable publication before Chromium produces
 * the first renderable frame. The stage therefore retries only the
 * attach window and otherwise relies on Room events plus track refs as
 * the single source of truth.
 */
export default function VoiceMediaStage({
  open,
  onClose,
  voiceEngineRef,
  trackRefId,
  selectedTrackRef,
  participantName,
  source,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const videoRef = useRef(null);
  const stageSurfaceRef = useRef(null);

  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);

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

  useEffect(() => {
    if (open) {
      setVideoLoading(true);
      setVideoError(false);
      setRetryNonce(0);
    }
  }, [open, source, trackRefId]);

  const handleVideoPlaying = useCallback(() => {
    setVideoError(false);
    setVideoLoading(false);
  }, []);

  const handleVideoLoadedData = useCallback(() => {
    setVideoError(false);
    setVideoLoading(false);
  }, []);

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

  const trackStateKey = [
    trackRefId || "none",
    selectedTrackRef?.state || "missing",
    Number(selectedTrackRef?.revision || 0),
    selectedTrackRef?.subscriptionStatus || "none",
    selectedTrackRef?.streamState || "none",
  ].join(":");

  useEffect(() => {
    if (documentHidden || !open || !voiceEngineRef?.current || !trackRefId || !source || !videoRef.current) {
      return undefined;
    }

    const engine = voiceEngineRef.current;
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
      engine.logger?.warn?.("stage attach failed before first frame", {
        event: "stage_attach_failed",
        trackRefId,
        source,
      });
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
      cleanupAttachment();

      engine.logger?.debug?.("stage attach requested", {
        event: "stage_attach_requested",
        trackRefId,
        source,
        retryCount,
      });

      detachFn = engine.attachTrackRefElement(trackRefId, videoElement);
      if (!detachFn) {
        engine.logger?.debug?.("stage attach pending", {
          event: "stage_attach_pending",
          trackRefId,
          source,
          retryCount,
        });
        scheduleRetry();
        return;
      }

      stopReadinessObserver = observeVideoReadiness(videoElement, () => {
        if (cancelled) {
          return;
        }
        frameReady = true;
        clearTimeout(frameReadyTimer);
        engine.logger?.debug?.("stage first frame observed", {
          event: "stage_first_frame",
          trackRefId,
          source,
        });
        setVideoError(false);
        setVideoLoading(false);
      });
      void videoElement.play?.().catch(() => {});
      frameReadyTimer = setTimeout(() => {
        if (cancelled || frameReady) {
          return;
        }
        engine.logger?.debug?.("stage attach retry after missing frame", {
          event: "stage_attach_retry",
          trackRefId,
          source,
          retryCount,
        });
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
  }, [documentHidden, open, retryNonce, source, trackRefId, trackStateKey, voiceEngineRef]);

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
          <DialogDescription className="text-zinc-400">
            {isScreenShare
              ? t("mediaStage.screenShareTitle", { name: participantName || t("common.unknown") })
              : t("mediaStage.cameraTitle", { name: participantName || t("common.unknown") })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div ref={stageSurfaceRef} className="relative overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80">
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
                {videoLoading && !videoError && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/80"
                    data-testid="media-stage-loading"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                      <p className="text-sm text-zinc-400">
                        {t("mediaStage.loading", { defaultValue: "Stream wird geladen..." })}
                      </p>
                    </div>
                  </div>
                )}
                {videoError && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/80"
                    data-testid="media-stage-error"
                  >
                    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                      <MonitorPlay size={32} className="text-zinc-500" />
                      <p className="text-sm text-zinc-400">
                        {t("mediaStage.loadFailed", {
                          defaultValue: "Stream konnte nicht geladen werden. Die Quelle ist möglicherweise nicht mehr verfügbar.",
                        })}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setVideoError(false);
                          setVideoLoading(true);
                          setRetryNonce((currentValue) => currentValue + 1);
                        }}
                        className="rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
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
              : (config?.isDesktop ? t("mediaStage.desktopHint") : t("mediaStage.webHint"))}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
