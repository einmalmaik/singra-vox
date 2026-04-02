import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MonitorPlay, VideoCamera } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRuntime } from "@/contexts/RuntimeContext";

export default function VoiceMediaStage({
  open,
  onClose,
  voiceEngineRef,
  participantId,
  participantName,
  source,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const videoRef = useRef(null);
  const [documentHidden, setDocumentHidden] = useState(() => document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentHidden(document.hidden);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (documentHidden || !open || !voiceEngineRef?.current || !participantId || !source || !videoRef.current) {
      return undefined;
    }

    const videoElement = videoRef.current;

    // The media element stays owned by React while the LiveKit track is
    // attached and detached on demand. This keeps stage switches predictable.
    const detach = voiceEngineRef.current.attachParticipantMediaElement(
      participantId,
      source,
      videoElement,
    );

    return () => {
      videoElement?.pause?.();
      detach?.();
    };
  }, [documentHidden, open, participantId, source, voiceEngineRef]);

  const isScreenShare = source === "screen_share";
  const title = isScreenShare
    ? t("mediaStage.screenShareTitle", { name: participantName || t("common.unknown") })
    : t("mediaStage.cameraTitle", { name: participantName || t("common.unknown") });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose?.() : null)}>
      <DialogContent className="workspace-panel-solid max-w-5xl text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold" style={{ fontFamily: "Manrope" }}>
            {isScreenShare ? <MonitorPlay size={18} /> : <VideoCamera size={18} />}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80">
            {documentHidden ? (
              <div className="flex h-[70vh] w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_35%),linear-gradient(180deg,#05070b,#09090b)] px-6 text-center text-sm text-zinc-400">
                {t("mediaStage.previewPaused", {
                  defaultValue: "The local preview is paused while the app is in the background to avoid unnecessary rendering work.",
                })}
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                controls={false}
                className="h-[70vh] w-full bg-black object-contain"
              />
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {documentHidden
              ? t("mediaStage.previewPausedHint", {
                defaultValue: "The stream keeps running for other viewers. Only the local preview is paused in the background.",
              })
              : (config?.isDesktop
                ? t("mediaStage.desktopHint")
                : t("mediaStage.webHint"))}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
