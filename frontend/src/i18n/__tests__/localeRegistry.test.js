import fs from "fs";
import path from "path";
import { LOCALE_SECTIONS } from "../locales/_shared/sections.js";
import { localeRegistry, localeSectionRegistry } from "../locales/index.js";

const SRC_DIR = path.resolve(__dirname, "..", "..");
const LOCALES_DIR = path.resolve(__dirname, "..", "locales");
const ALLOWED_DEFAULTVALUE_FILES = new Set([
  path.resolve(SRC_DIR, "lib", "appErrors.js"),
]);

function collectLeafPaths(value, prefix = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix.join(".")];
  }

  return Object.entries(value).flatMap(([key, nested]) => collectLeafPaths(nested, [...prefix, key]));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(fullPath);
    }
    return fullPath;
  });
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

describe("locale registry", () => {
  it("keeps every locale on the same key shape as english", () => {
    const englishPaths = collectLeafPaths(localeRegistry.en).sort();

    for (const [code, locale] of Object.entries(localeRegistry)) {
      expect(collectLeafPaths(locale).sort()).toEqual(englishPaths);
      expect(locale).toBeDefined();
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it("keeps raw locale overrides explicit and free of empty placeholder sections", () => {
    const emptyPlaceholderFiles = walkFiles(LOCALES_DIR).filter((file) => {
      if (!file.endsWith(".js") || file.endsWith("index.js")) {
        return false;
      }

      const raw = normalizeNewlines(fs.readFileSync(file, "utf8").trim());
      return raw === "const section = {};\n\nexport default section;";
    });

    expect(emptyPlaceholderFiles).toEqual([]);

    for (const [code, sections] of Object.entries(localeSectionRegistry)) {
      expect(code).toMatch(/^[a-z]{2}$/);
      expect(Object.keys(sections).length).toBeGreaterThan(0);

      for (const [sectionName, value] of Object.entries(sections)) {
        expect(LOCALE_SECTIONS).toContain(sectionName);
        expect(collectLeafPaths(value).filter(Boolean).length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the critical german strings readable", () => {
    expect(localeRegistry.de.updater.checking).toBe("Pr\u00fcfe auf Updates\u2026");
    expect(localeRegistry.de.common.noActionsAvailable).toBe("Keine Aktionen verf\u00fcgbar");
    expect(localeRegistry.de.inviteGenerator.desktopHandoff).toBe("Desktop-\u00dcbergabe");
    expect(localeRegistry.de.svid.setupFinalizeTitle).toBe("Singra-ID best\u00e4tigt");
  });

  it("stores locale files without BOM or known mojibake markers", () => {
    const localeFiles = walkFiles(LOCALES_DIR).filter((file) => file.endsWith(".js"));
    const mojibakePattern = /\u00c3|\u00c2|ï»¿|\ufffd|\u0192|\u00b6/;

    for (const file of localeFiles) {
      const raw = fs.readFileSync(file, "utf8");
      expect(raw.charCodeAt(0)).not.toBe(0xfeff);
      expect(raw).not.toMatch(mojibakePattern);
    }
  });

  it("keeps component-owned defaultValue fallbacks out of frontend source", () => {
    const sourceFiles = walkFiles(SRC_DIR).filter((file) => /\.(js|jsx)$/.test(file) && !file.includes("__tests__"));
    const offenders = sourceFiles.filter((file) => {
      if (ALLOWED_DEFAULTVALUE_FILES.has(file)) {
        return false;
      }
      return /defaultValue\s*:/.test(fs.readFileSync(file, "utf8"));
    });

    expect(offenders).toEqual([]);
  });
});
