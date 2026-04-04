import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DesktopTower,
  Export,
  GearSix,
  Keyboard,
  Microphone,
  Plus,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  SpeakerHigh,
  Trash,
  UserCircle,
  VideoCamera,
  WifiHigh,
  X as PhosphorX,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import SettingsOverlayShell from "@/components/settings/SettingsOverlayShell";
import E2EEStatus from "@/components/security/E2EEStatus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { loadVoicePreferences, saveVoicePreferences } from "@/lib/voicePreferences";
import { capturePttShortcut, describePttShortcut } from "@/lib/pttShortcut";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import {
  getSavedInstances,
  saveInstance,
  removeInstance,
  getInstancePassword,
  getActiveInstanceUrl,
  markInstanceUsed,
  toggleInstanceFavorite,
  sortedInstances,
} from "@/lib/instanceManager";

const SECTION_CONFIG = [
  { id: "voice",     icon: <SlidersHorizontal size={16} /> },
  { id: "account",   icon: <UserCircle size={16} /> },
  { id: "privacy",   icon: <ShieldCheck size={16} /> },
  { id: "instances", icon: <DesktopTower size={16} /> },
];
const AVATAR_OUTPUT_SIZE = 512;
const SETTINGS_INPUT_CLASSNAME =
  "h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus-visible:border-cyan-400/40 focus-visible:ring-cyan-400/20";
const SETTINGS_NATIVE_SELECT_CLASSNAME =
  "h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/75 px-4 text-sm text-white outline-none transition focus:border-cyan-400/40 focus:bg-zinc-950/85 disabled:opacity-50";
const SETTINGS_DANGER_INPUT_CLASSNAME =
  "mt-4 h-12 rounded-2xl border-red-500/20 bg-zinc-950/80 text-white placeholder:text-zinc-500 focus-visible:border-red-400/45 focus-visible:ring-red-400/20";

function supportOutputDeviceSelection() {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("avatar-read-failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("avatar-image-load-failed"));
    image.src = source;
  });
}

async function renderAvatarBlob({
  source,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
}) {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("avatar-canvas-unavailable");
  }

  const baseScale = Math.max(
    AVATAR_OUTPUT_SIZE / image.width,
    AVATAR_OUTPUT_SIZE / image.height,
  );
  const drawWidth = image.width * baseScale * zoom;
  const drawHeight = image.height * baseScale * zoom;
  const translatedX = (offsetX / 100) * AVATAR_OUTPUT_SIZE * 0.35;
  const translatedY = (offsetY / 100) * AVATAR_OUTPUT_SIZE * 0.35;
  const drawX = (AVATAR_OUTPUT_SIZE - drawWidth) / 2 + translatedX;
  const drawY = (AVATAR_OUTPUT_SIZE - drawHeight) / 2 + translatedY;

  context.clearRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("avatar-blob-failed"));
        return;
      }
      resolve(blob);
    }, "image/png", 0.92);
  });
}

