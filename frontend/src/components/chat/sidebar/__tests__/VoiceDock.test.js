/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { renderToStaticMarkup } from "react-dom/server";
import VoiceDock from "../VoiceDock";

describe("VoiceDock", () => {
  const t = (key) => key;

  it("renders live media entries and voice action test ids", () => {
    const markup = renderToStaticMarkup(
      <VoiceDock
        voiceChannel={{ id: "voice-1", name: "Talk" }}
        voiceActivity={{ localSpeaking: false }}
        liveMediaEntries={[
          {
            trackRefId: "track-1",
            userId: "user-1",
            participantName: "Alice",
            source: "screen_share",
            badge: "LIVE",
            hasAudio: true,
          },
        ]}
        cameraEnabled={false}
        screenShareEnabled
        onToggleCamera={() => {}}
        onToggleScreenShare={() => {}}
        onLeaveVoice={() => {}}
        onOpenMediaStage={() => {}}
        t={t}
      />,
    );

    expect(markup).toContain("voice-controls");
    expect(markup).toContain("Alice");
    expect(markup).toContain("voice-camera-toggle");
    expect(markup).toContain("voice-screen-share-toggle");
    expect(markup).toContain("voice-disconnect");
  });
});
