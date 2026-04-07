/*
 * Singra Vox – Privacy / E2EE settings tab
 * Displays E2EE status, linked devices, and passphrase export.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Export, ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useE2EE, getE2EEAutoPassphrase } from "@/contexts/E2EEContext";
import { Button } from "@/components/ui/button";

export default function PrivacySettingsTab() {
  const { t } = useTranslation();
  const {
    loading: e2eeLoading,
    enabled: e2eeEnabled,
    devices: e2eeDevices,
    currentDevice,
    ready: e2eeReady,
    approveDevice,
    revokeDevice,
    fingerprintPublicKey,
  } = useE2EE();

  const [currentDeviceFingerprint, setCurrentDeviceFingerprint] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentDevice?.public_key) {
        setCurrentDeviceFingerprint("");
        return;
      }
      const fp = await fingerprintPublicKey(currentDevice.public_key);
      if (!cancelled) setCurrentDeviceFingerprint(fp);
    })();
    return () => { cancelled = true; };
  }, [currentDevice?.public_key, fingerprintPublicKey]);

  return (
    <div className="space-y-6" data-testid="privacy-settings-panel">
      {/* E2EE – always active */}
      <section className="workspace-card p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 text-emerald-400" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold" style={{ fontFamily: "Manrope" }}>Ende-zu-Ende-Verschlüsselung</h3>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                {e2eeEnabled ? "Aktiv" : e2eeLoading ? "Initialisiere…" : "Wird aktiviert..."}
              </span>
            </div>

            <div className="mt-3 rounded-2xl border border-white/6 bg-zinc-900/40 px-4 py-3 space-y-2 text-xs text-zinc-400">
              <p><span className="font-semibold text-zinc-200">Warum immer aktiv?</span> Alle Nachrichten und Dateien werden <span className="text-emerald-400 font-medium">direkt in deinem Browser</span> ver- und entschlüsselt, bevor sie den Server verlassen. Der Server – und damit auch die Datenbank – erhält ausschließlich unlesbaren Geheimtext. Selbst der Betreiber dieser Instanz kann <strong className="text-white">keine einzige Nachricht lesen</strong>, da der geheime Schlüssel diesen Rechner niemals verlässt.</p>
              <p><span className="font-semibold text-zinc-200">Warum nicht sofort beim ersten Start?</span> Die Schlüsselgenerierung (Argon2id / NaCl) läuft einmalig im Hintergrund, 2 Sekunden nach dem Login. Das verhindert, dass die App beim ersten Start einfriert.</p>
              <p><span className="font-semibold text-zinc-200">Neues Gerät?</span> Deine gespeicherte Gerät-Passphrase wird automatisch verwendet. Wenn du ein komplett neues Gerät nutzt (ohne lokale Daten), wirst du gebeten, das Gerät manuell zu bestätigen.</p>
            </div>

            {/* Current device status */}
            {e2eeEnabled && (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{currentDevice?.device_name || "Dieses Gerät"}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {e2eeReady ? "Verifiziert – Nachrichten werden verschlüsselt" : "Ausstehend – warte auf Bestätigung durch ein anderes Gerät"}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${e2eeReady ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-700/50 text-zinc-400"}`}>
                      {e2eeReady ? "Bereit" : "Ausstehend"}
                    </span>
                  </div>
                  {currentDeviceFingerprint && (
                    <p className="mt-3 rounded-xl border border-white/6 bg-zinc-950/75 px-3 py-2 text-xs tracking-widest text-zinc-500 font-mono break-all">
                      {currentDeviceFingerprint}
                    </p>
                  )}
                </div>

                {/* Linked devices */}
                {e2eeDevices.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3">
                    <h4 className="text-sm font-semibold text-white mb-2">Verknüpfte Geräte</h4>
                    <div className="space-y-2">
                      {e2eeDevices.map((device) => (
                        <div key={device.device_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/6 bg-zinc-950/75 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium text-white">{device.device_name}</p>
                            <p className="text-xs text-zinc-500">
                              {device.verified_at ? `Bestätigt: ${new Date(device.verified_at).toLocaleString("de-DE")}` : "Wartet auf Genehmigung"}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {!device.verified_at && (
                              <Button size="sm" onClick={() => approveDevice(device.device_id)} className="rounded-xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300 text-xs h-7">
                                Genehmigen
                              </Button>
                            )}
                            {currentDevice?.device_id !== device.device_id && !device.revoked_at && (
                              <Button size="sm" variant="outline" onClick={() => revokeDevice(device.device_id)} className="rounded-xl border-red-500/30 bg-transparent text-red-400 hover:bg-red-900/30 text-xs h-7">
                                Entfernen
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!e2eeEnabled && !e2eeLoading && (
              <p className="mt-3 text-xs text-zinc-500 animate-pulse">
                E2EE wird im Hintergrund initialisiert... (einmalig, ~2 Sekunden)
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Passphrase export */}
      {e2eeEnabled && (
        <section className="workspace-card p-5" data-testid="e2ee-passphrase-export">
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} className="mt-0.5 text-cyan-300" />
            <div className="flex-1">
              <h3 className="text-base font-bold" style={{ fontFamily: "Manrope" }}>Gerät-Passphrase exportieren</h3>
              <p className="mt-1 text-xs text-zinc-400">
                Exportiere deine Geräte-Passphrase für ein neues Gerät oder als Backup. <span className="text-amber-400 font-medium">Teile sie niemals mit anderen Personen.</span>
              </p>
              <div className="mt-3 space-y-2">
                {showPassphrase ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3">
                      <p className="text-xs font-mono break-all text-cyan-300 select-all" data-testid="e2ee-passphrase-value">
                        {getE2EEAutoPassphrase() || "—"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/8 text-xs"
                        onClick={() => {
                          const pp = getE2EEAutoPassphrase();
                          if (pp) { navigator.clipboard.writeText(pp); toast.success("Passphrase kopiert"); }
                        }}
                        data-testid="e2ee-copy-passphrase-btn"
                      >
                        Kopieren
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/8 text-xs"
                        onClick={() => {
                          const pp = getE2EEAutoPassphrase();
                          if (!pp) return;
                          const blob = new Blob([`Singra Vox – E2EE Geräte-Passphrase\n\nPassphrase: ${pp}\n\nWichtig: Teile diese Datei niemals mit anderen Personen.\nAufbewahrungsort: sicher offline (z.B. Passwortmanager)\n`], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = "singravox-e2ee-passphrase.txt";
                          a.click(); URL.revokeObjectURL(url);
                        }}
                        data-testid="e2ee-download-passphrase-btn"
                      >
                        Als .txt speichern
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-white/10 bg-transparent text-zinc-500 hover:bg-white/5 text-xs"
                        onClick={() => setShowPassphrase(false)}
                      >
                        Verbergen
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-xl bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs border border-white/10"
                    onClick={() => setShowPassphrase(true)}
                    data-testid="e2ee-show-passphrase-btn"
                  >
                    Passphrase anzeigen
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Data export */}
      <section className="workspace-card p-5">
        <div className="flex items-start gap-3">
          <Export size={20} className="mt-0.5 text-cyan-300" />
          <div>
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("settings.exportData")}</h3>
            <p className="mt-1 text-sm text-[#71717A]">{t("settings.exportDescription")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
