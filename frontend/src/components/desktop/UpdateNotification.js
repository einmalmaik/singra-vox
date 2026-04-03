/**
 * UpdateNotification – erscheint in der Desktop-App wenn ein Update verfügbar ist.
 * Lauscht auf das "update-available" Tauri-Event.
 * User kann "Jetzt aktualisieren" klicken – App lädt Update und startet neu.
 * Session (JWT-Token im OS-Keychain) bleibt dabei erhalten.
 */
import { useState, useEffect } from "react";
import { isDesktopApp, invokeTauri, listenTauri } from "@/lib/desktop";
import { ArrowsClockwise, X } from "@phosphor-icons/react";

export function UpdateNotification() {
  const [update, setUpdate] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | downloading | installing
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let unlistenUpdate, unlistenProgress, unlistenInstall;

    (async () => {
      // Lausche auf Background-Update-Check vom Rust-Layer
      unlistenUpdate = await listenTauri("update-available", (event) => {
        setUpdate(event.payload);
        setDismissed(false);
      });

      unlistenProgress = await listenTauri("update-download-progress", (event) => {
        const { chunkLength, contentLength } = event.payload;
        if (contentLength) {
          setProgress(Math.round((chunkLength / contentLength) * 100));
        }
      });

      unlistenInstall = await listenTauri("update-install-started", () => {
        setPhase("installing");
      });
    })();

    return () => {
      unlistenUpdate?.();
      unlistenProgress?.();
      unlistenInstall?.();
    };
  }, []);

  const handleUpdate = async () => {
    setPhase("downloading");
    setProgress(0);
    try {
      await invokeTauri("install_update_command");
      // App startet automatisch neu nach der Installation
    } catch (err) {
      console.error("Update fehlgeschlagen:", err);
      setPhase("idle");
    }
  };

  if (!update || dismissed || !isDesktopApp()) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-cyan-500/30 bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
      data-testid="update-notification"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/15">
          <ArrowsClockwise size={16} className="text-cyan-400" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">
            Update verfügbar
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Version {update.version} — du nutzt {update.currentVersion}
          </p>

          {update.body && (
            <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2">
              {update.body}
            </p>
          )}

          {phase === "idle" && (
            <button
              onClick={handleUpdate}
              className="mt-3 w-full rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/30"
              data-testid="update-install-btn"
            >
              Jetzt aktualisieren
            </button>
          )}

          {phase === "downloading" && (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Herunterladen…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-700">
                <div
                  className="h-1.5 rounded-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === "installing" && (
            <p className="mt-3 text-xs text-cyan-400">
              Installiere… App startet gleich neu.
            </p>
          )}
        </div>

        {phase === "idle" && (
          <button
            onClick={() => setDismissed(true)}
            className="ml-1 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
            data-testid="update-dismiss-btn"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
