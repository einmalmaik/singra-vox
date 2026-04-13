/*
 * Singra Vox - Chat area facade
 *
 * Keeps the public component contract stable while delegating state and side
 * effects to the chat-area controller module.
 */
import { useTranslation } from "react-i18next";
import ChatAreaShell from "@/components/chat/chat-area/ChatAreaShell";
import useChatAreaController from "@/components/chat/chat-area/useChatAreaController";

export default function ChatArea(props) {
  const { t } = useTranslation();
  const controller = useChatAreaController(props);

  return <ChatAreaShell {...controller} t={t} />;
}
