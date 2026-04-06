/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
export function resolveAssetUrl(assetUrl, assetBase = "") {
  const normalizedUrl = String(assetUrl || "").trim();
  if (!normalizedUrl) {
    return "";
  }

  if (
    normalizedUrl.startsWith("http://")
    || normalizedUrl.startsWith("https://")
    || normalizedUrl.startsWith("data:")
    || normalizedUrl.startsWith("blob:")
  ) {
    return normalizedUrl;
  }

  if (!assetBase) {
    return normalizedUrl;
  }

  const normalizedBase = String(assetBase).replace(/\/+$/, "");
  const normalizedPath = normalizedUrl.startsWith("/") ? normalizedUrl : `/${normalizedUrl}`;
  return `${normalizedBase}${normalizedPath}`;
}
