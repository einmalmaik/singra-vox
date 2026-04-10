import { renderToStaticMarkup } from "react-dom/server";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}), { virtual: true });

const mockController = jest.fn(() => ({
  channel: null,
  header: { value: "header" },
  timeline: { value: "timeline" },
  composer: { value: "composer" },
  pinsPanel: { open: false },
  threadPanel: { open: false },
}));

jest.mock("@/components/chat/chat-area/useChatAreaController", () => ({
  __esModule: true,
  default: (props) => mockController(props),
}), { virtual: true });

jest.mock("@/components/chat/chat-area/ChatAreaShell", () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="chat-area-shell-mock">
      {props.t("chat.selectChannel")}
    </div>
  ),
}), { virtual: true });

import ChatArea from "../ChatArea";

describe("ChatArea facade", () => {
  it("delegates orchestration to the controller and renders the shell", () => {
    const props = {
      channel: { id: "channel-1" },
      messages: [],
      setMessages: () => {},
      user: { id: "user-1" },
      server: { id: "server-1" },
      serverId: "server-1",
    };

    const markup = renderToStaticMarkup(<ChatArea {...props} />);

    expect(mockController).toHaveBeenCalledWith(props);
    expect(markup).toContain("chat-area-shell-mock");
    expect(markup).toContain("chat.selectChannel");
  });
});