export default function GlobalSettingsOverlay({
  open,
  onClose,
  user,
  voiceEngineRef,
  channels,
  onUserUpdated,
  onLogout,
  pttDebug = null,
}) {
  const { t, i18n } = useTranslation();
  const { logoutAll, listSessions, revokeSession } = useAuth();
  const { config, connectToInstance } = useRuntime();
  const {
    loading: e2eeLoading,
    enabled: e2eeEnabled,
    devices: e2eeDevices,
    currentDevice,
    ready: e2eeReady,
    isDesktopCapable,
    initializeE2EE,
    restoreE2EE,
    approveDevice,
    revokeDevice,
    fingerprintPublicKey,
  } = useE2EE();
  const isDesktop = Boolean(config?.isDesktop);
  const previewEngineRef = useRef(null);
  const micTestEngineRef = useRef(null);
  const avatarInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState("voice");
  const [voicePreferences, setVoicePreferences] = useState(
    loadVoicePreferences(user?.id, { isDesktop }),
  );
  const [audioInputs, setAudioInputs] = useState([]);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [videoInputs, setVideoInputs] = useState([]);
  const [username, setUsername] = useState(user?.username || "");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url || "");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffsetX, setAvatarOffsetX] = useState(0);
  const [avatarOffsetY, setAvatarOffsetY] = useState(0);
  const [avatarPendingUpload, setAvatarPendingUpload] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarEditorSource, setAvatarEditorSource] = useState("");
  const [avatarEditorFileName, setAvatarEditorFileName] = useState("");
  const [avatarEditorZoom, setAvatarEditorZoom] = useState(1);
  const [avatarEditorOffsetX, setAvatarEditorOffsetX] = useState(0);
  const [avatarEditorOffsetY, setAvatarEditorOffsetY] = useState(0);
  const [status, setStatus] = useState(user?.status || "online"); // kept for status-bar sync only
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
  const [e2eeDeviceName, setE2eeDeviceName] = useState("Main desktop");
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [confirmRecoveryPassphrase, setConfirmRecoveryPassphrase] = useState("");
  const [e2eeSubmitting, setE2eeSubmitting] = useState(false);
  const [currentDeviceFingerprint, setCurrentDeviceFingerprint] = useState("");
  const [authSessions, setAuthSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionActionTarget, setSessionActionTarget] = useState("");

  // ── Instance-Switcher State ──────────────────────────────────────────────
  const [savedInstances, setSavedInstances] = useState(() => getSavedInstances());
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstanceUrl, setNewInstanceUrl]   = useState("");
  const [newInstanceEmail, setNewInstanceEmail]    = useState("");
  const [newInstancePassword, setNewInstancePassword] = useState("");
  const [addingInstance, setAddingInstance]   = useState(false);
  const [switchingInstance, setSwitchingInstance] = useState("");

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
    setUsername(user?.username || "");
    setDisplayName(user?.display_name || "");
    setAvatarPreview(user?.avatar_url || "");
    setAvatarFileName("");
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
    setAvatarPendingUpload(false);
    setAvatarEditorOpen(false);
    setAvatarEditorSource("");
    setAvatarEditorFileName("");
    setAvatarEditorZoom(1);
    setAvatarEditorOffsetX(0);
    setAvatarEditorOffsetY(0);
    setStatus(user?.status || "online");
  }, [isDesktop, user]);

  useEffect(() => {
    if (!user) return;
    const preferredName = user.display_name ? `${user.display_name}'s desktop` : "Main desktop";
    setE2eeDeviceName(preferredName);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentDevice?.public_key) {
        setCurrentDeviceFingerprint("");
        return;
      }
      const fingerprint = await fingerprintPublicKey(currentDevice.public_key);
      if (!cancelled) {
        setCurrentDeviceFingerprint(fingerprint);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDevice?.public_key, fingerprintPublicKey]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
        setAudioOutputs(devices.filter((device) => device.kind === "audiooutput"));
        setVideoInputs(devices.filter((device) => device.kind === "videoinput"));
      } catch {
        if (!cancelled) {
          setAudioInputs([]);
          setAudioOutputs([]);
          setVideoInputs([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadAuthSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const sessions = await listSessions();
      setAuthSessions(Array.isArray(sessions) ? sessions : []);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "settings.sessionsLoadFailed" }));
      setAuthSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [listSessions, t]);

  useEffect(() => {
    if (!open || activeSection !== "account") {
      return;
    }
    void loadAuthSessions();
  }, [activeSection, loadAuthSessions, open]);

  const handleRevokeSession = useCallback(async (sessionId) => {
    if (!sessionId) {
      return;
    }
    setSessionActionTarget(sessionId);
    try {
      await revokeSession(sessionId);
      toast.success(t("settings.sessionRevoked"));
      await loadAuthSessions();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "settings.sessionRevokeFailed" }));
    } finally {
      setSessionActionTarget("");
    }
  }, [loadAuthSessions, revokeSession, t]);

  const handleLogoutAllSessions = useCallback(async () => {
    setSessionActionTarget("__all__");
    try {
      await logoutAll();
      toast.success(t("settings.loggedOutEverywhere"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "settings.logoutAllFailed" }));
    } finally {
      setSessionActionTarget("");
    }
  }, [logoutAll, t]);

  useEffect(() => {
    if (!isDesktop) {
      setPttListening(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!pttListening) return;
    const handler = (event) => {
      const capturedShortcut = capturePttShortcut(event);
      if (!capturedShortcut) {
        return;
      }
      event.preventDefault();
      updateVoicePreferences({
        pttKey: capturedShortcut.accelerator,
        pttLabel: capturedShortcut.label,
        pttEnabled: true,
      });
      setPttListening(false);
      toast.success(t("settings.pttKeySet", { key: capturedShortcut.label }));
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
    { ...SECTION_CONFIG[3], label: "Instanzen" },
  ]), [t]);

  const statusOptions = useMemo(() => ([
    { value: "online", label: t("settings.statusOnline") },
    { value: "away", label: t("settings.statusAway") },
    { value: "dnd", label: t("settings.statusDnd") },
    { value: "offline", label: t("settings.statusInvisible") },
  ]), [t]);

  const accountDisplayName = displayName.trim() || username || user?.display_name || user?.username || t("common.unknown");
  const avatarInitial = (accountDisplayName?.[0] || "?").toUpperCase();
  const hasAvatarPreview = Boolean(avatarPreview);

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

  const handleAvatarSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.avatarOnlyImages"));
      event.target.value = "";
      return;
    }

    try {
      const preview = await readFileAsDataUrl(file);
      setAvatarEditorSource(preview);
      setAvatarEditorFileName(file.name);
      setAvatarEditorZoom(1);
      setAvatarEditorOffsetX(0);
      setAvatarEditorOffsetY(0);
      setAvatarEditorOpen(true);
    } catch {
      toast.error(t("settings.avatarReadFailed"));
    } finally {
      event.target.value = "";
    }
  };

  const applyAvatarEditor = () => {
    if (!avatarEditorSource) {
      setAvatarEditorOpen(false);
      return;
    }

    setAvatarPreview(avatarEditorSource);
    setAvatarFileName(avatarEditorFileName);
    setAvatarZoom(avatarEditorZoom);
    setAvatarOffsetX(avatarEditorOffsetX);
    setAvatarOffsetY(avatarEditorOffsetY);
    setAvatarPendingUpload(true);
    setAvatarEditorOpen(false);
  };

  const openAvatarPicker = () => {
    avatarInputRef.current?.click();
  };

  const saveAccount = async () => {
    const normalizedUsername = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
    if (normalizedUsername.length < 3) {
      toast.error(t("settings.usernameInvalid"));
      return;
    }

    setSavingAccount(true);
    try {
      let nextAvatarUrl = avatarPreview || "";
      if (avatarPendingUpload && avatarPreview) {
        const avatarBlob = await renderAvatarBlob({
          source: avatarPreview,
          zoom: avatarZoom,
          offsetX: avatarOffsetX,
          offsetY: avatarOffsetY,
        });
        const dataUrl = await readFileAsDataUrl(avatarBlob);
        const uploadResponse = await api.post("/upload", {
          data: dataUrl.split(",")[1],
          name: avatarFileName || `avatar-${user?.id || "profile"}.png`,
          type: avatarBlob.type || "image/png",
        });
        nextAvatarUrl = uploadResponse.data.url;
      }

      const res = await api.put("/users/me", {
        username: normalizedUsername,
        display_name: displayName,
        avatar_url: nextAvatarUrl,
      });
      onUserUpdated?.(res.data);
      setUsername(res.data.username || normalizedUsername);
      setDisplayName(res.data.display_name || displayName);
      setAvatarPreview(res.data.avatar_url || "");
      setAvatarFileName("");
      setAvatarZoom(1);
      setAvatarOffsetX(0);
      setAvatarOffsetY(0);
      setAvatarPendingUpload(false);
      toast.success(t("settings.accountUpdated"));
    } catch (err) {
      if (String(err?.message || "").startsWith("avatar-")) {
        toast.error(t("settings.avatarProcessFailed"));
      } else {
        toast.error(formatAppError(t, err, { fallbackKey: "settings.accountUpdateFailed" }));
      }
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
      toast.error(formatAppError(t, err, { fallbackKey: "settings.exportFailed" }));
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
      toast.error(formatAppError(t, err, { fallbackKey: "settings.accountDeleteFailed" }));
    } finally {
      setDeleting(false);
    }
  };

  const handleInitializeE2EE = async () => {
    if (recoveryPassphrase.length < 12) {
      toast.error(t("errors.recoveryPassphraseTooShort"));
      return;
    }
    if (recoveryPassphrase !== confirmRecoveryPassphrase) {
      toast.error(t("errors.recoveryPassphraseMismatch"));
      return;
    }
    setE2eeSubmitting(true);
    try {
      await initializeE2EE({
        passphrase: recoveryPassphrase,
        deviceName: e2eeDeviceName.trim() || "Main desktop",
      });
      setRecoveryPassphrase("");
      setConfirmRecoveryPassphrase("");
      toast.success(t("settings.e2eeInitialized"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.unknown" }));
    } finally {
      setE2eeSubmitting(false);
    }
  };

  const handleRestoreE2EE = async () => {
    if (!recoveryPassphrase) {
      toast.error(t("errors.recoveryPassphraseRequired"));
      return;
    }
    setE2eeSubmitting(true);
    try {
      await restoreE2EE({
        passphrase: recoveryPassphrase,
        deviceName: e2eeDeviceName.trim() || "Recovered desktop",
      });
      setRecoveryPassphrase("");
      setConfirmRecoveryPassphrase("");
      toast.success(t("settings.e2eeRestored"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.unknown" }));
    } finally {
      setE2eeSubmitting(false);
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
      toast.error(formatAppError(t, err, { fallbackKey: "settings.passwordChangeFailed" }));
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
      toast.error(formatAppError(t, err, { fallbackKey: "settings.micTestToggleFailed" }));
    }
  };

  return (
    <>
      <SettingsOverlayShell
        open={open}
        title={t("settings.userSettingsTitle")}
        sections={sectionConfig}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onClose={onClose}
        footerActions={[
          {
            id: "logout",
            label: t("settings.logoutAction"),
            icon: <SignOut size={16} />,
            tone: "danger",
            onClick: () => {
              onClose?.();
              onLogout?.();
            },
            testId: "settings-logout-button",
          },
        ]}
      >
      {activeSection === "voice" && (
        <div className="space-y-8" data-testid="voice-settings-panel">
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
                  onChange={(event) => updateVoicePreferences({ inputDeviceId: event.target.value })}
                  className={SETTINGS_NATIVE_SELECT_CLASSNAME}
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
                  className={SETTINGS_NATIVE_SELECT_CLASSNAME}
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

            <div className="mt-5 space-y-2">
              <div className="flex items-center gap-2">
                <VideoCamera size={16} className="text-[#71717A]" />
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.cameraDevice")}</Label>
              </div>
              <select
                value={voicePreferences.cameraDeviceId || ""}
                onChange={(event) => updateVoicePreferences({ cameraDeviceId: event.target.value })}
                className={SETTINGS_NATIVE_SELECT_CLASSNAME}
              >
                <option value="">{t("settings.defaultCamera")}</option>
                {videoInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
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
                    <p>{t("settings.pttLastEvent", { event: pttDebug?.lastEventState || "—" })}</p>
                    <p>{t("settings.pttLastShortcut", { key: pttDebug?.lastShortcut || voicePreferences.pttKey || "—" })}</p>
                    <p>{t("settings.pttMicGate", { state: pttDebug?.active ? t("settings.pttMicOpen") : t("settings.pttMicClosed") })}</p>
                    {pttDebug?.error ? (
                      <p className="text-[#FCA5A5]">{t("settings.pttRegistrationError", { error: pttDebug.error })}</p>
                    ) : null}
                  </div>
                )}
                {isDesktop && (
                  <p className="mt-3 text-xs text-[#71717A]">
                    {t("settings.pttSystemWarning")}
                  </p>
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
                    {voicePreferences.autoInputSensitivity
                      ? t("settings.autoSensitivityHelp")
                      : t("settings.manualSensitivityHelp")}
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
        <div className="space-y-5" data-testid="account-settings-panel">
          {/* ── Profile card ─────────────────────────────────────────── */}
          <section className="workspace-card overflow-hidden p-0">
            {/* Banner */}
            <div className="h-24 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.35),transparent_40%),linear-gradient(120deg,rgba(15,23,42,0.95),rgba(9,9,11,0.75))]" />

            {/* Avatar + name row */}
            <div className="flex items-end gap-4 px-6 -mt-10 pb-4">
              <button
                type="button"
                onClick={openAvatarPicker}
                data-testid="avatar-upload-btn"
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-zinc-900 bg-zinc-900 shadow-lg transition hover:border-cyan-400/50"
              >
                {hasAvatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={accountDisplayName}
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{
                      transform: `translate(${avatarOffsetX * 0.3}px, ${avatarOffsetY * 0.3}px) scale(${avatarZoom})`,
                      transformOrigin: "center",
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-400 to-cyan-600 text-3xl font-bold text-zinc-950">
                    {avatarInitial}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <UserCircle size={22} className="text-white" />
                </div>
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelected} />

              <div className="flex-1 pb-1">
                <h3 className="text-xl font-bold text-white" style={{ fontFamily: "Manrope" }}>
                  {accountDisplayName}
                </h3>
                <p className="text-sm text-zinc-500">{user?.email}</p>
                {avatarPendingUpload && (
                  <p className="mt-1 text-xs text-cyan-400">{t("settings.avatarReady")}</p>
                )}
              </div>
            </div>

            {/* Form */}
            <div className="space-y-5 border-t border-white/8 px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">{t("auth.username")}</Label>
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    className={SETTINGS_INPUT_CLASSNAME}
                    data-testid="settings-username-input"
                  />
                  <p className="text-xs text-zinc-500">{t("settings.usernameHelp")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">{t("auth.displayName")}</Label>
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className={SETTINGS_INPUT_CLASSNAME}
                    data-testid="settings-displayname-input"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={saveAccount}
                  disabled={savingAccount}
                  data-testid="save-profile-btn"
                  className="rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300"
                >
                  <GearSix size={14} className="mr-2" />
                  {savingAccount ? t("settings.saving") : t("settings.saveProfile")}
                </Button>
                <p className="text-xs text-zinc-600">{t("settings.statusChangeHint", { defaultValue: "Status änderst du direkt im Statusbereich unten links." })}</p>
              </div>
            </div>
          </section>

          <section className="workspace-card p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.password")}</h3>
            <p className="mt-1 text-sm leading-6 text-[#71717A]">
              {t("settings.passwordHelp")}
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label className="workspace-section-label">{t("auth.currentPassword")}</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={SETTINGS_INPUT_CLASSNAME}
                />
              </div>
              <div className="space-y-2">
                <Label className="workspace-section-label">{t("auth.newPassword")}</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={SETTINGS_INPUT_CLASSNAME}
                />
              </div>
              <div className="space-y-2">
                <Label className="workspace-section-label">{t("auth.confirmPassword")}</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={SETTINGS_INPUT_CLASSNAME}
                />
              </div>
            </div>
            <Button onClick={changePassword} disabled={changingPassword} className="mt-5 rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300">
              {changingPassword ? t("settings.changingPassword") : t("settings.changePassword")}
            </Button>
          </section>

          <div className="grid gap-6">
            <section className="workspace-card p-5">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.language")}</h3>
              <div className="mt-5 space-y-2">
                <Label className="workspace-section-label">{t("settings.language")}</Label>
                <Select value={i18n.language} onValueChange={(value) => { void i18n.changeLanguage(value); }}>
                  <SelectTrigger className={SETTINGS_INPUT_CLASSNAME}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {t(language.labelKey)}
                    </SelectItem>
                  ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="workspace-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                    {t("settings.sessionsTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">{t("settings.sessionsDescription")}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadAuthSessions()}
                    disabled={loadingSessions}
                    className="rounded-2xl border-white/10 bg-zinc-950/60 text-white hover:bg-white/8"
                  >
                    {t("common.refresh")}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleLogoutAllSessions()}
                    disabled={sessionActionTarget === "__all__"}
                    className="rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300"
                  >
                    {sessionActionTarget === "__all__" ? t("settings.loggingOutEverywhere") : t("settings.logoutAllAction")}
                  </Button>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {loadingSessions && (
                  <p className="text-sm text-zinc-500">{t("settings.loadingSessions")}</p>
                )}
                {!loadingSessions && authSessions.length === 0 && (
                  <p className="rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-500">
                    {t("settings.noSessions")}
                  </p>
                )}
                {!loadingSessions && authSessions.map((session) => (
                  <div
                    key={session.session_id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-white">
                        {t(`settings.sessionPlatform.${session.platform || "web"}`, {
                          defaultValue: session.platform || "web",
                        })}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {t("settings.sessionIssuedAt", {
                          value: new Date(session.issued_at).toLocaleString(),
                        })}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t("settings.sessionLastSeen", {
                          value: new Date(session.last_seen_at || session.issued_at).toLocaleString(),
                        })}
                      </p>
                      {session.user_agent ? (
                        <p className="max-w-[440px] text-xs text-zinc-500">{session.user_agent}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleRevokeSession(session.session_id)}
                      disabled={sessionActionTarget === session.session_id}
                      className="rounded-2xl border-red-500/20 bg-transparent text-red-300 hover:bg-red-500/10"
                    >
                      {sessionActionTarget === session.session_id ? t("settings.revokingSession") : t("settings.revokeSession")}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeSection === "privacy" && (
        <div className="space-y-6" data-testid="privacy-settings-panel">
          <section className="workspace-card p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="mt-0.5 text-[#22C55E]" />
              <div className="flex-1">
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.e2eeSectionTitle")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">{t("e2ee.title")}</p>

                {!isDesktopCapable && !e2eeEnabled && (
                  <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-200">
                    Schlüssel werden im Browser gespeichert (weniger sicher als Desktop). Nur zum Testen empfohlen.
                  </div>
                )}

                {!e2eeEnabled && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.e2eeDeviceName")}</Label>
                      <Input value={e2eeDeviceName} onChange={(event) => setE2eeDeviceName(event.target.value)} className="h-12 rounded-2xl border-white/10 bg-zinc-950/75 text-white" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.recoveryPassphrase")}</Label>
                      <Input type="password" value={recoveryPassphrase} onChange={(event) => setRecoveryPassphrase(event.target.value)} className="h-12 rounded-2xl border-white/10 bg-zinc-950/75 text-white" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("settings.recoveryPassphraseConfirm")}</Label>
                      <Input type="password" value={confirmRecoveryPassphrase} onChange={(event) => setConfirmRecoveryPassphrase(event.target.value)} className="h-12 rounded-2xl border-white/10 bg-zinc-950/75 text-white" />
                    </div>
                    <div className="md:col-span-2 flex flex-wrap gap-3">
                      <Button onClick={handleInitializeE2EE} disabled={e2eeSubmitting} className="rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300">
                        {e2eeSubmitting ? t("settings.e2eeConfiguring") : t("settings.e2eeEnableDesktop")}
                      </Button>
                      <Button type="button" variant="outline" onClick={handleRestoreE2EE} disabled={e2eeSubmitting} className="rounded-2xl border-white/10 bg-zinc-950/60 text-white hover:bg-white/8">
                        {t("settings.e2eeRestoreAction")}
                      </Button>
                    </div>
                  </div>
                )}

                {e2eeEnabled && (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-3xl border border-white/10 bg-zinc-950/60 px-4 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-white">{currentDevice?.device_name || e2eeDeviceName}</p>
                          <p className="mt-1 text-xs text-[#71717A]">
                            {e2eeReady ? t("settings.e2eeDeviceVerified") : t("settings.e2eeDevicePending")}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${e2eeReady ? "bg-[#14532D] text-[#86EFAC]" : "bg-[#3F3F46] text-[#E4E4E7]"}`}>
                          {e2eeReady ? t("common.ready") : t("common.pending")}
                        </span>
                      </div>
                      {currentDeviceFingerprint && (
                        <p className="mt-3 rounded-2xl border border-white/10 bg-zinc-950/75 px-3 py-2 text-xs tracking-[0.18em] text-[#A1A1AA]">
                          {currentDeviceFingerprint}
                        </p>
                      )}
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-zinc-950/60 px-4 py-4">
                      <h4 className="text-sm font-semibold text-white">{t("settings.trustedDevices")}</h4>
                      <div className="mt-3 space-y-3">
                        {e2eeLoading && (
                          <p className="text-sm text-[#71717A]">{t("settings.loadingTrustedDevices")}</p>
                        )}
                        {!e2eeLoading && e2eeDevices.map((device) => (
                          <div key={device.device_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/75 px-3 py-3">
                            <div>
                              <p className="text-sm font-medium text-white">{device.device_name}</p>
                              <p className="mt-1 text-xs text-[#71717A]">
                                {device.verified_at
                                  ? t("settings.deviceVerifiedAt", { value: new Date(device.verified_at).toLocaleString() })
                                  : t("settings.deviceAwaitingApproval")}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {!device.verified_at && (
                                <Button type="button" size="sm" onClick={() => approveDevice(device.device_id)} className="rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300">
                                  {t("settings.approveDevice")}
                                </Button>
                              )}
                              {currentDevice?.device_id !== device.device_id && !device.revoked_at && (
                                <Button type="button" size="sm" variant="outline" onClick={() => revokeDevice(device.device_id)} className="border-[#EF4444]/30 bg-transparent text-[#FCA5A5] hover:bg-[#450A0A]">
                                  {t("settings.revokeDevice")}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="workspace-card p-5">
            <div className="flex items-start gap-3">
              <Export size={20} className="mt-0.5 text-cyan-300" />
              <div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.exportData")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">{t("settings.exportDescription")}</p>
                <Button onClick={handleExport} disabled={exporting} className="mt-4 rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300">
                  {exporting ? t("settings.exporting") : t("settings.downloadExport")}
                </Button>
              </div>
            </div>
          </section>

          <section className="workspace-card border-red-500/15 bg-[linear-gradient(180deg,rgba(127,29,29,0.12),rgba(9,9,11,0.72))] p-5">
            <div className="flex items-start gap-3">
              <Trash size={20} className="mt-0.5 text-red-400" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-300" style={{ fontFamily: "Manrope" }}>{t("settings.deleteAccount")}</h3>
                <p className="mt-1 text-sm text-zinc-400">{t("settings.deleteDescription")}</p>
                <Input
                  value={confirmDelete}
                  onChange={(event) => setConfirmDelete(event.target.value)}
                  placeholder={user?.username || t("auth.usernamePlaceholder")}
                  className={SETTINGS_DANGER_INPUT_CLASSNAME}
                />
                <Button
                  onClick={handleDelete}
                  disabled={deleting || confirmDelete !== user?.username}
                  className="mt-4 rounded-2xl bg-red-500 text-white hover:bg-red-400 disabled:opacity-40"
                >
                  {deleting ? t("settings.deleting") : t("settings.deletePermanently")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Instance-Switcher Tab ───────────────────────────────────────── */}
      {activeSection === "instances" && (
        <div className="space-y-6" data-testid="instances-settings-panel">
          {/* Aktive Instanz */}
          <section className="workspace-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <WifiHigh size={18} className="text-cyan-400" />
              <div>
                <h3 className="text-base font-bold" style={{ fontFamily: "Manrope" }}>Aktive Verbindung</h3>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{getActiveInstanceUrl() || window.location.origin}</p>
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Verbunden
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/8 text-xs"
              onClick={() => {
                const url = getActiveInstanceUrl() || window.location.origin;
                const name = url.replace(/^https?:\/\//, "").split("/")[0];
                setSavedInstances(saveInstance({ name, url }));
                toast.success("Instanz gespeichert");
              }}
              data-testid="save-current-instance-btn"
            >
              <Plus size={13} className="mr-1.5" />
              Zu gespeicherten Instanzen hinzufügen
            </Button>
          </section>

          {/* Gespeicherte Instanzen */}
          <section className="workspace-card p-5">
            <h3 className="text-base font-bold mb-1" style={{ fontFamily: "Manrope" }}>Gespeicherte Instanzen</h3>
            <p className="text-xs text-zinc-500 mb-4">Klick auf &ldquo;Verbinden&rdquo; um schnell zu wechseln. Auto-Login wenn E-Mail + Passwort gespeichert.</p>
            {savedInstances.length === 0 && (
              <p className="text-sm text-zinc-600 py-4 text-center">Noch keine Instanzen gespeichert.</p>
            )}
            <div className="space-y-2">
              {sortedInstances(savedInstances).map((inst) => {
                const activeUrl = getActiveInstanceUrl() || window.location.origin;
                const isActive = inst.url === activeUrl || inst.url === activeUrl.replace(/\/+$/, "");
                return (
                  <div
                    key={inst.id}
                    className="flex items-center gap-3 rounded-xl px-4 py-3"
                    style={{
                      background: isActive ? "rgba(34,211,238,0.07)" : inst.isFavorite ? "rgba(251,191,36,0.04)" : "rgba(255,255,255,0.03)",
                      border: isActive ? "1px solid rgba(34,211,238,0.2)" : inst.isFavorite ? "1px solid rgba(251,191,36,0.15)" : "1px solid rgba(255,255,255,0.06)",
                    }}
                    data-testid={`instance-item-${inst.id}`}
                  >
                    {/* Favoriten-Stern */}
                    <button
                      onClick={() => setSavedInstances(toggleInstanceFavorite(inst.id))}
                      className="shrink-0 transition-colors"
                      title={inst.isFavorite ? "Aus Favoriten entfernen" : "Als Favorit markieren"}
                      data-testid={`instance-star-btn-${inst.id}`}
                    >
                      <Plus
                        size={14}
                        weight={inst.isFavorite ? "fill" : "regular"}
                        className={inst.isFavorite ? "text-yellow-400" : "text-zinc-600 hover:text-yellow-400"}
                        style={{ transform: "rotate(45deg)" }}
                      />
                    </button>
                    <DesktopTower size={15} className={isActive ? "text-cyan-400" : "text-zinc-500"} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{inst.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{inst.url}</p>
                      {inst.email && <p className="text-xs text-zinc-600 truncate">{inst.email}</p>}
                      {inst.lastUsedAt && (
                        <p className="text-xs text-zinc-700 truncate">
                          Zuletzt: {new Date(inst.lastUsedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                    {isActive ? (
                      <span className="text-xs text-cyan-400 font-medium shrink-0 px-2">Aktiv</span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={switchingInstance === inst.id}
                        className="rounded-xl bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 text-xs px-3 h-8 shrink-0"
                        onClick={async () => {
                          setSwitchingInstance(inst.id);
                          try {
                            await connectToInstance(inst.url);
                            setSavedInstances(markInstanceUsed(inst.id));
                            const pw = getInstancePassword(inst);
                            if (inst.email && pw) {
                              try {
                                const res = await fetch(`${inst.url}/api/auth/login`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ email: inst.email, password: pw }),
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data?.access_token) {
                                    window.localStorage.setItem("singravox.autoloading", JSON.stringify({ accessToken: data.access_token, refreshToken: data.refresh_token || "" }));
                                  }
                                }
                              } catch { /* Auto-Login fehlgeschlagen */ }
                            }
                            toast.success(`Verbunden mit ${inst.name}`);
                            setTimeout(() => window.location.reload(), 500);
                          } catch {
                            toast.error("Verbindung fehlgeschlagen");
                          } finally {
                            setSwitchingInstance("");
                          }
                        }}
                        data-testid={`instance-connect-btn-${inst.id}`}
                      >
                        {switchingInstance === inst.id ? "Verbinde…" : "Verbinden"}
                      </Button>
                    )}
                    <button
                      className="rounded-lg p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                      onClick={() => setSavedInstances(removeInstance(inst.id))}
                      data-testid={`instance-remove-btn-${inst.id}`}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Neue Instanz hinzufügen */}
          <section className="workspace-card p-5">
            <h3 className="text-base font-bold mb-1" style={{ fontFamily: "Manrope" }}>Instanz hinzufügen</h3>
            <p className="text-xs text-zinc-500 mb-4">Trage eine neue Server-URL ein. E-Mail und Passwort sind optional (für Auto-Login).</p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">Name</Label>
                  <Input value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="Mein Server" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-name-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">Server-URL</Label>
                  <Input value={newInstanceUrl} onChange={(e) => setNewInstanceUrl(e.target.value)} placeholder="https://singravox.example.com" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-url-input" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">E-Mail (Auto-Login, optional)</Label>
                  <Input type="email" value={newInstanceEmail} onChange={(e) => setNewInstanceEmail(e.target.value)} placeholder="user@example.com" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-email-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="workspace-section-label">Passwort (optional)</Label>
                  <Input type="password" value={newInstancePassword} onChange={(e) => setNewInstancePassword(e.target.value)} placeholder="Lokal gespeichert" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-password-input" />
                </div>
              </div>
              <Button
                disabled={!newInstanceUrl.trim()}
                className="rounded-xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300 text-sm"
                onClick={() => {
                  if (!newInstanceUrl.trim()) return;
                  setSavedInstances(saveInstance({
                    name: newInstanceName.trim() || newInstanceUrl.trim(),
                    url:  newInstanceUrl.trim(),
                    email: newInstanceEmail.trim(),
                    password: newInstancePassword,
                  }));
                  setNewInstanceName(""); setNewInstanceUrl("");
                  setNewInstanceEmail(""); setNewInstancePassword("");
                  toast.success("Instanz gespeichert");
                }}
                data-testid="add-instance-btn"
              >
                <Plus size={14} className="mr-1.5" />
                Hinzufügen
              </Button>
            </div>
          </section>
        </div>
      )}

      </SettingsOverlayShell>

      <Dialog open={avatarEditorOpen} onOpenChange={setAvatarEditorOpen}>
        <DialogContent className="workspace-panel-solid max-w-md text-white">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Manrope" }}>{t("settings.avatarEditorTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <p className="text-sm text-zinc-400">{t("settings.avatarEditorHelp")}</p>

            <div className="mx-auto w-full max-w-[280px]">
              <div className="relative aspect-square overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/80 shadow-[0_24px_50px_rgba(2,8,23,0.32)]">
                {avatarEditorSource ? (
                  <img
                    src={avatarEditorSource}
                    alt={t("settings.avatarUpload")}
                    className="absolute left-1/2 top-1/2 h-full w-full max-w-none object-cover"
                    style={{
                      transform: `translate(calc(-50% + ${avatarEditorOffsetX * 0.45}px), calc(-50% + ${avatarEditorOffsetY * 0.45}px)) scale(${avatarEditorZoom})`,
                      transformOrigin: "center center",
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cyan-400 to-cyan-600 text-6xl font-bold text-zinc-950">
                    {avatarInitial}
                  </div>
                )}
              </div>
            </div>

            {avatarEditorFileName ? (
              <p className="truncate text-center text-xs text-zinc-500">{avatarEditorFileName}</p>
            ) : null}

            <div className="space-y-4 rounded-3xl border border-white/10 bg-zinc-950/55 p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="workspace-section-label">{t("settings.avatarZoom")}</Label>
                  <span className="text-xs text-zinc-500">{Math.round(avatarEditorZoom * 100)}%</span>
                </div>
                <Slider
                  value={[Math.round(avatarEditorZoom * 100)]}
                  min={80}
                  max={180}
                  step={1}
                  onValueChange={([value]) => setAvatarEditorZoom(value / 100)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="workspace-section-label">{t("settings.avatarOffsetX")}</Label>
                    <span className="text-xs text-zinc-500">{avatarEditorOffsetX}</span>
                  </div>
                  <Slider
                    value={[avatarEditorOffsetX]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={([value]) => setAvatarEditorOffsetX(value)}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="workspace-section-label">{t("settings.avatarOffsetY")}</Label>
                    <span className="text-xs text-zinc-500">{avatarEditorOffsetY}</span>
                  </div>
                  <Slider
                    value={[avatarEditorOffsetY]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={([value]) => setAvatarEditorOffsetY(value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-2xl border-white/10 bg-transparent text-zinc-200 hover:bg-white/8" onClick={() => setAvatarEditorOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" className="rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300" onClick={applyAvatarEditor}>
                {t("settings.avatarApply")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
