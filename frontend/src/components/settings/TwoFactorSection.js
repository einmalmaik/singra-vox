/**
 * TwoFactorSection – 2FA Setup/Management UI
 *
 * Displays the current 2FA status and allows users to:
 * - Set up 2FA (QR code, manual entry, confirm with code)
 * - View backup codes (once, after setup)
 * - Disable 2FA (requires password)
 *
 * Includes a hint to use Singra Vault as authenticator.
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const API = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const SINGRA_VAULT_URL = "https://singravault.mauntingstudios.de";

export default function TwoFactorSection({ token }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null); // null = loading, true/false
  const [setupData, setSetupData] = useState(null); // { secret, qr_uri }
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // ── Fetch 2FA status ──
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/auth/2fa/status`, { headers });
      const data = await res.json();
      setStatus(data.enabled);
    } catch {
      setStatus(false);
    }
  }, [token]);

  // Load on first render
  useState(() => { fetchStatus(); });

  // ── Start 2FA setup ──
  const startSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/2fa/setup`, { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.detail || "Setup failed");
        return;
      }
      const data = await res.json();
      setSetupData(data);
      setConfirmCode("");
    } catch {
      toast.error("Connection error");
    } finally {
      setLoading(false);
    }
  };

  // ── Confirm 2FA with first code ──
  const confirmSetup = async () => {
    if (confirmCode.length < 6) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/2fa/confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ code: confirmCode }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.detail || "Invalid code");
        return;
      }
      const data = await res.json();
      setBackupCodes(data.backup_codes);
      setStatus(true);
      setSetupData(null);
      toast.success("2FA activated!");
    } catch {
      toast.error("Connection error");
    } finally {
      setLoading(false);
    }
  };

  // ── Disable 2FA ──
  const disable2FA = async () => {
    if (!disablePassword) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/2fa/disable`, {
        method: "POST", headers,
        body: JSON.stringify({ password: disablePassword }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.detail || "Failed");
        return;
      }
      setStatus(false);
      setShowDisable(false);
      setDisablePassword("");
      setBackupCodes(null);
      toast.success("2FA disabled");
    } catch {
      toast.error("Connection error");
    } finally {
      setLoading(false);
    }
  };

  if (status === null) {
    return (
      <div className="flex items-center gap-3 py-6" data-testid="2fa-loading">
        <div className="h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">Loading…</span>
      </div>
    );
  }

  // ── Backup codes display ──
  if (backupCodes) {
    return (
      <div className="space-y-4" data-testid="2fa-backup-codes">
        <div className="flex items-center gap-2 text-green-400">
          <ShieldCheck size={20} weight="fill" />
          <span className="font-semibold text-sm">2FA is now active</span>
        </div>
        <p className="text-sm text-zinc-400">
          Save these backup codes in a safe place. Each code can only be used once.
          If you lose your authenticator app, these are your only way to log in.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-900/80 border border-zinc-800 p-4">
          {backupCodes.map((code, i) => (
            <code key={i} className="text-xs font-mono text-zinc-300 tracking-wider">
              {code}
            </code>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Store them in{" "}
          <a href={SINGRA_VAULT_URL} target="_blank" rel="noopener noreferrer"
             className="text-cyan-400 hover:underline">
            Singra Vault
          </a>{" "}
          for secure storage.
        </p>
        <Button
          variant="outline" size="sm"
          onClick={() => {
            navigator.clipboard.writeText(backupCodes.join("\n"));
            toast.success("Copied to clipboard!");
          }}
          data-testid="2fa-copy-backup-codes"
        >
          Copy all codes
        </Button>
        <Button
          variant="ghost" size="sm"
          onClick={() => setBackupCodes(null)}
          className="ml-2"
        >
          Done
        </Button>
      </div>
    );
  }

  // ── Setup flow (QR code + confirm) ──
  if (setupData) {
    return (
      <div className="space-y-4" data-testid="2fa-setup">
        <h4 className="text-sm font-semibold text-zinc-200">Set up Two-Factor Authentication</h4>

        <p className="text-sm text-zinc-400">
          Scan this QR code with your authenticator app:
        </p>

        {/* QR Code as an image via Google Charts API (works offline too with manual entry) */}
        <div className="flex justify-center">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.qr_uri)}`}
            alt="2FA QR Code"
            className="rounded-xl border border-zinc-700"
            width={200} height={200}
            data-testid="2fa-qr-code"
          />
        </div>

        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300 transition">
            Can't scan? Enter manually
          </summary>
          <code className="mt-2 block break-all rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-zinc-300 font-mono text-xs">
            {setupData.secret}
          </code>
        </details>

        <p className="text-xs text-zinc-500">
          We recommend{" "}
          <a href={SINGRA_VAULT_URL} target="_blank" rel="noopener noreferrer"
             className="text-cyan-400 hover:underline">
            Singra Vault
          </a>{" "}
          as your authenticator.
        </p>

        <div className="space-y-2">
          <label className="text-sm text-zinc-300">Enter the 6-digit code to confirm:</label>
          <InputOTP
            maxLength={6}
            value={confirmCode}
            onChange={(val) => setConfirmCode(val)}
            data-testid="2fa-confirm-input"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={confirmSetup}
            disabled={loading || confirmCode.length < 6}
            className="bg-cyan-600 hover:bg-cyan-500"
            data-testid="2fa-confirm-btn"
          >
            {loading ? "Verifying…" : "Activate 2FA"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSetupData(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── Main view: enabled or disabled ──
  return (
    <div className="space-y-4" data-testid="2fa-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ShieldCheck size={18} weight={status ? "fill" : "regular"} className={status ? "text-green-400" : "text-zinc-500"} />
          <div>
            <p className="text-sm font-medium text-zinc-200">Two-Factor Authentication</p>
            <p className="text-xs text-zinc-500">
              {status ? "Enabled – your account is protected" : "Not enabled"}
            </p>
          </div>
        </div>
        {!status && (
          <Button
            size="sm" onClick={startSetup} disabled={loading}
            className="bg-cyan-600 hover:bg-cyan-500"
            data-testid="2fa-enable-btn"
          >
            {loading ? "…" : "Enable"}
          </Button>
        )}
      </div>

      {status && !showDisable && (
        <Button
          variant="outline" size="sm"
          onClick={() => setShowDisable(true)}
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          data-testid="2fa-disable-start-btn"
        >
          Disable 2FA
        </Button>
      )}

      {showDisable && (
        <div className="space-y-3 rounded-xl bg-zinc-900/60 border border-red-500/20 p-4">
          <p className="text-sm text-red-300">Enter your password to disable 2FA:</p>
          <Input
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            placeholder="Password"
            className="h-10 bg-zinc-950/80 border-zinc-700"
            data-testid="2fa-disable-password"
          />
          <div className="flex gap-2">
            <Button
              size="sm" variant="destructive"
              onClick={disable2FA}
              disabled={loading || !disablePassword}
              data-testid="2fa-disable-confirm-btn"
            >
              {loading ? "…" : "Disable 2FA"}
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => { setShowDisable(false); setDisablePassword(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Secure your codes with{" "}
        <a href={SINGRA_VAULT_URL} target="_blank" rel="noopener noreferrer"
           className="text-cyan-500 hover:underline">
          Singra Vault
        </a>
      </p>
    </div>
  );
}
