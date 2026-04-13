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

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <div>{children}</div>,
}), { virtual: true });

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}), { virtual: true });

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...props }) => <div {...props}>{children}</div>,
}), { virtual: true });

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }) => <div>{children}</div>,
  SelectValue: () => null,
}), { virtual: true });

jest.mock("@/components/ui/slider", () => ({
  Slider: ({ value, ...props }) => <input type="range" defaultValue={Array.isArray(value) ? value[0] : value} readOnly {...props} />,
}), { virtual: true });

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, ...props }) => <input type="checkbox" defaultChecked={checked} readOnly {...props} />,
}), { virtual: true });

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <div>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }) => <button data-value={value}>{children}</button>,
}), { virtual: true });

import ScreenShareDialog from "../ScreenShareDialog";

describe("ScreenShareDialog", () => {
  const t = (key) => key;

  it("renders the native desktop picker and audio controls", () => {
    const markup = renderToStaticMarkup(
      <ScreenShareDialog
        open
        onOpenChange={() => {}}
        isDesktop
        useNativeScreenShare
        screenShareCapabilities={{
          supportsSystemAudio: true,
        }}
        captureSourcesStatus="ready"
        captureSourceType="display"
        filteredCaptureSources={[
          { id: "display-1", label: "Display 1", width: 2560, height: 1440 },
        ]}
        selectedCaptureSourceId="display-1"
        screenSharePresetOptions={[{ id: "auto", label: "Auto" }]}
        screenShareQuality="auto"
        screenShareAudio
        screenShareAudioVolume={100}
        screenShareSurface="monitor"
        screenShareEnabled={false}
        screenShareMeta={{ sourceLabel: null, actualCaptureSettings: null }}
        onCaptureSourceTypeChange={() => {}}
        onSelectedCaptureSourceChange={() => {}}
        onScreenShareQualityChange={() => {}}
        onScreenShareAudioChange={() => {}}
        onScreenShareSurfaceChange={() => {}}
        onUpdateScreenShareAudioVolume={() => {}}
        onStartScreenShare={() => Promise.resolve()}
        onStopScreenShare={() => Promise.resolve()}
        t={t}
      />,
    );

    expect(markup).toContain("Display 1");
    expect(markup).toContain("screen-share-audio-volume-slider");
    expect(markup).toContain("channel.shareEntireScreen");
  });
});
