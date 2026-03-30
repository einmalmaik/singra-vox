import { useState, useRef, useEffect } from "react";
import { X, PaperPlaneRight } from "@phosphor-icons/react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ThreadPanel({ messageId, channelId, onClose, user }) {
  const [thread, setThread] = useState(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (messageId) loadThread();
  }, [messageId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  const loadThread = async () => {
    try {
      const res = await api.get(`/messages/${messageId}/thread`);
      setThread(res.data);
    } catch {
      toast.error("Failed to load thread");
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/channels/${channelId}/messages/${messageId}/reply`, { content: content.trim() });
      setContent("");
      loadThread();
    } catch {
      toast.error("Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  if (!thread) {
    return (
      <div className="w-[360px] bg-[#121212] border-l border-[#27272A] flex items-center justify-center" data-testid="thread-panel-loading">
        <div className="w-6 h-6 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-[360px] bg-[#121212] border-l border-[#27272A] flex flex-col shrink-0" data-testid="thread-panel">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
        <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope' }}>Thread</h3>
        <button onClick={onClose} data-testid="close-thread" className="text-[#71717A] hover:text-white transition-colors">
          <X size={18} weight="bold" />
        </button>
      </div>

      {/* Parent message */}
      <div className="px-4 py-3 border-b border-[#27272A]/50 bg-[#0A0A0A]/50">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-white">{thread.parent?.author?.display_name}</span>
          <span className="text-[10px] text-[#52525B]">{new Date(thread.parent?.created_at).toLocaleString()}</span>
        </div>
        <p className="text-sm text-[#E4E4E7]">{thread.parent?.content}</p>
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <p className="text-xs text-[#71717A] text-center py-1">{thread.reply_count} {thread.reply_count === 1 ? 'reply' : 'replies'}</p>
        {thread.replies?.map(reply => (
          <div key={reply.id} className="flex gap-2.5 fade-in" data-testid={`thread-reply-${reply.id}`}>
            <div className="w-7 h-7 rounded-full bg-[#27272A] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {reply.author?.display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-white">{reply.author?.display_name}</span>
                <span className="text-[10px] text-[#52525B]">{new Date(reply.created_at).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-[#E4E4E7] mt-0.5 break-words">{reply.content}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Reply input */}
      <form onSubmit={sendReply} className="p-3 border-t border-[#27272A]">
        <div className="flex items-center gap-2 bg-[#27272A] rounded-lg px-3 py-2">
          <input
            value={content} onChange={e => setContent(e.target.value)}
            placeholder="Reply in thread..." data-testid="thread-reply-input"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none"
          />
          <button type="submit" disabled={!content.trim() || sending} data-testid="thread-reply-send"
            className="text-[#6366F1] hover:text-[#4F46E5] disabled:text-[#52525B] transition-colors">
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </div>
      </form>
    </div>
  );
}
