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

jest.mock("@/components/chat/ChannelSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="channel-sidebar-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/ChatArea", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-area-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/MemberSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="member-sidebar-mock" />,
}), { virtual: true });

import ServerWorkspaceView from "../ServerWorkspaceView";

describe("ServerWorkspaceView", () => {
  it("renders mobile controls and keeps the workspace split stable", () => {
    const markup = renderToStaticMarkup(
      <ServerWorkspaceView
        showChannels
        showMembers={false}
        setShowChannels={() => {}}
        setShowMembers={() => {}}
        channelSidebarProps={{}}
        chatAreaProps={{}}
        memberSidebarProps={{}}
        currentChannel={{ id: "channel-1", name: "general" }}
        currentServer={{ id: "server-1", name: "Workspace" }}
      />,
    );

    expect(markup).toContain("toggle-channels-mobile");
    expect(markup).toContain("toggle-members-mobile");
    expect(markup).toContain("mobile-toolbar");
    expect(markup).toContain("channel-sidebar-mock");
    expect(markup).toContain("chat-area-mock");
    expect(markup).toContain("member-sidebar-mock");
  });
});
