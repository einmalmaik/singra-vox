/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { renderToStaticMarkup } from "react-dom/server";
import AuthShell from "../AuthShell";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  openExternalUrl: jest.fn(),
}), { virtual: true });

describe("AuthShell", () => {
  it("keeps auth pages vertically scrollable on small viewports", () => {
    const markup = renderToStaticMarkup(
      <AuthShell title="Setup" subtitle="Subtitle">
        <div>content</div>
      </AuthShell>,
    );

    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("overflow-x-hidden");
    expect(markup).toContain("justify-start");
    expect(markup).toContain("lg:justify-center");
  });
});
