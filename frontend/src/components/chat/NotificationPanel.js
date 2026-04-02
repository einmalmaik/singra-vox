import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, Trash, ChatCircle, At, ArrowBendUpLeft } from "@phosphor-icons/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import api from "@/lib/api";
import {
  getNotificationsState,
  loadNotifications,
  markAllNotificationsReadLocal,
  markNotificationReadLocal,
  removeNotificationLocal,
  subscribeNotifications,
} from "@/lib/notificationsStore";

export default function NotificationPanel() {
  const { t } = useTranslation();
  const [notificationState, setNotificationState] = useState(getNotificationsState());
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount } = notificationState;

  useEffect(() => {
    setNotificationState(getNotificationsState());
    void loadNotifications();
    const unsubscribe = subscribeNotifications(setNotificationState);
    return () => {
      unsubscribe();
    };
  }, []);

  const markRead = async (id) => {
    await api.post(`/notifications/${id}/read`);
    markNotificationReadLocal(id);
  };

  const markAllRead = async () => {
    await api.post("/notifications/read-all");
    markAllNotificationsReadLocal();
  };

  const deleteNotif = async (id) => {
    await api.delete(`/notifications/${id}`);
    removeNotificationLocal(id);
  };

  const getIcon = (type) => {
    switch (type) {
      case "mention": return <At size={14} weight="bold" className="text-[#6366F1]" />;
      case "dm": return <ChatCircle size={14} weight="bold" className="text-[#22C55E]" />;
      case "thread": return <ArrowBendUpLeft size={14} weight="bold" className="text-[#F59E0B]" />;
      default: return <Bell size={14} className="text-[#71717A]" />;
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) {
        void loadNotifications({ force: true });
      }
    }}>
      <DropdownMenuTrigger asChild>
        <button className="relative p-1.5 rounded hover:bg-[#27272A] text-[#71717A] hover:text-white transition-colors" data-testid="notification-bell">
          <Bell size={18} weight={unreadCount > 0 ? "fill" : "bold"} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-[#EF4444] text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5" data-testid="notif-badge">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-[#18181B] border-[#27272A] text-white w-80 max-h-[400px] p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272A]">
          <h4 className="text-sm font-bold" style={{ fontFamily: 'Manrope' }}>{t("notifications.title")}</h4>
          {unreadCount > 0 && (
            <button onClick={markAllRead} data-testid="mark-all-read"
              className="text-[10px] text-[#6366F1] hover:text-[#4F46E5] font-medium">
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[350px]">
          {notifications.length === 0 ? (
            <p className="text-[#71717A] text-xs text-center py-8">{t("notifications.empty")}</p>
          ) : (
            notifications.map(n => (
              <div key={n.id}
                className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-[#27272A]/50 hover:bg-[#27272A]/30 transition-colors ${
                  !n.read ? 'bg-[#6366F1]/5' : ''
                }`}
                data-testid={`notif-${n.id}`}
              >
                <div className="mt-0.5 shrink-0">{getIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">{n.title}</p>
                  <p className="text-[10px] text-[#71717A] mt-0.5 truncate">{n.body}</p>
                  <p className="text-[9px] text-[#52525B] mt-1">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  {!n.read && (
                    <button onClick={() => markRead(n.id)} className="p-1 rounded hover:bg-[#27272A] text-[#71717A] hover:text-[#6366F1]">
                      <Check size={12} />
                    </button>
                  )}
                  <button onClick={() => deleteNotif(n.id)} className="p-1 rounded hover:bg-[#27272A] text-[#71717A] hover:text-[#EF4444]">
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
