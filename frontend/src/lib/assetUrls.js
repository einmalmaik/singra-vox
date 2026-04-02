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
