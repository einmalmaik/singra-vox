import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Export,
  GearSix,
  Keyboard,
  Microphone,
  ShieldCheck,
  SlidersHorizontal,
  SpeakerHigh,
  Trash,
  UserCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatError } from "@/lib/api";
import { useRuntime } from "@/contexts/RuntimeContext";
import SettingsOverlayShell from "@/components/settings/SettingsOverlayShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { loadVoicePreferences, saveVoicePreferences } from "@/lib/voicePreferences";
import { SUPPORTED_LANGUAGES } from "@/i18n";

const SECTION_CONFIG = [
  { id: "voice", icon: <SlidersHorizontal size={16} /> },
  { id: "account", icon: <UserCircle size={16} /> },
  { id: "privacy", icon: <ShieldCheck size={16} /> },
];

function supportOutputDeviceSelection() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

export default function GlobalSettingsOverlay({
  open,
  onClose,
  user,
  voiceEngineRef,
  channels,
  onUserUpdated,
  onLogout,
}) {
  const { t, i18n } = useTranslation();
  const { config } = useRuntime();
  const isDesktop = Boolean(config?.isDesktop);
  const previewEngineRef = useRef(null);
  const micTestEngineRef = useRef(null);
  const [activeSection, setActiveSection] = useState("voice");
  const [voicePreferences, setVoicePreferences] = useState(
    loadVoicePreferences(user?.id, { isDesktop }),
  );
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [status, setStatus] = useState(user?.status || "online");
  const [pttListening, setPttListening] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [inputThreshold, setInputThreshold] = useState(0);
  const [inputAboveThreshold, setInputAboveThreshold] = useState(false);

  const updateVoicePreferences = useCallback(async (partialUpdate) => {
    const nextPreferences = saveVoicePreferences(user?.id, partialUpdate, { isDesktop });
    setVoicePreferences(nextPreferences);
    if (voiceEngineRef?.current) {
      await voiceEngineRef.current.setPreferences(nextPreferences);
      if (typeof partialUpdate.pttEnabled === "boolean") {
        voiceEngineRef.current.setPTT(partialUpdate.pttEnabled);
      }
    }
  }, [isDesktop, user?.id, voiceEngineRef]);

  useEffect(() => {
    setVoicePreferences(loadVoicePreferences(user?.id, { isDesktop }));
    setDisplayName(user?.display_name || "");
    setAvatarUrl(user?.avatar_url || "");
    setStatus(user?.status || "online");
  }, [isDesktop, user]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
        setAudioOutputs(devices.filter((device) => device.kind === "audiooutput"));
      } catch {
        if (!cancelled) {
          setAudioInputs([]);
          setAudioOutputs([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!isDesktop) {
      setPttListening(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!pttListening) return;
    const handler = (event) => {
      event.preventDefault();
      updateVoicePreferences({ pttKey: event.code, pttEnabled: true });
      setPttListening(false);
      toast.success(t("settings.pttKeySet", { key: event.code }));
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [pttListening, t, updateVoicePreferences]);

  const activeVoiceChannel = useMemo(() => {
    const activeChannelId = voiceEngineRef?.current?.channelId;
    if (!activeChannelId) return null;
    return channels?.find((channel) => channel.id === activeChannelId) || null;
  }, [channels, voiceEngineRef]);

  const sectionConfig = useMemo(() => ([
    { ...SECTION_CONFIG[0], label: t("settings.voiceVideo") },
    { ...SECTION_CONFIG[1], label: t("settings.account") },
    { ...SECTION_CONFIG[2], label: t("settings.privacy") },
  ]), [t]);

  const statusOptions = useMemo(() => ([
    { value: "online", label: t("settings.statusOnline") },
    { value: "away", label: t("settings.statusAway") },
    { value: "dnd", label: t("settings.statusDnd") },
    { value: "offline", label: t("settings.statusInvisible") },
  ]), [t]);

  const remoteParticipants = useMemo(
    () => (activeVoiceChannel?.voice_states || []).filter((state) => state.user_id !== user?.id),
    [activeVoiceChannel, user?.id],
  );

  const getActiveVoiceEngine = useCallback(async () => {
    if (voiceEngineRef?.current) {
      return voiceEngineRef.current;
    }

    if (previewEngineRef.current) {
      return previewEngineRef.current;
    }

    const { VoiceEngine } = await import("@/lib/voiceEngine");
    const engine = new VoiceEngine();
    await engine.init({
      userId: user?.id,
      preferences: loadVoicePreferences(user?.id, { isDesktop }),
    });
    previewEngineRef.current = engine;
    return engine;
  }, [isDesktop, user?.id, voiceEngineRef]);

  useEffect(() => {
    if (!open) return undefined;

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
  }, [getActiveVoiceEngine, open]);

  useEffect(() => () => {
    if (previewEngineRef.current) {
      void previewEngineRef.current.disconnect();
      previewEngineRef.current = null;
    }
  }, []);

  const saveAccount = async () => {
    setSavingAccount(true);
    try {
      const res = await api.put("/users/me", {
        display_name: displayName,
        avatar_url: avatarUrl,
        status,
      });
      onUserUpdated?.(res.data);
      toast.success(t("settings.accountUpdated"));
    } catch (err) {
      toast.error(formatError(err?.response?.data?.detail));
    } finally {
      setSavingAccount(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get("/users/me/export");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `singravox-export-${user?.username}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("settings.exportSuccess"));
    } catch (err) {
      toast.error(formatError(err?.response?.data?.detail));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete !== user?.username) {
      toast.error(t("settings.usernameMismatch"));
      return;
    }

    setDeleting(true);
    try {
      await api.delete("/users/me");
      toast.success(t("settings.accountDeleted"));
      onClose?.();
      setTimeout(() => onLogout?.(), 600);
    } catch (err) {
      toast.error(formatError(err?.response?.data?.detail));
    } finally {
      setDeleting(false);
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t("auth.passwordMinLengthError"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("auth.passwordsDoNotMatch"));
      return;
    }

    setChangingPassword(true);
    try {
      await api.put("/users/me/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("settings.passwordChanged"));
    } catch (err) {
      toast.error(formatError(err?.response?.data?.detail));
    } finally {
      setChangingPassword(false);
    }
  };

  const toggleMicTest = async (enabled) => {
    try {
      const nextPreferences = saveVoicePreferences(
        user?.id,
        { micTestEnabled: enabled },
        { isDesktop },
      );
      setVoicePreferences(nextPreferences);
      const engine = await getActiveVoiceEngine();
      micTestEngineRef.current = engine;
      await engine.setPreferences(nextPreferences);
      if (enabled) {
        await engine.startMicTest();
      } else {
        await engine.stopMicTest();
      }
    } catch (err) {
      toast.error(formatError(err?.response?.data?.detail || err?.message));
    }
  };

  return (
    <SettingsOverlayShell
      open={open}
      title={t("settings.userSettingsTitle")}
      sections={sectionConfig}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onClose={onClose}
    >
      {activeSection === "voice" && (
        <div className="space-y-8" data-testid="voice-settings-panel">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <div className="mb-4">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.voiceVideo")}</h3>
              <p className="mt-1 text-sm text-[#71717A]">{t("settings.voiceVideoDescription")}</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.inputDevice")}</Label>
                <select
                  value={voicePreferences.inputDeviceId || ""}
                  onChange={(event) => updateVoicePreferences({ inputDeviceId: event.target.value })}
                  className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white"
                >
                  <option value="">{t("settings.defaultMicrophone")}</option>
                  {audioInputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.outputDevice")}</Label>
                <select
                  value={voicePreferences.outputDeviceId || ""}
                  onChange={(event) => updateVoicePreferences({ outputDeviceId: event.target.value })}
                  disabled={!supportOutputDeviceSelection()}
                  className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
                >
                  <option value="">{t("settings.defaultOutput")}</option>
                  {audioOutputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Output ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                {!supportOutputDeviceSelection() && (
                  <p className="text-xs text-[#71717A]">{t("settings.outputDeviceUnsupported")}</p>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.inputVolume")}</Label>
                  <span className="text-xs text-[#A1A1AA]">{voicePreferences.inputVolume}%</span>
                </div>
                <Slider
                  value={[voicePreferences.inputVolume]}
                  min={0}
                  max={200}
                  step={5}
                  onValueChange={([value]) => updateVoicePreferences({ inputVolume: value })}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.outputVolume")}</Label>
                  <span className="text-xs text-[#A1A1AA]">{voicePreferences.outputVolume}%</span>
                </div>
                <Slider
                  value={[voicePreferences.outputVolume]}
                  min={0}
                  max={200}
                  step={5}
                  onValueChange={([value]) => updateVoicePreferences({ outputVolume: value })}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <div className="mb-4">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.pushToTalkAndAudioProcessing")}</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
                <div className="flex items-center justify-between">
                  <div>
                      <p className="text-sm font-medium text-white">{t("settings.pushToTalk")}</p>
                      <p className="text-xs text-[#71717A]">
                        {isDesktop
                          ? t("settings.pushToTalkDesktopHelp")
                          : t("settings.pushToTalkWebDisabled")}
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
                  className="mt-4 w-full border-[#27272A] bg-[#121212] text-white hover:bg-[#1A1A1A] disabled:opacity-50"
                  onClick={() => isDesktop && setPttListening(true)}
                  disabled={!isDesktop}
                >
                  <Keyboard size={14} className="mr-2" />
                  {pttListening ? t("settings.pressAnyKey") : t("settings.keyLabel", { key: voicePreferences.pttKey })}
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
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

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <div className="mb-4 flex items-center gap-2">
              <Microphone size={18} className="text-[#6366F1]" />
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.micTestAndSensitivity")}</h3>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5 rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">{t("settings.micTest")}</p>
                    <p className="mt-1 text-xs text-[#71717A]">
                      {t("settings.micTestDescription")}
                    </p>
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
                      className={`h-full rounded-full transition-all ${inputAboveThreshold ? "bg-[#22C55E]" : "bg-[#6366F1]"}`}
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
                    {voicePreferences.autoInputSensitivity
                      ? t("settings.autoSensitivityHelp")
                      : t("settings.manualSensitivityHelp")}
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
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
                    min={0}
                    max={100}
                    step={1}
                    disabled={voicePreferences.autoInputSensitivity}
                    onValueChange={([value]) => updateVoicePreferences({ inputSensitivity: value })}
                  />
                  <p className="text-xs text-[#71717A]">
                    {t("settings.inputSensitivityDescription")}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeSection === "account" && (
        <div className="space-y-6" data-testid="account-settings-panel">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.profile")}</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("auth.displayName")}</Label>
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.avatarUrl")}</Label>
                <Input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.status")}</Label>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white">
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button onClick={saveAccount} disabled={savingAccount} className="mt-5 bg-[#6366F1] hover:bg-[#4F46E5]">
              <GearSix size={14} className="mr-2" />
              {savingAccount ? t("settings.saving") : t("settings.saveProfile")}
            </Button>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.password")}</h3>
            <p className="mt-1 text-sm text-[#71717A]">
              {t("settings.passwordHelp")}
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("auth.currentPassword")}</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("auth.newPassword")}</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("auth.confirmPassword")}</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
              </div>
            </div>
            <Button onClick={changePassword} disabled={changingPassword} className="mt-5 bg-[#6366F1] hover:bg-[#4F46E5]">
              {changingPassword ? t("settings.changingPassword") : t("settings.changePassword")}
            </Button>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.language")}</h3>
            <div className="mt-5 space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.language")}</Label>
              <select
                value={i18n.language}
                onChange={(event) => { void i18n.changeLanguage(event.target.value); }}
                className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white"
              >
                {SUPPORTED_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {t(language.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      )}

      {activeSection === "privacy" && (
        <div className="space-y-6" data-testid="privacy-settings-panel">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <div className="flex items-start gap-3">
              <Export size={20} className="mt-0.5 text-[#6366F1]" />
              <div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.exportData")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">{t("settings.exportDescription")}</p>
                <Button onClick={handleExport} disabled={exporting} className="mt-4 bg-[#6366F1] hover:bg-[#4F46E5]">
                  {exporting ? t("settings.exporting") : t("settings.downloadExport")}
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[#EF4444]/20 bg-[#121212] p-5">
            <div className="flex items-start gap-3">
              <Trash size={20} className="mt-0.5 text-[#EF4444]" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-[#EF4444]" style={{ fontFamily: "Manrope" }}>{t("settings.deleteAccount")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">{t("settings.deleteDescription")}</p>
                <Input
                  value={confirmDelete}
                  onChange={(event) => setConfirmDelete(event.target.value)}
                  placeholder={user?.username || t("auth.usernamePlaceholder")}
                  className="mt-4 bg-[#0A0A0A] border-[#27272A] text-white"
                />
                <Button
                  onClick={handleDelete}
                  disabled={deleting || confirmDelete !== user?.username}
                  className="mt-4 bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40"
                >
                  {deleting ? t("settings.deleting") : t("settings.deletePermanently")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </SettingsOverlayShell>
  );
}
