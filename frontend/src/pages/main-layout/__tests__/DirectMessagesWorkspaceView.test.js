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

jest.mock("@/components/security/E2EEStatus", () => ({
  __esModule: true,
  default: () => <div data-testid="e2ee-status-mock" />,
}), { virtual: true });

jest.mock("@/components/dm/GroupDMSection", () => ({
  __esModule: true,
  default: () => <div data-testid="group-dm-section-mock" />,
}), { virtual: true });

jest.mock("@/components/dm/GroupDMChat", () => ({
  __esModule: true,
  default: () => <div data-testid="group-dm-chat-mock" />,
}), { virtual: true });

jest.mock("@/components/friends/FriendsPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="friends-panel-mock" />,
}), { virtual: true });

jest.mock("@/components/friends/RelayDMChat", () => ({
  __esModule: true,
  default: () => <div data-testid="relay-dm-chat-mock" />,
}), { virtual: true });

jest.mock("@/lib/assetUrls", () => ({
  resolveAssetUrl: (url) => url,
}), { virtual: true });

jest.mock("../DirectMessageComposer", () => ({
  __esModule: true,
  default: () => <div data-testid="dm-composer-mock" />,
}), { virtual: true });

jest.mock("../DecryptedDirectMessageContent", () => ({
  __esModule: true,
  default: () => <span>decrypted</span>,
}), { virtual: true });

import DirectMessagesWorkspaceView from "../DirectMessagesWorkspaceView";

describe("DirectMessagesWorkspaceView", () => {
  const t = (key) => key;

  it("renders the sidebar and active dm pane with stable test ids", () => {
    const markup = renderToStaticMarkup(
      <DirectMessagesWorkspaceView
        t={t}
        config={{ assetBase: "" }}
        e2eeReady
        isDesktopCapable={false}
        sidebar={{
          dmConversations: [
            {
              user: { id: "user-1", username: "alice", display_name: "Alice" },
              unread_count: 2,
              last_message: { created_at: "2026-04-10T10:00:00.000Z", content: "Hi" },
            },
          ],
          dmSortMode: "recent",
          sortTitle: "Sortierung: Neueste zuerst",
          dmSearchOpen: false,
          dmSearchQuery: "",
          dmSearchResults: [],
          dmSearchLoading: false,
          dmTab: "dms",
          groupDMs: [],
          onCycleSortMode: () => {},
          onToggleSearch: () => {},
          onSelectTab: () => {},
          onChangeSearchQuery: () => {},
          onSelectDmUser: () => {},
          onSelectGroupDm: () => {},
          onStartRelayDm: () => {},
          onGroupsChanged: () => {},
        }}
        activePane={{
          currentGroupDM: null,
          relayDmFriend: null,
          currentDmUser: { id: "user-1", username: "alice", display_name: "Alice" },
          dmTrustNotice: false,
          dmHasOlderMessages: true,
          loadingOlderDmMessages: false,
          dmMessages: [
            {
              id: "message-1",
              created_at: "2026-04-10T10:00:00.000Z",
              sender: { display_name: "Alice" },
              content: "Encrypted",
            },
          ],
          onLoadOlderDmMessages: () => {},
          onDmSent: () => {},
        }}
      />,
    );

    expect(markup).toContain("dm-sidebar");
    expect(markup).toContain("dm-sort-btn");
    expect(markup).toContain("dm-new-btn");
    expect(markup).toContain("dm-tabs");
    expect(markup).toContain("dm-conversations-list");
    expect(markup).toContain("dm-chat-area");
    expect(markup).toContain("dm-msg-message-1");
  });

  it("renders the empty selection state when no active dm pane exists", () => {
    const markup = renderToStaticMarkup(
      <DirectMessagesWorkspaceView
        t={t}
        config={{ assetBase: "" }}
        e2eeReady
        isDesktopCapable={false}
        sidebar={{
          dmConversations: [],
          dmSortMode: "recent",
          sortTitle: "Sortierung: Neueste zuerst",
          dmSearchOpen: false,
          dmSearchQuery: "",
          dmSearchResults: [],
          dmSearchLoading: false,
          dmTab: "dms",
          groupDMs: [],
          onCycleSortMode: () => {},
          onToggleSearch: () => {},
          onSelectTab: () => {},
          onChangeSearchQuery: () => {},
          onSelectDmUser: () => {},
          onSelectGroupDm: () => {},
          onStartRelayDm: () => {},
          onGroupsChanged: () => {},
        }}
        activePane={{
          currentGroupDM: null,
          relayDmFriend: null,
          currentDmUser: null,
          dmTrustNotice: false,
          dmHasOlderMessages: false,
          loadingOlderDmMessages: false,
          dmMessages: [],
          onLoadOlderDmMessages: () => {},
          onDmSent: () => {},
        }}
      />,
    );

    expect(markup).toContain("dm-no-selection");
    expect(markup).toContain("dm-empty-state");
  });
});
