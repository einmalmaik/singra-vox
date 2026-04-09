/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getNativeScreenShareSession, listDesktopCaptureSources } from "@/lib/desktop";

export const DEFAULT_CAPTURE_SOURCE_TYPE = "display";

export function resolveDesktopCaptureSelection({ sources, activeSession }) {
  const normalizedSources = Array.isArray(sources) ? sources : [];
  const preferredSourceKind = activeSession?.sourceKind || DEFAULT_CAPTURE_SOURCE_TYPE;
  const selectedSourceId = activeSession?.sourceId
    || normalizedSources.find((source) => source.kind === preferredSourceKind)?.id
    || normalizedSources[0]?.id
    || null;
  const selectedSource = normalizedSources.find((source) => source.id === selectedSourceId) || null;

  return {
    sources: normalizedSources,
    sourceType: selectedSource?.kind || preferredSourceKind,
    selectedSourceId,
  };
}

export function filterDesktopCaptureSources(sources, sourceType) {
  const normalizedSources = Array.isArray(sources) ? sources : [];
  return normalizedSources.filter((source) => source.kind === sourceType);
}

export function useDesktopCaptureSources({ enabled = false, onError = null } = {}) {
  const [status, setStatus] = useState("idle");
  const [sources, setSources] = useState([]);
  const [sourceType, setSourceType] = useState(DEFAULT_CAPTURE_SOURCE_TYPE);
  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const lastErrorRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setSources([]);
      setSourceType(DEFAULT_CAPTURE_SOURCE_TYPE);
      setSelectedSourceId(null);
      lastErrorRef.current = null;
      return undefined;
    }

    let cancelled = false;

    const loadCaptureSources = async () => {
      setStatus("loading");
      try {
        const [nextSources, activeSession] = await Promise.all([
          listDesktopCaptureSources(),
          getNativeScreenShareSession().catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        const nextSelection = resolveDesktopCaptureSelection({
          sources: nextSources,
          activeSession,
        });

        setSources(nextSelection.sources);
        setStatus("ready");
        setSelectedSourceId(nextSelection.selectedSourceId);
        setSourceType(nextSelection.sourceType);
        lastErrorRef.current = null;
      } catch (error) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setSources([]);
        setSelectedSourceId(null);
        setSourceType(DEFAULT_CAPTURE_SOURCE_TYPE);
        if (lastErrorRef.current !== error && typeof onError === "function") {
          lastErrorRef.current = error;
          onError(error);
        }
      }
    };

    void loadCaptureSources();

    return () => {
      cancelled = true;
    };
  }, [enabled, onError]);

  const filteredSources = useMemo(
    () => filterDesktopCaptureSources(sources, sourceType),
    [sourceType, sources],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (filteredSources.length === 0) {
      if (selectedSourceId && !sources.some((source) => source.id === selectedSourceId)) {
        setSelectedSourceId(null);
      }
      return;
    }

    if (!filteredSources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(filteredSources[0].id);
    }
  }, [enabled, filteredSources, selectedSourceId, sources]);

  return {
    captureSourcesStatus: status,
    captureSources: sources,
    captureSourceType: sourceType,
    selectedCaptureSourceId: selectedSourceId,
    filteredCaptureSources: filteredSources,
    setCaptureSourceType: setSourceType,
    setSelectedCaptureSourceId,
  };
}
