/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import ServerSidebar from "@/components/chat/ServerSidebar";
import DirectMessagesWorkspaceView from "./DirectMessagesWorkspaceView";
import ServerWorkspaceView from "./ServerWorkspaceView";

/**
 * Outer page shell for the workspace. It only composes already prepared views
 * and stays free of business logic so the page can be smoke-tested in isolation.
 */
export default function MainLayoutShell({
  shell,
  serverWorkspace,
  directMessagesWorkspace,
}) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-transparent p-2 gap-2" data-testid="main-layout">
      {!shell.wsConnected && (
        <div
          className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 py-1 text-xs font-medium"
          style={{ background: "rgba(161,161,170,0.15)", borderBottom: "1px solid rgba(161,161,170,0.15)", color: "#a1a1aa" }}
          data-testid="ws-reconnect-banner"
        >
          <div className="w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
          <span>Verbindung unterbrochen - verbinde erneut...</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[30rem] w-[30rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -right-24 bottom-[-8rem] h-[26rem] w-[26rem] rounded-full bg-zinc-500/12 blur-[120px]" />
      </div>

      <ServerSidebar {...shell.serverSidebarProps} />

      {shell.view === "server" && serverWorkspace.currentServer ? (
        <ServerWorkspaceView {...serverWorkspace} />
      ) : shell.view === "dm" ? (
        <DirectMessagesWorkspaceView {...directMessagesWorkspace} />
      ) : (
        <div className="workspace-panel flex-1 flex items-center justify-center text-[#71717A]">
          {shell.loadingLabel}
        </div>
      )}
    </div>
  );
}
