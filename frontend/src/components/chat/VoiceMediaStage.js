import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!open || !voiceEngineRef?.current || !participantId || !source || !videoRef.current) {
      return undefined;
    }

    // The media element stays owned by React while the LiveKit track is
    // attached and detached on demand. This keeps stage switches predictable.
    const detach = voiceEngineRef.current.attachParticipantMediaElement(
      participantId,
      source,
      videoRef.current,
    );

    return () => {
      detach?.();
    };
  }, [open, participantId, source, voiceEngineRef]);

  const isScreenShare = source === "screen_share";
  const title = isScreenShare
    ? t("mediaStage.screenShareTitle", { name: participantName || t("common.unknown") })
    : t("mediaStage.cameraTitle", { name: participantName || t("common.unknown") });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose?.() : null)}>
      <DialogContent className="max-w-5xl border-[#27272A] bg-[#121212] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold" style={{ fontFamily: "Manrope" }}>
            {isScreenShare ? <MonitorPlay size={18} /> : <VideoCamera size={18} />}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-[#27272A] bg-[#0A0A0A]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              controls={false}
              className="h-[70vh] w-full bg-black object-contain"
            />
          </div>
          <p className="text-xs text-[#71717A]">
            {config?.isDesktop
              ? t("mediaStage.desktopHint")
              : t("mediaStage.webHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
