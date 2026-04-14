/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  formatInviteExpiry,
  formatInviteUsage,
  loadPendingInvite,
  normalizeInstanceUrl,
  parseDesktopInviteLink,
} from "../inviteLinks";

const PENDING_INVITE_STORAGE_KEY = "singravox.pending_invite";

function translate(key, params = {}) {
  if (key === "inviteGenerator.unlimitedUses") return "Unlimited uses";
  if (key === "inviteGenerator.maxUsesCount") return `${params.count} max uses`;
  if (key === "inviteGenerator.usesLeft") return `${params.count} uses left`;
  if (key === "inviteGenerator.doesNotExpire") return "Does not expire";
  if (key === "inviteGenerator.expiresSoon") return "Expires soon";
  if (key === "inviteGenerator.expiresAt") return `Expires ${params.value}`;
  return key;
}

describe("inviteLinks", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("normalizes valid instance URLs and strips credentials and query state", () => {
    expect(normalizeInstanceUrl("https://chat.example.com/base/?foo=bar#frag")).toBe("https://chat.example.com/base");
    expect(normalizeInstanceUrl("ftp://chat.example.com")).toBe("");
    expect(normalizeInstanceUrl("https://user:pass@example.com")).toBe("");
  });

  test("parses desktop invite links only with safe http or https instances", () => {
    expect(parseDesktopInviteLink("singravox://invite/abc123?instance=https%3A%2F%2Fchat.example.com")).toEqual({
      code: "abc123",
      instanceUrl: "https://chat.example.com",
    });
    expect(parseDesktopInviteLink("singravox://invite/abc123?instance=file%3A%2F%2F%2Fc%3A%2Ftemp")).toEqual({
      code: "abc123",
      instanceUrl: "",
    });
  });

  test("formats invite usage and expiry through i18n", () => {
    expect(formatInviteUsage(translate, 0, 0)).toBe("Unlimited uses");
    expect(formatInviteUsage(translate, 5, 2)).toBe("5 max uses \u00b7 3 uses left");
    expect(formatInviteExpiry(translate, null)).toBe("Does not expire");
    expect(formatInviteExpiry(translate, "not-a-date")).toBe("Expires soon");
  });

  test("discards stale pending invites so old desktop launches do not auto-accept later", () => {
    window.localStorage.setItem(PENDING_INVITE_STORAGE_KEY, JSON.stringify({
      code: "stale-code",
      savedAt: Date.now() - (13 * 60 * 60 * 1000),
    }));

    expect(loadPendingInvite()).toBeNull();
    expect(window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBeNull();
  });

  test("keeps recent pending invites available for active auth flows", () => {
    window.localStorage.setItem(PENDING_INVITE_STORAGE_KEY, JSON.stringify({
      code: "https://chat.example.com/invite/fresh-code",
      savedAt: Date.now() - (5 * 60 * 1000),
    }));

    expect(loadPendingInvite()).toEqual({ code: "fresh-code" });
  });
});

