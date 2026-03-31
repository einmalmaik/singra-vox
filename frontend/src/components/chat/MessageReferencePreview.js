import { ArrowBendUpLeft } from "@phosphor-icons/react";

function getPreviewText(message) {
  if (!message) {
    return "Original message unavailable";
  }

  const content = message.content?.trim();
  if (content) {
    return content;
  }

  if (message.attachments?.length) {
    return message.attachments.length === 1 ? "1 attachment" : `${message.attachments.length} attachments`;
  }

  return "Original message unavailable";
}

export default function MessageReferencePreview({
  message,
  onClick,
  className = "",
  placeholder = "Original message unavailable",
}) {
  const isClickable = typeof onClick === "function" && message?.id;
  const previewText = message ? getPreviewText(message) : placeholder;
  const authorName = message?.author?.display_name || message?.author?.username || "Unknown user";
  const Component = isClickable ? "button" : "div";

  return (
    <Component
      type={isClickable ? "button" : undefined}
      onClick={isClickable ? onClick : undefined}
      className={[
        "group flex w-full items-start gap-2 rounded-md border border-[#27272A] bg-[#111214]/90 px-2.5 py-2 text-left transition-colors",
        isClickable ? "hover:border-[#3F3F46] hover:bg-[#15161A]" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      <ArrowBendUpLeft size={13} className="mt-0.5 shrink-0 text-[#71717A] transition-colors group-hover:text-[#A1A1AA]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-[#A1A1AA]">
          Replying to {authorName}
        </div>
        <div className="truncate text-xs text-[#71717A]">
          {previewText}
        </div>
      </div>
    </Component>
  );
}
