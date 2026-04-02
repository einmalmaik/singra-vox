import {
  formatInviteExpiry,
  formatInviteUsage,
  normalizeInstanceUrl,
  parseDesktopInviteLink,
} from "../inviteLinks";

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
    expect(formatInviteUsage(translate, 5, 2)).toBe("5 max uses · 3 uses left");
    expect(formatInviteExpiry(translate, null)).toBe("Does not expire");
    expect(formatInviteExpiry(translate, "not-a-date")).toBe("Expires soon");
  });
});
