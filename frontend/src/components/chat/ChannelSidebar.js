/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useTranslation } from "react-i18next";
import ServerSettingsOverlay from "@/components/settings/ServerSettingsOverlay";
import GlobalSettingsOverlay from "@/components/settings/GlobalSettingsOverlay";
import VoiceMediaStage from "@/components/chat/VoiceMediaStage";
import ChannelSidebarLayout from "@/components/chat/sidebar/ChannelSidebarLayout";
import ChannelSidebarHeader from "@/components/chat/sidebar/ChannelSidebarHeader";
import ChannelTree from "@/components/chat/sidebar/ChannelTree";
import VoiceDock from "@/components/chat/sidebar/VoiceDock";
import CreateChannelDialog from "@/components/chat/sidebar/CreateChannelDialog";
import ScreenShareDialog from "@/components/chat/sidebar/ScreenShareDialog";
import UserBar from "@/components/chat/sidebar/UserBar";
import { useChannelSidebarController } from "@/components/chat/sidebar/useChannelSidebarController";

export default function ChannelSidebar(props) {
  const { t } = useTranslation();
  const controller = useChannelSidebarController({ ...props, t });

  return (
    <ChannelSidebarLayout
      header={<ChannelSidebarHeader {...controller.layout.header} />}
      tree={<ChannelTree {...controller.channelTree} />}
      voiceDock={<VoiceDock {...controller.voiceDock} />}
      userBar={<UserBar {...controller.userBar} />}
      dialogs={(
        <>
          <CreateChannelDialog {...controller.dialogs.createChannel} />
          <ServerSettingsOverlay {...controller.dialogs.serverSettings} />
          <GlobalSettingsOverlay {...controller.dialogs.userSettings} />
          <ScreenShareDialog {...controller.dialogs.screenShare} />
          <VoiceMediaStage {...controller.dialogs.mediaStage} />
        </>
      )}
    />
  );
}
