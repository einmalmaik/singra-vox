import { resolveAssetUrl } from "../assetUrls";

describe("resolveAssetUrl", () => {
  it("keeps absolute urls unchanged", () => {
    expect(resolveAssetUrl("https://cdn.example.com/avatar.png", "http://localhost:8080"))
      .toBe("https://cdn.example.com/avatar.png");
  });

  it("prefixes relative api asset urls with the runtime asset base", () => {
    expect(resolveAssetUrl("/api/files/file-123", "http://localhost:8080"))
      .toBe("http://localhost:8080/api/files/file-123");
  });

  it("leaves relative urls untouched when no asset base is available", () => {
    expect(resolveAssetUrl("/api/files/file-123", ""))
      .toBe("/api/files/file-123");
  });
});
