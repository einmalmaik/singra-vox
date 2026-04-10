/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { List, UsersThree } from "@phosphor-icons/react";
import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import MemberSidebar from "@/components/chat/MemberSidebar";

/**
 * Presentational server workspace. It receives fully prepared props from the
 * MainLayout controller and never talks to APIs or sockets directly.
 */
export default function ServerWorkspaceView({
  showChannels,
  showMembers,
  setShowChannels,
  setShowMembers,
  channelSidebarProps,
  chatAreaProps,
  memberSidebarProps,
  currentChannel,
  currentServer,
}) {
  return (
    <>
      {showChannels && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setShowChannels(false)} />}
      {showMembers && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setShowMembers(false)} />}

      <div className={`${showChannels ? "fixed left-[80px] top-2 bottom-2 z-50 h-[calc(100vh-1rem)]" : "hidden"} md:relative md:block md:h-full`}>
        <ChannelSidebar {...channelSidebarProps} />
      </div>

      <div className="workspace-panel flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b workspace-divider bg-zinc-900/25 md:hidden shrink-0" data-testid="mobile-toolbar">
          <button onClick={() => setShowChannels(true)} data-testid="toggle-channels-mobile" className="workspace-icon-button">
            <List size={18} />
          </button>
          <span className="text-sm font-bold text-white flex-1 truncate" style={{ fontFamily: "Manrope" }}>
            {currentChannel ? `# ${currentChannel.name}` : currentServer?.name}
          </span>
          <button onClick={() => setShowMembers(true)} data-testid="toggle-members-mobile" className="workspace-icon-button">
            <UsersThree size={18} />
          </button>
        </div>
        <ChatArea {...chatAreaProps} />
      </div>

      <div className={`${showMembers ? "fixed right-2 top-2 bottom-2 z-50 h-[calc(100vh-1rem)]" : "hidden"} md:relative md:block md:h-full`}>
        <MemberSidebar {...memberSidebarProps} />
      </div>
    </>
  );
}
