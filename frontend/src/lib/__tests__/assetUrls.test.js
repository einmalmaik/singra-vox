/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
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
