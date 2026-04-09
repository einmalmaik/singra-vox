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

jest.mock("@/components/channels/ChannelContainerDropZone", () => ({
  __esModule: true,
  default: ({ children }) => children({ setNodeRef: () => {}, isOver: false }),
}), { virtual: true });

jest.mock("@/lib/channelOrganization", () => ({
  getContainerDropId: (id) => `drop:${id}`,
  ROOT_CHANNEL_CONTAINER_ID: "root",
}), { virtual: true });

jest.mock("../ChannelTreeItem", () => ({
  __esModule: true,
  default: ({ channel }) => <div data-testid={`channel-${channel.name}`}>{channel.name}</div>,
}));

jest.mock("../VoiceParticipantList", () => ({
  __esModule: true,
  default: () => <div data-testid="voice-participants" />,
}));

import ChannelTree from "../ChannelTree";

describe("ChannelTree", () => {
  const t = (key) => key;

  it("renders root channels and preserves the create button test id", () => {
    const markup = renderToStaticMarkup(
      <ChannelTree
        sensors={[]}
        collisionDetection={() => []}
        onDragStart={() => {}}
        onDragCancel={() => {}}
        onDragEnd={() => {}}
        channelOrganization={{
          rootIds: ["text-1"],
          byId: {
            "text-1": { id: "text-1", name: "general", type: "text", parent_id: null, is_private: false },
          },
          childIdsByCategory: {},
        }}
        currentChannel={null}
        unreadMap={{}}
        collapsedCategories={{}}
        capabilities={{ canManageChannels: true }}
        activeDragChannel={null}
        isDraggingChannel={false}
        canDropIntoCategory={false}
        channelParticipantEntries={{}}
        currentUserId="user-1"
        onUpdateLocalPreferences={() => Promise.resolve()}
        onOpenMediaStage={() => {}}
        onHandleModerationAction={() => Promise.resolve()}
        onOpenCreateDialog={() => {}}
        onOpenCreateDialogButton={() => {}}
        onRenameChannel={() => Promise.resolve()}
        onDeleteChannel={() => Promise.resolve()}
        onMoveChannelToRoot={() => Promise.resolve()}
        onOpenServerSettings={() => {}}
        onActivateChannel={() => {}}
        createButtonLabel="Neuen Kanal"
        t={t}
      />,
    );

    expect(markup).toContain("channel-general");
    expect(markup).toContain("create-channel-button");
    expect(markup).toContain("Neuen Kanal");
  });
});
