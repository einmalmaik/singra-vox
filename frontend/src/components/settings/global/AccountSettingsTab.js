/*
 * Singra Vox – Account settings tab
 * Profile editing, avatar, password, language, sessions, export & delete.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Export,
  GearSix,
  Trash,
  UserCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useAuth } from "@/contexts/AuthContext";
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
import { SUPPORTED_LANGUAGES } from "@/i18n";
import {
  SETTINGS_INPUT_CLASSNAME,
  SETTINGS_DANGER_INPUT_CLASSNAME,
  readFileAsDataUrl,
  renderAvatarBlob,
} from "../settingsConstants";

export default function AccountSettingsTab({ user, onUserUpdated }) {
  const { t, i18n } = useTranslation();
  const { logoutAll, listSessions, revokeSession } = useAuth();

  const avatarInputRef = useRef(null);

  // Profile state
  const [username, setUsername] = useState(user?.username || "");
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url || "");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarOffsetX, setAvatarOffsetX] = useState(0);
  const [avatarOffsetY, setAvatarOffsetY] = useState(0);
  const [avatarPendingUpload, setAvatarPendingUpload] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  // Avatar editor dialog
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarEditorSource, setAvatarEditorSource] = useState("");
  const [avatarEditorFileName, setAvatarEditorFileName] = useState("");
  const [avatarEditorZoom, setAvatarEditorZoom] = useState(1);
  const [avatarEditorOffsetX, setAvatarEditorOffsetX] = useState(0);
  const [avatarEditorOffsetY, setAvatarEditorOffsetY] = useState(0);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Sessions
  const [authSessions, setAuthSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionActionTarget, setSessionActionTarget] = useState("");

  // Export & delete
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Sync from user prop
  useEffect(() => {
    setUsername(user?.username || "");
    setDisplayName(user?.display_name || "");
    setAvatarPreview(user?.avatar_url || "");
    setAvatarFileName("");
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
    setAvatarPendingUpload(false);
    setAvatarEditorOpen(false);
  }, [user]);

  // Load sessions on mount
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
    void loadAuthSessions();
  }, [loadAuthSessions]);

  const accountDisplayName =
    displayName.trim() || username || user?.display_name || user?.username || t("common.unknown");
  const avatarInitial = (accountDisplayName?.[0] || "?").toUpperCase();
  const hasAvatarPreview = Boolean(avatarPreview);

  // ── Avatar handlers ──
  const handleAvatarSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
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

  // ── Save profile ──
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

  // ── Password ──
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

  // ── Sessions ──
  const handleRevokeSession = useCallback(
    async (sessionId) => {
      if (!sessionId) return;
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
    },
    [loadAuthSessions, revokeSession, t],
  );

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

  // ── Export ──
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

  // ── Delete ──
  const handleDelete = async () => {
    if (confirmDelete !== user?.username) {
      toast.error(t("settings.usernameMismatch"));
      return;
    }
    setDeleting(true);
    try {
      await api.delete("/users/me");
      toast.success(t("settings.accountDeleted"));
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "settings.accountDeleteFailed" }));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="space-y-5" data-testid="account-settings-panel">
        {/* Profile card */}
        <section className="workspace-card overflow-hidden p-0">
          <div className="h-24 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.35),transparent_40%),linear-gradient(120deg,rgba(15,23,42,0.95),rgba(9,9,11,0.75))]" />
          <div className="flex items-end gap-4 px-6 -mt-10 pb-4">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
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

          <div className="space-y-5 border-t border-white/8 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("auth.username")}</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  className={SETTINGS_INPUT_CLASSNAME}
                  data-testid="settings-username-input"
                />
                <p className="text-xs text-zinc-500">{t("settings.usernameHelp")}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("auth.displayName")}</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
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
              <p className="text-xs text-zinc-600">
                {t("settings.statusChangeHint")}
              </p>
            </div>
          </div>
        </section>

        {/* Password */}
        <section className="workspace-card p-5">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.password")}</h3>
          <p className="mt-1 text-sm leading-6 text-[#71717A]">{t("settings.passwordHelp")}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="workspace-section-label">{t("auth.currentPassword")}</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={SETTINGS_INPUT_CLASSNAME} />
            </div>
            <div className="space-y-2">
              <Label className="workspace-section-label">{t("auth.newPassword")}</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={SETTINGS_INPUT_CLASSNAME} />
            </div>
            <div className="space-y-2">
              <Label className="workspace-section-label">{t("auth.confirmPassword")}</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={SETTINGS_INPUT_CLASSNAME} />
            </div>
          </div>
          <Button onClick={changePassword} disabled={changingPassword} className="mt-5 rounded-2xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300">
            {changingPassword ? t("settings.changingPassword") : t("settings.changePassword")}
          </Button>
        </section>

        {/* Language */}
        <section className="workspace-card p-5">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.language")}</h3>
          <div className="mt-5 space-y-2">
            <Label className="workspace-section-label">{t("settings.language")}</Label>
            <Select value={i18n.language} onValueChange={(v) => { void i18n.changeLanguage(v); }}>
              <SelectTrigger className={SETTINGS_INPUT_CLASSNAME}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {t(lang.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {/* Sessions */}
        <section className="workspace-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>{t("settings.sessionsTitle")}</h3>
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
            {loadingSessions && <p className="text-sm text-zinc-500">{t("settings.loadingSessions")}</p>}
            {!loadingSessions && authSessions.length === 0 && (
              <p className="rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-500">{t("settings.noSessions")}</p>
            )}
            {!loadingSessions &&
              authSessions.map((session) => (
                <div
                  key={session.session_id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {session.platform && !["desktop", "web"].includes(session.platform) ? session.platform : t(`settings.sessionPlatform.${session.platform || "web"}`)}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {t("settings.sessionIssuedAt", { value: new Date(session.issued_at).toLocaleString() })}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t("settings.sessionLastSeen", { value: new Date(session.last_seen_at || session.issued_at).toLocaleString() })}
                    </p>
                    {session.user_agent ? <p className="max-w-[440px] text-xs text-zinc-500">{session.user_agent}</p> : null}
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

        {/* Export */}
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

        {/* Delete account */}
        <section className="workspace-card border-red-500/15 bg-[linear-gradient(180deg,rgba(127,29,29,0.12),rgba(9,9,11,0.72))] p-5">
          <div className="flex items-start gap-3">
            <Trash size={20} className="mt-0.5 text-red-400" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-red-300" style={{ fontFamily: "Manrope" }}>{t("settings.deleteAccount")}</h3>
              <p className="mt-1 text-sm text-zinc-400">{t("settings.deleteDescription")}</p>
              <Input
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
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

      {/* Avatar editor dialog */}
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
                  min={80} max={180} step={1}
                  onValueChange={([v]) => setAvatarEditorZoom(v / 100)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="workspace-section-label">{t("settings.avatarOffsetX")}</Label>
                    <span className="text-xs text-zinc-500">{avatarEditorOffsetX}</span>
                  </div>
                  <Slider value={[avatarEditorOffsetX]} min={-100} max={100} step={1} onValueChange={([v]) => setAvatarEditorOffsetX(v)} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="workspace-section-label">{t("settings.avatarOffsetY")}</Label>
                    <span className="text-xs text-zinc-500">{avatarEditorOffsetY}</span>
                  </div>
                  <Slider value={[avatarEditorOffsetY]} min={-100} max={100} step={1} onValueChange={([v]) => setAvatarEditorOffsetY(v)} />
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
