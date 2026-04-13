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

jest.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }) => <div>{children}</div>,
  ContextMenuContent: ({ children }) => <div>{children}</div>,
  ContextMenuItem: ({ children, ...props }) => <button {...props}>{children}</button>,
  ContextMenuTrigger: ({ children }) => <div>{children}</div>,
}), { virtual: true });

import ChannelSidebarHeader from "../ChannelSidebarHeader";

describe("ChannelSidebarHeader", () => {
  const t = (key) => key;

  it("renders the server heading and settings button", () => {
    const markup = renderToStaticMarkup(
      <ChannelSidebarHeader
        serverName="Workspace"
        canManageChannels
        canOpenServerSettings
        onOpenCreateDialog={() => {}}
        onOpenServerSettings={() => {}}
        t={t}
      />,
    );

    expect(markup).toContain("server-name-header");
    expect(markup).toContain("Workspace");
    expect(markup).toContain("server-settings-button");
    expect(markup).toContain("serverSettings.createTextChannel");
  });
});
