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
import { findVideoTrackRef } from "@/lib/videoTrackRefs";
import {
  buildLiveMediaEntries,
  createClosedStageState,
  resolveParticipantDisplayName,
} from "../channelSidebarUtils";

export function useMediaStageState({
  videoTrackRefs,
  members,
  user,
  t,
}) {
  const [stageState, setStageState] = useState(createClosedStageState);

  const videoTrackRefsById = useMemo(
    () => new Map(videoTrackRefs.map((trackRef) => [trackRef.id, trackRef])),
    [videoTrackRefs],
  );
  const memberDisplayNames = useMemo(
    () => new Map(
      members.map((member) => [
        member.user_id,
        member.user?.display_name || member.display_name || t("common.unknown"),
      ]),
    ),
    [members, t],
  );
  const selectedTrackRef = useMemo(
    () => (stageState.trackRefId ? (videoTrackRefsById.get(stageState.trackRefId) || null) : null),
    [stageState.trackRefId, videoTrackRefsById],
  );
  const selectedParticipantName = useMemo(() => {
    if (!selectedTrackRef?.participantId) {
      return "";
    }
    if (selectedTrackRef.participantId === user?.id) {
      return resolveParticipantDisplayName(user, t);
    }
    return memberDisplayNames.get(selectedTrackRef.participantId) || t("common.unknown");
  }, [memberDisplayNames, selectedTrackRef?.participantId, t, user]);
  const liveMediaEntries = useMemo(
    () => buildLiveMediaEntries({ videoTrackRefs, user, memberDisplayNames, t }),
    [memberDisplayNames, t, user, videoTrackRefs],
  );

  useEffect(() => {
    if (!stageState.open || !stageState.trackRefId) {
      return;
    }
    if (!videoTrackRefsById.has(stageState.trackRefId)) {
      setStageState(createClosedStageState());
    }
  }, [stageState, videoTrackRefsById]);

  const resolveStageTrackRefId = useCallback((participantId, source) => (
    findVideoTrackRef(videoTrackRefs, {
      participantId,
      source,
      preferLocal: participantId === user?.id,
    })?.id || null
  ), [user?.id, videoTrackRefs]);

  const openMediaStage = useCallback((participantId, source, explicitTrackRefId = null) => {
    const trackRefId = explicitTrackRefId || resolveStageTrackRefId(participantId, source);
    if (!trackRefId) {
      return;
    }
    setStageState({
      open: true,
      trackRefId,
    });
  }, [resolveStageTrackRefId]);

  const closeMediaStage = useCallback(() => {
    setStageState(createClosedStageState());
  }, []);

  return {
    liveMediaEntries,
    openMediaStage,
    stageDialogProps: {
      open: stageState.open,
      onClose: closeMediaStage,
      trackRefId: stageState.trackRefId,
      participantName: selectedParticipantName,
      source: selectedTrackRef?.source || null,
      selectedTrackRef,
    },
  };
}
