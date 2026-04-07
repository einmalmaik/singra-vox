/*
 * Singra Vox – Voice & Video settings tab
 * Handles device selection, volume, PTT, mic test, and audio processing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Microphone, VideoCamera } from "@phosphor-icons/react";
import { toast } from "sonner";
import { formatAppError } from "@/lib/appErrors";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { loadVoicePreferences, saveVoicePreferences } from "@/lib/voicePreferences";
import { capturePttShortcut, describePttShortcut } from "@/lib/pttShortcut";
import {
  SETTINGS_NATIVE_SELECT_CLASSNAME,
  supportOutputDeviceSelection,
} from "../settingsConstants";

export default function VoiceSettingsTab({ user, voiceEngineRef, pttDebug }) {
  const { t, i18n } = useTranslation();
  const { config } = useRuntime();
  const isDesktop = Boolean(config?.isDesktop);

  const previewEngineRef = useRef(null);
  const micTestEngineRef = useRef(null);

  const [voicePreferences, setVoicePreferences] = useState(() =>
    loadVoicePreferences(user?.id, { isDesktop }),
  );
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [videoInputs, setVideoInputs] = useState([]);
  const [pttListening, setPttListening] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputThreshold, setInputThreshold] = useState(0);
  const [inputAboveThreshold, setInputAboveThreshold] = useState(false);

  const updateVoicePreferences = useCallback(
    async (partialUpdate) => {
      const next = saveVoicePreferences(user?.id, partialUpdate, { isDesktop });
      setVoicePreferences(next);
      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.setPreferences(next);
        if (typeof partialUpdate.pttEnabled === "boolean") {
          voiceEngineRef.current.setPTT(partialUpdate.pttEnabled);
        }
      }
    },
    [isDesktop, user?.id, voiceEngineRef],
  );

  useEffect(() => {
    setVoicePreferences(loadVoicePreferences(user?.id, { isDesktop }));
  }, [isDesktop, user?.id]);

  // Enumerate media devices on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setAudioInputs(devices.filter((d) => d.kind === "audioinput"));
        setAudioOutputs(devices.filter((d) => d.kind === "audiooutput"));
        setVideoInputs(devices.filter((d) => d.kind === "videoinput"));
      } catch {
        if (!cancelled) {
          setAudioInputs([]);
          setAudioOutputs([]);
          setVideoInputs([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // PTT: disable on non-desktop
  useEffect(() => {
    if (!isDesktop) setPttListening(false);
  }, [isDesktop]);

  // PTT key capture
  useEffect(() => {
    if (!pttListening) return;
    const handler = (event) => {
      const captured = capturePttShortcut(event);
      if (!captured) return;
      event.preventDefault();
      updateVoicePreferences({
        pttKey: captured.accelerator,
        pttLabel: captured.label,
        pttEnabled: true,
      });
      setPttListening(false);
      toast.success(t("settings.pttKeySet", { key: captured.label }));
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [pttListening, t, updateVoicePreferences]);

  // Voice engine for mic test preview
  const getActiveVoiceEngine = useCallback(async () => {
    if (voiceEngineRef?.current) return voiceEngineRef.current;
    if (previewEngineRef.current) return previewEngineRef.current;
    const { VoiceEngine } = await import("@/lib/voiceEngine");
    const engine = new VoiceEngine();
    await engine.init({
      userId: user?.id,
      preferences: loadVoicePreferences(user?.id, { isDesktop }),
    });
    previewEngineRef.current = engine;
    return engine;
  }, [isDesktop, user?.id, voiceEngineRef]);

  // Mic test level subscription
  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    (async () => {
      try {
        const engine = await getActiveVoiceEngine();
        if (cancelled || !engine) return;
        micTestEngineRef.current = engine;
        unsubscribe = engine.addStateListener((event) => {
          if (event.type !== "input_level") return;
          setInputLevel(event.level || 0);
          setInputThreshold(event.threshold || 0);
          setInputAboveThreshold(Boolean(event.aboveThreshold));
        });
      } catch {
        setInputLevel(0);
        setInputThreshold(0);
        setInputAboveThreshold(false);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      micTestEngineRef.current = null;
    };
  }, [getActiveVoiceEngine]);

  // Cleanup preview engine on unmount
  useEffect(
    () => () => {
      if (previewEngineRef.current) {
        void previewEngineRef.current.disconnect();
        previewEngineRef.current = null;
      }
    },
    [],
  );

  const toggleMicTest = async (enabled) => {
    try {
      const next = saveVoicePreferences(user?.id, { micTestEnabled: enabled }, { isDesktop });
      setVoicePreferences(next);
      const engine = await getActiveVoiceEngine();
      micTestEngineRef.current = engine;
      await engine.setPreferences(next);
      if (enabled) await engine.startMicTest();
      else await engine.stopMicTest();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "settings.micTestToggleFailed" }));
    }
  };

  return (
    <div className="space-y-8" data-testid="voice-settings-panel">
      {/* Device selection */}
      <section className="workspace-card p-5">
        <div className="mb-4">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.voiceVideo")}</h3>
          <p className="mt-1 text-sm text-[#71717A]">{t("settings.voiceVideoDescription")}</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.inputDevice")}</Label>
            <select
              value={voicePreferences.inputDeviceId || ""}
              onChange={(e) => updateVoicePreferences({ inputDeviceId: e.target.value })}
              className={SETTINGS_NATIVE_SELECT_CLASSNAME}
            >
              <option value="">{t("settings.defaultMicrophone")}</option>
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.outputDevice")}</Label>
            <select
              value={voicePreferences.outputDeviceId || ""}
              onChange={(e) => updateVoicePreferences({ outputDeviceId: e.target.value })}
              disabled={!supportOutputDeviceSelection()}
              className={SETTINGS_NATIVE_SELECT_CLASSNAME}
            >
              <option value="">{t("settings.defaultOutput")}</option>
              {audioOutputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            {!supportOutputDeviceSelection() && (
              <p className="text-xs text-[#71717A]">{t("settings.outputDeviceUnsupported")}</p>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-2">
            <VideoCamera size={16} className="text-[#71717A]" />
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.cameraDevice")}</Label>
          </div>
          <select
            value={voicePreferences.cameraDeviceId || ""}
            onChange={(e) => updateVoicePreferences({ cameraDeviceId: e.target.value })}
            className={SETTINGS_NATIVE_SELECT_CLASSNAME}
          >
            <option value="">{t("settings.defaultCamera")}</option>
            {videoInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.inputVolume")}</Label>
              <span className="text-xs text-[#A1A1AA]">{voicePreferences.inputVolume}%</span>
            </div>
            <Slider
              value={[voicePreferences.inputVolume]}
              min={0} max={200} step={5}
              onValueChange={([v]) => updateVoicePreferences({ inputVolume: v })}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.outputVolume")}</Label>
              <span className="text-xs text-[#A1A1AA]">{voicePreferences.outputVolume}%</span>
            </div>
            <Slider
              value={[voicePreferences.outputVolume]}
              min={0} max={200} step={5}
              onValueChange={([v]) => updateVoicePreferences({ outputVolume: v })}
            />
          </div>
        </div>
      </section>

      {/* PTT & Audio Processing */}
      <section className="workspace-card p-5">
        <div className="mb-4">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.pushToTalkAndAudioProcessing")}</h3>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{t("settings.pushToTalk")}</p>
                <p className="text-xs text-[#71717A]">
                  {isDesktop ? t("settings.pushToTalkDesktopHelp") : t("settings.pushToTalkWebDisabled")}
                </p>
              </div>
              <Switch
                checked={voicePreferences.pttEnabled}
                onCheckedChange={(checked) => updateVoicePreferences({ pttEnabled: checked })}
                disabled={!isDesktop}
              />
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full rounded-2xl border-white/10 bg-zinc-950/60 text-white hover:bg-white/8 disabled:opacity-50"
              onClick={() => isDesktop && setPttListening(true)}
              disabled={!isDesktop}
            >
              <Keyboard size={14} className="mr-2" />
              {pttListening
                ? t("settings.pressAnyKey")
                : t("settings.keyLabel", {
                    key: voicePreferences.pttLabel || describePttShortcut(voicePreferences.pttKey, { locale: i18n.language }),
                  })}
            </Button>
            {isDesktop && (
              <div className="mt-3 space-y-1 rounded-2xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-[#A1A1AA]">
                <p>{t("settings.pttStatus", { status: pttDebug?.registered ? t("settings.pttRegistered") : t("settings.pttWaiting") })}</p>
                <p>{t("settings.pttLastEvent", { event: pttDebug?.lastEventState || "\u2014" })}</p>
                <p>{t("settings.pttLastShortcut", { key: pttDebug?.lastShortcut || voicePreferences.pttKey || "\u2014" })}</p>
                <p>{t("settings.pttMicGate", { state: pttDebug?.active ? t("settings.pttMicOpen") : t("settings.pttMicClosed") })}</p>
                {pttDebug?.error ? (
                  <p className="text-[#FCA5A5]">{t("settings.pttRegistrationError", { error: pttDebug.error })}</p>
                ) : null}
              </div>
            )}
            {isDesktop && (
              <p className="mt-3 text-xs text-[#71717A]">{t("settings.pttSystemWarning")}</p>
            )}
          </div>

          <div className="space-y-3 rounded-3xl border border-white/10 bg-zinc-950/60 p-4">
            {[
              ["noiseSuppression", t("settings.noiseSuppression")],
              ["echoCancellation", t("settings.echoCancellation")],
              ["autoGainControl", t("settings.autoGainControl")],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-white">{label}</span>
                <Switch
                  checked={voicePreferences[key]}
                  onCheckedChange={(checked) => updateVoicePreferences({ [key]: checked })}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mic Test & Sensitivity */}
      <section className="workspace-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Microphone size={18} className="text-cyan-300" />
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.micTestAndSensitivity")}</h3>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 rounded-3xl border border-white/10 bg-zinc-950/60 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">{t("settings.micTest")}</p>
                <p className="mt-1 text-xs text-[#71717A]">{t("settings.micTestDescription")}</p>
              </div>
              <Switch checked={voicePreferences.micTestEnabled} onCheckedChange={toggleMicTest} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">
                <span>{t("settings.inputLevel")}</span>
                <span>{Math.round(inputLevel * 100)}%</span>
              </div>
              <div className="relative h-3 overflow-hidden rounded-full bg-[#18181B]">
                <div
                  className={`h-full rounded-full transition-all ${inputAboveThreshold ? "bg-[#22C55E]" : "bg-cyan-400"}`}
                  style={{ width: `${Math.round(inputLevel * 100)}%` }}
                />
                <div
                  className="absolute inset-y-0 w-[3px] rounded-full bg-[#EF4444] shadow-[0_0_10px_rgba(239,68,68,0.45)]"
                  style={{ left: `${Math.min(99, Math.max(0, inputLevel * 100))}%` }}
                />
                <div
                  className="absolute inset-y-0 w-[2px] bg-[#F59E0B]"
                  style={{ left: `${Math.min(98, Math.max(0, inputThreshold * 100))}%` }}
                />
              </div>
              <p className="text-xs text-[#71717A]">
                {voicePreferences.autoInputSensitivity ? t("settings.autoSensitivityHelp") : t("settings.manualSensitivityHelp")}
              </p>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">{t("settings.autoSensitivity")}</p>
                <p className="text-xs text-[#71717A]">{t("settings.autoSensitivityDescription")}</p>
              </div>
              <Switch
                checked={voicePreferences.autoInputSensitivity}
                onCheckedChange={(checked) => updateVoicePreferences({ autoInputSensitivity: checked })}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.inputSensitivity")}</Label>
                <span className="text-xs text-[#A1A1AA]">{voicePreferences.inputSensitivity}%</span>
              </div>
              <Slider
                value={[voicePreferences.inputSensitivity]}
                min={0} max={100} step={1}
                disabled={voicePreferences.autoInputSensitivity}
                onValueChange={([v]) => updateVoicePreferences({ inputSensitivity: v })}
              />
              <p className="text-xs text-[#71717A]">{t("settings.inputSensitivityDescription")}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
