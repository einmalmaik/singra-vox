import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PushPin, X } from "@phosphor-icons/react";
import api from "@/lib/api";
import MessageReferencePreview from "@/components/chat/MessageReferencePreview";

export default function PinnedMessagesPanel({ channelId, onClose, onJumpToMessage, refreshKey }) {
  const { t } = useTranslation();
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadPins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/channels/${channelId}/pins`);
      setPins(res.data);
    } catch {
      setPins([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (channelId) {
      loadPins();
    }
  }, [channelId, loadPins, refreshKey]);

  const unpin = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}/pin`);
      setPins(prev => prev.filter(p => p.id !== msgId));
    } catch {}
  };

  return (
    <div className="w-[320px] bg-[#121212] border-l border-[#27272A] flex flex-col shrink-0" data-testid="pinned-panel">
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
        <div className="flex items-center gap-2">
          <PushPin size={16} weight="fill" className="text-[#F59E0B]" />
          <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope' }}>
            {t("pinned.title")}
          </h3>
          <span className="text-[10px] text-[#71717A] bg-[#27272A] rounded-full px-1.5">{pins.length}</span>
        </div>
        <button onClick={onClose} className="text-[#71717A] hover:text-white transition-colors" data-testid="close-pins">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : pins.length === 0 ? (
            <div className="text-center py-8">
              <PushPin size={32} className="text-[#27272A] mx-auto mb-2" />
            <p className="text-sm text-[#71717A]">{t("pinned.empty")}</p>
            <p className="text-xs text-[#52525B] mt-1">{t("pinned.emptyHelp")}</p>
          </div>
        ) : (
          pins.map(pin => (
            <div key={pin.id} className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 group" data-testid={`pin-${pin.id}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#27272A] flex items-center justify-center text-[10px] font-bold">
                    {pin.author?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="text-xs font-semibold">{pin.author?.display_name}</span>
                </div>
                <button onClick={() => unpin(pin.id)} data-testid={`unpin-${pin.id}`}
                  className="hidden group-hover:block text-[#71717A] hover:text-[#EF4444] transition-colors">
                  <X size={12} />
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">{pin.content}</p>
                {pin.reply_to_id && (
                  <MessageReferencePreview
                    message={null}
                    placeholder={t("pinned.replyReference")}
                    className="bg-[#111214]"
                  />
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] text-[#52525B]">{new Date(pin.pinned_at || pin.created_at).toLocaleString()}</p>
                  {typeof onJumpToMessage === "function" && (
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(pin.id)}
                      className="rounded-md border border-[#3F3F46] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4D4D8] transition-colors hover:border-[#6366F1] hover:text-white"
                    >
                      {t("pinned.jump")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
