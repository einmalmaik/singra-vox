/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ScreenShareDialog({
  open,
  onOpenChange,
  isDesktop,
  useNativeScreenShare,
  screenShareCapabilities,
  captureSourcesStatus,
  captureSourceType,
  filteredCaptureSources,
  selectedCaptureSourceId,
  screenSharePresetOptions,
  screenShareQuality,
  screenShareAudio,
  screenShareAudioVolume,
  screenShareSurface,
  screenShareEnabled,
  screenShareMeta,
  onCaptureSourceTypeChange,
  onSelectedCaptureSourceChange,
  onScreenShareQualityChange,
  onScreenShareAudioChange,
  onScreenShareSurfaceChange,
  onUpdateScreenShareAudioVolume,
  onStartScreenShare,
  onStopScreenShare,
  t,
}) {
  const renderQualitySelect = () => (
    <div className="space-y-2">
      <Label className="workspace-section-label">{t("channel.shareQuality")}</Label>
      <select
        value={screenShareQuality}
        onChange={(event) => onScreenShareQualityChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
      >
        {screenSharePresetOptions.map((preset) => (
          <option key={preset.id} value={preset.id} className="bg-zinc-950 text-white">
            {preset.label}
          </option>
        ))}
      </select>
    </div>
  );

  const renderAudioCard = (sliderTestId) => {
    if (!screenShareCapabilities.supportsSystemAudio) {
      return null;
    }

    return (
      <div className="workspace-card space-y-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">{t("channel.shareSystemAudio")}</p>
            <p className="text-xs text-zinc-400">{t("channel.shareSystemAudioHelp")}</p>
          </div>
          <Switch checked={screenShareAudio} onCheckedChange={onScreenShareAudioChange} />
        </div>
        {screenShareAudio && (
          <div className="space-y-2 pt-1 border-t border-white/5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t("channel.shareAudioVolume")}</span>
              <span>{screenShareAudioVolume}%</span>
            </div>
            <Slider
              value={[screenShareAudioVolume]}
              min={0}
              max={200}
              step={5}
              onValueChange={([value]) => onUpdateScreenShareAudioVolume(value)}
              data-testid={sliderTestId}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-panel-solid max-w-3xl text-white">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "Manrope" }}>{t("channel.shareScreen")}</DialogTitle>
        </DialogHeader>
        {isDesktop && useNativeScreenShare ? (
          <div className="grid gap-5 lg:grid-cols-[1.35fr_minmax(0,0.9fr)]">
            <div className="space-y-4">
              <Tabs value={captureSourceType} onValueChange={onCaptureSourceTypeChange}>
                <TabsList className="grid w-full grid-cols-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-1 text-white">
                  <TabsTrigger value="display" className="rounded-xl data-[state=active]:bg-cyan-400 data-[state=active]:text-zinc-950">
                    {t("channel.shareEntireScreen")}
                  </TabsTrigger>
                  <TabsTrigger value="window" className="rounded-xl data-[state=active]:bg-cyan-400 data-[state=active]:text-zinc-950">
                    {t("channel.shareWindow")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="workspace-card overflow-hidden border border-white/10 bg-zinc-950/70">
                <ScrollArea className="h-[22rem]">
                  <div className="space-y-2 p-3">
                    {captureSourcesStatus === "loading" && (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-400">
                        {t("channel.loadingCaptureSources")}
                      </div>
                    )}
                    {captureSourcesStatus === "ready" && filteredCaptureSources.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-400">
                        {t("channel.noCaptureSources")}
                      </div>
                    )}
                    {filteredCaptureSources.map((source) => {
                      const isSelected = source.id === selectedCaptureSourceId;
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => onSelectedCaptureSourceChange(source.id)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-cyan-400/70 bg-cyan-400/12 shadow-[0_0_0_1px_rgba(34,211,238,0.28)]"
                              : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-white">{source.label}</p>
                              <p className="text-xs text-zinc-400">
                                {source.appName
                                  ? `${source.appName} · ${source.width} × ${source.height}`
                                  : `${source.width} × ${source.height}`}
                              </p>
                            </div>
                            {isSelected && (
                              <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[11px] font-medium text-cyan-200">
                                {t("common.selected")}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className="space-y-4">
              {renderQualitySelect()}
              {renderAudioCard("screen-share-audio-volume-slider")}

              <div className="workspace-card space-y-2 px-4 py-3 text-xs text-zinc-400">
                <p>{t("channel.nativeShareHint")}</p>
                {screenShareEnabled && screenShareMeta.sourceLabel && (
                  <p className="text-cyan-200">
                    {t("channel.currentShareSource", { source: screenShareMeta.sourceLabel })}
                  </p>
                )}
              </div>

              {screenShareEnabled && screenShareMeta.actualCaptureSettings && (
                <div className="workspace-card px-4 py-3 text-xs text-zinc-400">
                  {`${Math.round(screenShareMeta.actualCaptureSettings.width || 0)} × ${Math.round(screenShareMeta.actualCaptureSettings.height || 0)} @ ${Math.round(screenShareMeta.actualCaptureSettings.frameRate || 0)} FPS`}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="rounded-2xl border-white/10 bg-transparent text-white hover:bg-white/8"
                >
                  {t("common.cancel")}
                </Button>
                {screenShareEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void onStopScreenShare()}
                    className="rounded-2xl border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/15"
                  >
                    {t("channel.stopSharing")}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => void onStartScreenShare()}
                  className="rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                  disabled={captureSourcesStatus !== "ready" || !selectedCaptureSourceId}
                >
                  {screenShareEnabled ? t("channel.switchShareSource") : t("channel.startSharing")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {renderQualitySelect()}

            <div className="space-y-2">
              <Label className="workspace-section-label">{t("channel.shareSurface")}</Label>
              <Select value={screenShareSurface} onValueChange={onScreenShareSurfaceChange}>
                <SelectTrigger className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="workspace-panel-solid border-white/10 text-white">
                  <SelectItem value="monitor">{t("channel.shareEntireScreen")}</SelectItem>
                  <SelectItem value="window">{t("channel.shareWindow")}</SelectItem>
                  <SelectItem value="browser">{t("channel.shareTab")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {renderAudioCard("screen-share-audio-volume-web")}

            <div className="workspace-card px-4 py-3 text-xs text-[#71717A]">
              {t("channel.shareScreenPickerHint")}
            </div>

            {screenShareEnabled && screenShareMeta.actualCaptureSettings && (
              <div className="workspace-card px-4 py-3 text-xs text-zinc-400">
                {`${Math.round(screenShareMeta.actualCaptureSettings.width || 0)} × ${Math.round(screenShareMeta.actualCaptureSettings.height || 0)} @ ${Math.round(screenShareMeta.actualCaptureSettings.frameRate || 0)} FPS`}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="rounded-2xl border-white/10 bg-transparent text-white hover:bg-white/8"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void onStartScreenShare()}
                className="rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
              >
                {t("channel.startSharing")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
