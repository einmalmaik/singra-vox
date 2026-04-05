export default function LocalizedErrorBanner({ message, className = "", ...props }) {
  if (!message) {
    return null;
  }

  // Sicherheitshalber: Objekte abfangen die nicht als JSX gerendert werden können
  let displayMessage = message;
  if (typeof message === "object" && !Array.isArray(message) && message !== null) {
    displayMessage = message.msg || message.message || message.detail || JSON.stringify(message);
  }
  if (Array.isArray(message)) {
    displayMessage = message
      .map((m) => (typeof m === "object" ? m.msg || m.message || JSON.stringify(m) : String(m)))
      .join(". ");
  }

  return (
    <div
      role="alert"
      {...props}
      className={`rounded-2xl border border-red-500/20 bg-[linear-gradient(180deg,rgba(127,29,29,0.12),rgba(9,9,11,0.72))] px-4 py-3 text-sm text-red-100 shadow-[0_16px_40px_rgba(0,0,0,0.22)] ${className}`.trim()}
    >
      {displayMessage}
    </div>
  );
}
