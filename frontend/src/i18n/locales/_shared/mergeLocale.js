function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export default function mergeLocale(baseLocale, overrideLocale) {
  const result = { ...baseLocale };
  for (const [key, value] of Object.entries(overrideLocale || {})) {
    if (isPlainObject(value) && isPlainObject(baseLocale?.[key])) {
      result[key] = mergeLocale(baseLocale[key], value);
      continue;
    }
    result[key] = value;
  }
  return result;
}
