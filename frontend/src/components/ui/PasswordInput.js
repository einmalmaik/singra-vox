/**
 * PasswordInput – Zentrale Passwort-Eingabe-Komponente
 *
 * Wiederverwendbar in:
 *   - SVID-Registrierung
 *   - Lokale Registrierung
 *   - Passwort-Reset (lokal + SVID)
 *   - Passwort-Änderung
 *   - Jede Stelle, die ein Passwort-Input braucht
 *
 * Features:
 *   - Passwort ein-/ausblenden
 *   - Live-Stärke-Check (via /api/id/password/check)
 *   - Passwort-Generator (via /api/id/password/generate)
 *   - Feedback (welche Anforderungen fehlen)
 *   - Policy-Check (meets_policy Indikator)
 *
 * Props:
 *   value       – aktueller Passwort-Wert (controlled)
 *   onChange     – Callback bei Änderung (neuer Wert als String)
 *   label       – Label über dem Input (optional, Standard: aus i18n)
 *   placeholder – Placeholder-Text (optional)
 *   showStrength– Stärke-Indikator anzeigen (Standard: true)
 *   showGenerate– Generator-Button anzeigen (Standard: true)
 *   autoFocus   – Input automatisch fokussieren
 *   testId      – data-testid Prefix (Standard: "password")
 *   className   – Extra CSS-Klassen für den äußeren Container
 */
import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeSlash, ArrowsClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/lib/api";

const STRENGTH_COLORS = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#10B981"];
const STRENGTH_KEYS = [
  "passwordInput.veryWeak",
  "passwordInput.weak",
  "passwordInput.fair",
  "passwordInput.strong",
  "passwordInput.veryStrong",
];

function StrengthBar({ strength, t }) {
  if (!strength) return null;
  return (
    <div className="space-y-1.5" data-testid="password-strength">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: i <= strength.score ? STRENGTH_COLORS[strength.score] : "#27272A" }}
          />
        ))}
      </div>
      <p className="text-xs" style={{ color: STRENGTH_COLORS[strength.score] }}>
        {t(STRENGTH_KEYS[strength.score])}
      </p>
      {strength.feedback?.length > 0 && (
        <ul className="space-y-0.5">
          {strength.feedback.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
              <XCircle size={12} className="mt-0.5 text-red-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}
      {strength.meets_policy && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle size={12} /> {t("passwordInput.meetsPolicy")}
        </p>
      )}
    </div>
  );
}

export default function PasswordInput({
  value = "",
  onChange,
  label,
  placeholder,
  showStrength = true,
  showGenerate = true,
  autoFocus = false,
  testId = "password",
  className = "",
}) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState(null);
  const debounceRef = useRef(null);

  const checkStrength = useCallback(async (pw) => {
    if (!pw || pw.length < 3) {
      setStrength(null);
      return;
    }
    try {
      const res = await api.post("/id/password/check", { password: pw });
      setStrength(res.data);
    } catch {
      // Silently ignore check errors
    }
  }, []);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    onChange(val);
    if (showStrength) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => checkStrength(val), 350);
    }
  }, [onChange, showStrength, checkStrength]);

  const handleGenerate = useCallback(async () => {
    try {
      const res = await api.post("/id/password/generate?length=18");
      const pw = res.data?.password;
      if (pw) {
        onChange(pw);
        setShowPassword(true);
        checkStrength(pw);
      }
    } catch {
      // Silently ignore
    }
  }, [onChange, checkStrength]);

  return (
    <div className={`space-y-2 ${className}`}>
      {label !== false && (
        <Label htmlFor={`${testId}-input`} className="workspace-section-label">
          {label || t("passwordInput.label")}
        </Label>
      )}
      <div className="relative">
        <Input
          id={`${testId}-input`}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder={placeholder || t("passwordInput.placeholder")}
          autoFocus={autoFocus}
          required
          data-testid={`${testId}-input`}
          className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 pr-20 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {showGenerate && (
            <button
              type="button"
              onClick={handleGenerate}
              tabIndex={-1}
              title={t("passwordInput.generate")}
              className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
              data-testid={`${testId}-generate-btn`}
            >
              <ArrowsClockwise size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
            title={showPassword ? t("passwordInput.hide") : t("passwordInput.show")}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            data-testid={`${testId}-toggle-btn`}
          >
            {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      {showStrength && <StrengthBar strength={strength} t={t} />}
    </div>
  );
}
