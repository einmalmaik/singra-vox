import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CaretDown,
  Circle,
  MinusCircle,
  Moon,
  Prohibit,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useRuntime } from "@/contexts/RuntimeContext";
import { resolveAssetUrl } from "@/lib/assetUrls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function UserStatusPanel({ user, onUserUpdated }) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const [status, setStatus] = useState(user?.status || "online");

  useEffect(() => {
    if (user?.status) {
      setStatus(user.status);
    }
  }, [user?.status]);

  const statusOptions = [
    { value: "online", label: t("statusMenu.online"), icon: Circle, color: "#22C55E" },
    { value: "away", label: t("statusMenu.away"), icon: Moon, color: "#F59E0B" },
    { value: "dnd", label: t("statusMenu.dnd"), icon: MinusCircle, color: "#EF4444" },
    { value: "offline", label: t("statusMenu.invisible"), icon: Prohibit, color: "#71717A" },
  ];

  const changeStatus = async (nextStatus) => {
    const previousStatus = status;
    setStatus(nextStatus);
    try {
      await api.put("/users/me", { status: nextStatus });
      onUserUpdated?.({ ...user, status: nextStatus });
      toast.success(t("statusMenu.statusUpdated"));
    } catch (error) {
      setStatus(previousStatus);
      toast.error(formatAppError(t, error, { fallbackKey: "statusMenu.statusUpdateFailed" }));
    }
  };

  const currentStatus = statusOptions.find((option) => option.value === status) || statusOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[#27272A]/50"
          data-testid="user-status-trigger"
        >
          <div className="relative shrink-0">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-cyan-500/80 text-sm font-bold text-zinc-950">
              {user?.avatar_url ? (
                <img
                  src={resolveAssetUrl(user.avatar_url, config?.assetBase)}
                  alt={user?.display_name || user?.username || "avatar"}
                  className="h-full w-full object-cover"
                />
              ) : (
                user?.display_name?.[0]?.toUpperCase() || "?"
              )}
            </div>
            <div
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0A0A0A]"
              style={{ backgroundColor: currentStatus.color }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-white">{user?.display_name}</p>
            <p className="truncate text-[10px] text-[#71717A]">@{user?.username}</p>
          </div>
          <CaretDown size={12} className="shrink-0 text-[#71717A]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-panel-solid w-56 text-white" side="top" align="start">
        {statusOptions.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => changeStatus(option.value)}
              data-testid={`status-${option.value}`}
              className={`cursor-pointer ${status === option.value ? "text-white" : "text-zinc-400"}`}
            >
              <Icon size={14} weight="fill" style={{ color: option.color }} className="mr-2" />
              {option.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
