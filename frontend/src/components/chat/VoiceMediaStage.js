/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const RETRY_INTERVAL_MS = 500;
const PLAYBACK_RECOVERY_RETRY_MS = 250;
const FRAME_READY_GRACE_MS = 2_000;
const VIEW_STATE_LOADING = "loading";
const VIEW_STATE_READY = "ready";
const VIEW_STATE_UNAVAILABLE = "unavailable";

function getPlaybackRecoveryPolicy(isDesktopRuntime) {
  if (isDesktopRuntime) {
    return {
      maxAttachRetries: 8,
      maxPlaybackRecoveryAttempts: 1,
      pendingPlaybackRecoveryAfterAttempts: 4,
      pendingPlaybackRecoveryRepeatEveryAttempts: null,
    };
  }

  return {
    maxAttachRetries: 12,
    maxPlaybackRecoveryAttempts: 3,
    pendingPlaybackRecoveryAfterAttempts: 4,
    pendingPlaybackRecoveryRepeatEveryAttempts: 2,
  };
}

/**
 * The stage renders exactly one selected LiveKit-backed track ref.
 *
 * The only stage-specific media logic left here is:
 * - attach/detach the currently selected track
 * - wait for the first renderable frame
 * - retry a bounded number of times when Chromium has not produced that frame yet
 *
 * Publication, subscription and track ownership stay in LiveKit/VoiceEngine.
 */
export default function VoiceMediaStage({
  open,
  onClose,
  voiceEngineRef,
  trackRefId,
  selectedTrackAvailable,
  participantName,
  source,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const playbackRecoveryPolicy = useMemo(
    () => getPlaybackRecoveryPolicy(Boolean(config?.isDesktop)),
    [config?.isDesktop],
  );
  const videoRef = useRef(null);
  const stageSurfaceRef = useRef(null);
  const [videoElement, setVideoElement] = useState(null);

  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);
  const [viewState, setViewState] = useState(VIEW_STATE_LOADING);
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
      setViewState(VIEW_STATE_LOADING);
    }
  }, [open, source, trackRefId]);

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

  const handleVideoRef = useCallback((node) => {
    videoRef.current = node;
    setVideoElement(node);
  }, []);

  const trackAvailabilityKey = [
    trackRefId || "none",
    Number(Boolean(selectedTrackAvailable)),
  ].join(":");

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (!trackRefId || !source) {
      setViewState(VIEW_STATE_UNAVAILABLE);
      return undefined;
    }

    if (documentHidden || !voiceEngineRef?.current || !videoElement) {
      return undefined;
    }

    const engine = voiceEngineRef.current;
    let detachFn = null;
    let stopReadinessObserver = null;
    let retryTimer = null;
    let frameReadyTimer = null;
    let cancelled = false;
    let frameReady = false;
    let attachAttempts = 0;
    let playbackRecoveryAttempts = 0;

    const requestPlaybackRecovery = (event) => {
      if (playbackRecoveryAttempts >= playbackRecoveryPolicy.maxPlaybackRecoveryAttempts) {
        return false;
      }

      const didRecoverPlayback = engine.recoverTrackRefPlayback?.(trackRefId);
      if (!didRecoverPlayback) {
        return false;
      }

      playbackRecoveryAttempts += 1;
      engine.logger?.debug?.("stage requested playback recovery", {
        event,
        trackRefId,
        source,
        attachAttempts,
        playbackRecoveryAttempts,
      });
      return true;
    };

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

    const setUnavailable = () => {
      cleanupAttachment();
      setViewState(VIEW_STATE_UNAVAILABLE);
      engine.logger?.warn?.("stage unavailable after bounded attach retries", {
        event: "stage_unavailable",
        trackRefId,
        source,
        attachAttempts,
      });
    };

    const scheduleRetry = (delayMs = RETRY_INTERVAL_MS) => {
      cleanupAttachment();
      if (attachAttempts >= playbackRecoveryPolicy.maxAttachRetries) {
        setUnavailable();
        return;
      }
      attachAttempts += 1;
      retryTimer = setTimeout(tryAttach, delayMs);
    };

    const tryAttach = () => {
      if (cancelled) {
        return;
      }

      setViewState(VIEW_STATE_LOADING);
      frameReady = false;
      clearTimeout(frameReadyTimer);
      cleanupAttachment();

      engine.logger?.debug?.("stage attach requested", {
        event: "stage_attach_requested",
        trackRefId,
        source,
        attachAttempts,
      });

      engine.ensureTrackRefPlayback?.(trackRefId);

      detachFn = engine.attachTrackRefElement(trackRefId, videoElement);
      if (!detachFn) {
        const shouldAttemptPendingRecovery = attachAttempts >= playbackRecoveryPolicy.pendingPlaybackRecoveryAfterAttempts
          && (
            attachAttempts === playbackRecoveryPolicy.pendingPlaybackRecoveryAfterAttempts
            || (
              playbackRecoveryPolicy.pendingPlaybackRecoveryRepeatEveryAttempts
              && (
                (attachAttempts - playbackRecoveryPolicy.pendingPlaybackRecoveryAfterAttempts)
                % playbackRecoveryPolicy.pendingPlaybackRecoveryRepeatEveryAttempts
              ) === 0
            )
          );
        const didRecoverPlayback = shouldAttemptPendingRecovery
          && requestPlaybackRecovery("stage_playback_recovery_pending");
        engine.logger?.debug?.("stage attach pending", {
          event: "stage_attach_pending",
          trackRefId,
          source,
          attachAttempts,
          playbackRecoveryAttempts,
          didRecoverPlayback: Boolean(didRecoverPlayback),
        });
        scheduleRetry(didRecoverPlayback ? PLAYBACK_RECOVERY_RETRY_MS : RETRY_INTERVAL_MS);
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
        setViewState(VIEW_STATE_READY);
      });

      const playResult = videoElement.play?.();
      if (typeof playResult?.catch === "function") {
        playResult.catch(() => {});
      }
      frameReadyTimer = setTimeout(() => {
        if (cancelled || frameReady) {
          return;
        }

        const didRecoverPlayback = requestPlaybackRecovery("stage_playback_recovery_frame");

        engine.logger?.debug?.("stage attach retry after missing frame", {
          event: "stage_attach_retry",
          trackRefId,
          source,
          attachAttempts,
          playbackRecoveryAttempts,
          didRecoverPlayback: Boolean(didRecoverPlayback),
        });
        scheduleRetry(didRecoverPlayback ? PLAYBACK_RECOVERY_RETRY_MS : RETRY_INTERVAL_MS);
      }, FRAME_READY_GRACE_MS);
    };

    tryAttach();

    return () => {
      cancelled = true;
      clearTimeout(frameReadyTimer);
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      videoElement?.pause?.();
      cleanupAttachment();
    };
  }, [documentHidden, open, playbackRecoveryPolicy, source, trackAvailabilityKey, trackRefId, videoElement, voiceEngineRef]);

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
                {viewState === VIEW_STATE_LOADING && (
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
                {viewState === VIEW_STATE_UNAVAILABLE && (
                  <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/80"
                    data-testid="media-stage-unavailable"
                  >
                    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                      <MonitorPlay size={32} className="text-zinc-500" />
                      <p className="text-sm text-zinc-400">
                        {t("mediaStage.unavailable", {
                          defaultValue: "Stream ist derzeit nicht verfügbar.",
                        })}
                      </p>
                    </div>
                  </div>
                )}
                <video
                  ref={handleVideoRef}
                  autoPlay
                  playsInline
                  controls={false}
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
