/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { createScreenShareProxyMap } from "../voice/ScreenShareProxyMap";

describe("ScreenShareProxyMap", () => {
  it("resolves ownership from the stable proxy identity before attributes arrive", () => {
    const proxyMap = createScreenShareProxyMap();

    const entry = proxyMap.upsertParticipant({
      identity: "screen-share:channel-1:user-1",
      attributes: {},
    });

    expect(entry?.userId).toBe("user-1");
    expect(proxyMap.resolveUserId("screen-share:channel-1:user-1")).toBe("user-1");
  });

  it("reconciles later owner attributes without losing the previous mapping", () => {
    const proxyMap = createScreenShareProxyMap();

    proxyMap.upsertParticipant({
      identity: "screen-share:channel-1:proxy-user",
    });

    const entry = proxyMap.upsertParticipant({
      identity: "screen-share:channel-1:proxy-user",
      attributes: {
        owner_user_id: "user-2",
      },
    });

    expect(entry?.previousUserId).toBe("proxy-user");
    expect(proxyMap.resolveUserId("screen-share:channel-1:proxy-user")).toBe("user-2");
  });

  it("removes proxy mappings by identity", () => {
    const proxyMap = createScreenShareProxyMap();

    proxyMap.upsertParticipant({
      identity: "screen-share:channel-1:user-3",
      attributes: {
        owner_user_id: "user-3",
      },
    });

    expect(proxyMap.removeParticipant("screen-share:channel-1:user-3")).toBe(true);
    expect(proxyMap.resolveUserId("screen-share:channel-1:user-3")).toBeNull();
  });
});
