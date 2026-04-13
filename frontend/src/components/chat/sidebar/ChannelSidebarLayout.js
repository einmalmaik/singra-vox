/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export default function ChannelSidebarLayout({
  header,
  tree,
  voiceDock,
  userBar,
  dialogs,
}) {
  return (
    <>
      <div className="workspace-panel w-[300px] h-full min-h-0 flex flex-col shrink-0 overflow-hidden" data-testid="channel-sidebar">
        {header}
        <div className="flex-1 min-h-0 flex flex-col">
          {tree}
          {voiceDock}
          {userBar}
        </div>
      </div>
      {dialogs}
    </>
  );
}
