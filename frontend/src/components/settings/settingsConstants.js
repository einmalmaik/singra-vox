/*
 * Singra Vox – Shared settings utilities & style tokens
 * Extracted for reuse across all settings tab components.
 */

export const AVATAR_OUTPUT_SIZE = 512;

export const SETTINGS_INPUT_CLASSNAME =
  "h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus-visible:border-cyan-400/40 focus-visible:ring-cyan-400/20";

export const SETTINGS_NATIVE_SELECT_CLASSNAME =
  "h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/75 px-4 text-sm text-white outline-none transition focus:border-cyan-400/40 focus:bg-zinc-950/85 disabled:opacity-50";

export const SETTINGS_DANGER_INPUT_CLASSNAME =
  "mt-4 h-12 rounded-2xl border-red-500/20 bg-zinc-950/80 text-white placeholder:text-zinc-500 focus-visible:border-red-400/45 focus-visible:ring-red-400/20";

export function supportOutputDeviceSelection() {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("avatar-read-failed"));
    reader.readAsDataURL(file);
  });
}

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("avatar-image-load-failed"));
    image.src = source;
  });
}

export async function renderAvatarBlob({
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
  if (!context) throw new Error("avatar-canvas-unavailable");

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
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("avatar-blob-failed"));
          return;
        }
        resolve(blob);
      },
      "image/png",
      0.92,
    );
  });
}
