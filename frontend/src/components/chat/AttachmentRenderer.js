/**
 * AttachmentRenderer – zeigt Chat-Anhänge als Inline-Bild oder Download-Button.
 *
 * Nicht-E2EE-Bilder: direktes <img>-Tag mit /api/files/-URL.
 * E2EE-Bilder: automatische client-seitige Entschlüsselung + Blob-URL-Rendering.
 * Alle anderen Anhänge: Download-Button.
 */
import { useState, useEffect, useRef } from "react";
import { Paperclip, Image as ImageIcon, ArrowDown } from "@phosphor-icons/react";
import { useE2EE } from "@/contexts/E2EEContext";

// ── Nicht-E2EE-Bild ─────────────────────────────────────────────────────────
function PlainImage({ url, name, assetBase }) {
  const src = url ? `${assetBase || ""}${url}` : null;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={name}
      className="max-w-md max-h-80 rounded-2xl border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.22)] cursor-pointer hover:opacity-90 transition-opacity"
      data-testid="inline-image"
      onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
    />
  );
}

// ── E2EE-Bild (entschlüsselt, Blob-URL) ─────────────────────────────────────
function E2EEInlineImage({ attachment, name }) {
  const { downloadAndDecryptAttachment } = useE2EE();
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const urlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setBlobUrl(null);

    downloadAndDecryptAttachment(attachment)
      .then(({ url }) => {
        if (!cancelled) {
          urlRef.current = url;
          setBlobUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.blob_id]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/65 px-3 py-2 text-xs text-[#71717A]"
        data-testid="e2ee-image-loading"
      >
        <ImageIcon size={14} className="animate-pulse" />
        <span>Entschlüssele Bild…</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-zinc-900/65 px-3 py-2 text-xs text-red-400"
        data-testid="e2ee-image-error"
      >
        <ImageIcon size={14} />
        <span>Bild konnte nicht entschlüsselt werden</span>
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={name}
      className="max-w-md max-h-80 rounded-2xl border border-cyan-500/20 shadow-[0_16px_40px_rgba(0,0,0,0.22)] cursor-pointer hover:opacity-90 transition-opacity"
      data-testid="e2ee-inline-image"
      onClick={() => window.open(blobUrl, "_blank", "noopener,noreferrer")}
    />
  );
}

// ── Download-Button ──────────────────────────────────────────────────────────
function DownloadButton({ attachment, isE2EE, assetBase, onDownload }) {
  const name = attachment.name || attachment.original_name || "Datei";
  const href = isE2EE ? null : (attachment.url ? `${assetBase || ""}${attachment.url}` : null);

  const handleClick = () => {
    if (isE2EE) {
      onDownload(attachment);
    } else if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/65 px-3 py-2 text-xs text-[#A1A1AA] transition-colors hover:bg-white/5 hover:text-white"
      data-testid="attachment-download-btn"
    >
      {isE2EE ? <ArrowDown size={14} /> : <Paperclip size={14} />}
      <span className="max-w-[200px] truncate">{name}</span>
    </button>
  );
}

// ── Haupt-Export ─────────────────────────────────────────────────────────────
/**
 * @param {object} props
 * @param {object} props.attachment   – Anhang-Objekt (E2EE-Manifest oder normaler Anhang)
 * @param {boolean} props.isE2EE      – Nachricht ist E2EE-verschlüsselt?
 * @param {string} [props.assetBase]  – Basis-URL für nicht-E2EE-Assets
 * @param {function} props.onDownload – Callback für verschlüsselte Download-Buttons
 */
export function AttachmentRenderer({ attachment, isE2EE, assetBase, onDownload }) {
  const mimeType = attachment?.content_type || attachment?.type || "";
  const isImage = mimeType.startsWith("image/");

  if (!isE2EE && isImage) {
    return (
      <PlainImage
        url={attachment.url}
        name={attachment.name || attachment.original_name || "Bild"}
        assetBase={assetBase}
      />
    );
  }

  if (isE2EE && isImage && attachment?.blob_id) {
    return (
      <E2EEInlineImage
        attachment={attachment}
        name={attachment.name || "Verschlüsseltes Bild"}
      />
    );
  }

  return (
    <DownloadButton
      attachment={attachment}
      isE2EE={isE2EE}
      assetBase={assetBase}
      onDownload={onDownload}
    />
  );
}
