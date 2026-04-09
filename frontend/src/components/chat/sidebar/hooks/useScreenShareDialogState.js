/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatAppError } from "@/lib/appErrors";
import { useDesktopCaptureSources } from "@/hooks/useDesktopCaptureSources";
import {
  DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID,
  DEFAULT_SCREEN_SHARE_PRESET_ID,
  getScreenSharePresetOptions,
  resolveScreenSharePreset,
} from "@/lib/screenSharePresets";

export function useScreenShareDialogState({
  isDesktop,
  useNativeScreenShare,
  screenShareCapabilities,
  voiceChannel,
  voiceEngineRef,
  screenShareEnabled,
  screenShareMeta,
  t,
}) {
  const [open, setOpen] = useState(false);
  const [screenShareQuality, setScreenShareQuality] = useState(DEFAULT_SCREEN_SHARE_PRESET_ID);
  const [screenShareAudio, setScreenShareAudio] = useState(false);
  const [screenShareAudioVolume, setScreenShareAudioVolume] = useState(100);
  const [screenShareSurface, setScreenShareSurface] = useState("monitor");
  const [captureSourceType, setCaptureSourceType] = useState("display");
  const screenSharePresetOptions = useMemo(
    () => getScreenSharePresetOptions({ isDesktop: useNativeScreenShare }),
    [useNativeScreenShare],
  );

  const handleCaptureSourcesLoadError = useCallback((error) => {
    toast.error(formatAppError(t, error, { fallbackKey: "errors.nativeCaptureSourcesLoadFailed" }));
  }, [t]);

  const {
    captureSourcesStatus,
    captureSources,
    selectedCaptureSourceId,
    filteredCaptureSources,
    setSelectedCaptureSourceId,
  } = useDesktopCaptureSources({
    enabled: Boolean(open && useNativeScreenShare),
    sourceType: captureSourceType,
    onError: handleCaptureSourcesLoadError,
  });

  useEffect(() => {
    const validPresetIds = new Set(screenSharePresetOptions.map((preset) => preset.id));
    if (validPresetIds.has(screenShareQuality)) {
      return;
    }
    setScreenShareQuality(
      useNativeScreenShare ? DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID : DEFAULT_SCREEN_SHARE_PRESET_ID,
    );
  }, [screenSharePresetOptions, screenShareQuality, useNativeScreenShare]);

  useEffect(() => {
    if (!screenShareCapabilities.supportsSystemAudio && screenShareAudio) {
      setScreenShareAudio(false);
    }
  }, [screenShareAudio, screenShareCapabilities.supportsSystemAudio]);

  const updateScreenShareAudioVolume = useCallback((value) => {
    setScreenShareAudioVolume(value);
    voiceEngineRef?.current?.setScreenShareAudioVolume?.(value);
  }, [voiceEngineRef]);

  const toggleScreenShareFromDock = useCallback(async () => {
    if (!voiceChannel || !voiceEngineRef?.current) {
      return;
    }
    if (!screenShareEnabled || isDesktop) {
      setOpen(true);
      return;
    }
    try {
      const enabled = await voiceEngineRef.current.toggleScreenShare();
      if (!enabled) {
        setOpen(false);
      }
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareToggleFailed" }));
    }
  }, [isDesktop, screenShareEnabled, t, voiceChannel, voiceEngineRef]);

  const startScreenShare = useCallback(async () => {
    if (!voiceChannel || !voiceEngineRef?.current) {
      return;
    }
    try {
      if (useNativeScreenShare && !selectedCaptureSourceId) {
        toast.error(t("channel.captureSourceMissing"));
        return;
      }

      const selectedSource = captureSources.find((source) => source.id === selectedCaptureSourceId) || null;
      const selectedPreset = resolveScreenSharePreset(screenShareQuality, {
        isDesktop: useNativeScreenShare,
        source: selectedSource,
      });

      voiceEngineRef.current.setScreenShareAudioVolume(screenShareAudioVolume);

      const enabled = await voiceEngineRef.current.startScreenShare(
        useNativeScreenShare
          ? {
            audio: screenShareAudio,
            nativeCapture: true,
            sourceId: selectedCaptureSourceId,
            sourceKind: selectedSource?.kind || captureSourceType,
            sourceLabel: selectedSource?.label || null,
            resolution: selectedPreset.resolution,
            qualityPreset: selectedPreset.id,
          }
          : {
            audio: screenShareAudio,
            displaySurface: screenShareSurface,
            resolution: selectedPreset.resolution,
            qualityPreset: selectedPreset.id,
          },
      );
      if (enabled) {
        setOpen(false);
      }
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareStartFailed" }));
    }
  }, [
    captureSourceType,
    captureSources,
    screenShareAudio,
    screenShareAudioVolume,
    screenShareQuality,
    screenShareSurface,
    selectedCaptureSourceId,
    t,
    useNativeScreenShare,
    voiceChannel,
    voiceEngineRef,
  ]);

  const stopScreenShareFromDialog = useCallback(async () => {
    if (!voiceEngineRef?.current) {
      return;
    }
    try {
      await voiceEngineRef.current.stopScreenShare();
      setOpen(false);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareStopFailed" }));
    }
  }, [t, voiceEngineRef]);

  return {
    open,
    setOpen,
    toggleScreenShareFromDock,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      isDesktop,
      useNativeScreenShare,
      screenShareCapabilities,
      captureSourcesStatus,
      captureSourceType,
      filteredCaptureSources,
      selectedCaptureSourceId,
      screenSharePresetOptions,
      screenShareQuality,
      screenShareAudio,
      screenShareAudioVolume,
      screenShareSurface,
      screenShareEnabled,
      screenShareMeta,
      onCaptureSourceTypeChange: setCaptureSourceType,
      onSelectedCaptureSourceChange: setSelectedCaptureSourceId,
      onScreenShareQualityChange: setScreenShareQuality,
      onScreenShareAudioChange: setScreenShareAudio,
      onScreenShareSurfaceChange: setScreenShareSurface,
      onUpdateScreenShareAudioVolume: updateScreenShareAudioVolume,
      onStartScreenShare: startScreenShare,
      onStopScreenShare: stopScreenShareFromDialog,
      t,
    },
  };
}
