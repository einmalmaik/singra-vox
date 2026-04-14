import { act } from "react";
import { createRoot } from "react-dom/client";

let mockDesktopUpdateState = {
  isDesktop: true,
  phase: "checking",
  progress: 0,
  update: null,
  errorMsg: null,
  showStartupGate: true,
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options = {}) => {
      if (key === "desktopUpdater.versionTransition") {
        return `${options.current} -> ${options.next}`;
      }
      return key;
    },
  }),
}), { virtual: true });

jest.mock("../DesktopUpdateState", () => ({
  DesktopUpdateProvider: ({ children }) => children,
  useDesktopUpdateState: () => mockDesktopUpdateState,
}), { virtual: true });

import {
  DesktopStartupUpdateGate,
  UpdateNotification,
} from "../UpdateNotification";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UpdateNotification", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the startup gate before the workspace is shown", async () => {
    mockDesktopUpdateState = {
      isDesktop: true,
      phase: "checking",
      progress: 0,
      update: { currentVersion: "0.5.8" },
      errorMsg: null,
      showStartupGate: true,
    };

    await act(async () => {
      root.render(<DesktopStartupUpdateGate />);
    });

    expect(container.querySelector("[data-testid='desktop-update-startup-gate']")).not.toBeNull();
    expect(container.textContent).toContain("desktopUpdater.checking");
  });

  it("renders the compact banner once startup has finished", async () => {
    mockDesktopUpdateState = {
      isDesktop: true,
      phase: "downloading",
      progress: 42,
      update: { currentVersion: "0.5.8", version: "0.5.9" },
      errorMsg: null,
      showStartupGate: false,
    };

    await act(async () => {
      root.render(<UpdateNotification />);
    });

    expect(container.querySelector("[data-testid='desktop-update-startup-gate']")).toBeNull();
    expect(container.querySelector("[data-testid='update-notification']")).not.toBeNull();
    expect(container.textContent).toContain("0.5.8 -> 0.5.9");
    expect(container.textContent).toContain("42%");
  });
});
