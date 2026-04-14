import {
  clearDesktopInstanceUrl,
  loadRuntimeConfig,
  saveDesktopInstanceUrl,
} from "../runtimeConfig";
import {
  getActiveInstanceUrl,
  getSavedInstances,
} from "../instanceManager";

let mockDesktopRuntime = true;

jest.mock("@/lib/desktop", () => ({
  isDesktopApp: () => mockDesktopRuntime,
}), { virtual: true });

describe("runtimeConfig", () => {
  beforeEach(() => {
    mockDesktopRuntime = true;
    window.localStorage.clear();
  });

  it("restores the most recently used saved desktop instance when the active url is missing", async () => {
    window.localStorage.setItem("singravox.saved_instances", JSON.stringify([
      {
        id: "first",
        name: "First",
        url: "https://old.example.com",
        savedAt: "2026-04-12T10:00:00.000Z",
        lastUsedAt: "2026-04-12T10:05:00.000Z",
      },
      {
        id: "second",
        name: "Second",
        url: "https://new.example.com",
        savedAt: "2026-04-13T10:00:00.000Z",
        lastUsedAt: "2026-04-13T10:05:00.000Z",
      },
    ]));

    const config = await loadRuntimeConfig();

    expect(config.instanceUrl).toBe("https://new.example.com");
    expect(config.needsConnection).toBe(false);
    expect(getActiveInstanceUrl()).toBe("https://new.example.com");
  });

  it("respects an explicit disconnect and keeps the connect screen on the next load", async () => {
    window.localStorage.setItem("singravox.saved_instances", JSON.stringify([
      {
        id: "saved",
        name: "Saved",
        url: "https://saved.example.com",
        savedAt: "2026-04-13T10:00:00.000Z",
        lastUsedAt: "2026-04-13T10:05:00.000Z",
      },
    ]));

    await clearDesktopInstanceUrl();
    const config = await loadRuntimeConfig();

    expect(config.needsConnection).toBe(true);
    expect(config.instanceUrl).toBe("");
  });

  it("stores the connected desktop instance as the active reconnect target", async () => {
    const config = await saveDesktopInstanceUrl("https://chat.example.com/");

    expect(config.instanceUrl).toBe("https://chat.example.com");
    expect(getActiveInstanceUrl()).toBe("https://chat.example.com");
    expect(getSavedInstances()).toEqual([
      expect.objectContaining({
        url: "https://chat.example.com",
        name: "chat.example.com",
      }),
    ]);
  });
});
