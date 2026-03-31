import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useRuntime } from "@/contexts/RuntimeContext";
import { getCurrentDeepLinks, onDesktopDeepLinkOpen } from "@/lib/desktop";
import { parseDesktopInviteLink, savePendingInvite } from "@/lib/inviteLinks";

export default function DesktopInviteBridge() {
  const navigate = useNavigate();
  const { ready, config, connectToInstance } = useRuntime();
  const lastHandledLinkRef = useRef("");

  useEffect(() => {
    if (!ready) return undefined;

    let cancelled = false;
    let unsubscribe = null;

    const handleDeepLinks = async (urls) => {
      for (const url of urls || []) {
        if (!url || lastHandledLinkRef.current === url) {
          continue;
        }

        const parsedInvite = parseDesktopInviteLink(url);
        if (!parsedInvite?.code) {
          continue;
        }

        lastHandledLinkRef.current = url;
        if (parsedInvite.instanceUrl && parsedInvite.instanceUrl !== config?.instanceUrl) {
          try {
            await connectToInstance(parsedInvite.instanceUrl);
          } catch {
            // Invalid instance URLs should not break the app shell.
          }
        }

        savePendingInvite(parsedInvite.code);
        navigate(`/invite/${parsedInvite.code}`, { replace: true });
      }
    };

    (async () => {
      const currentLinks = await getCurrentDeepLinks();
      if (!cancelled) {
        await handleDeepLinks(currentLinks);
      }

      unsubscribe = await onDesktopDeepLinkOpen(async (urls) => {
        if (!cancelled) {
          await handleDeepLinks(urls);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [config?.instanceUrl, connectToInstance, navigate, ready]);

  return null;
}
