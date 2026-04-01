import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Circle, Moon, MinusCircle, Prohibit, Microphone, SpeakerHigh,
  Keyboard, CaretDown
} from "@phosphor-icons/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import api from "@/lib/api";
import { toast } from "sonner";

export default function UserStatusPanel({ user, voiceEngineRef }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(user?.status || "online");
  const [pttEnabled, setPttEnabled] = useState(false);
  const [pttKey, setPttKey] = useState("Space");
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [listeningForKey, setListeningForKey] = useState(false);
  const statusOptions = [
    { value: "online", label: t("statusMenu.online"), icon: Circle, color: "#22C55E" },
    { value: "away", label: t("statusMenu.away"), icon: Moon, color: "#F59E0B" },
    { value: "dnd", label: t("statusMenu.dnd"), icon: MinusCircle, color: "#EF4444" },
    { value: "offline", label: t("statusMenu.invisible"), icon: Prohibit, color: "#71717A" },
  ];

  // Load audio devices
  useEffect(() => {
    loadDevices();
  }, []);

  // PTT keyboard handler
  useEffect(() => {
    if (!pttEnabled || !voiceEngineRef?.current) return;
    voiceEngineRef.current.setPTT(true);

    const keyDown = (e) => {
      if (e.code === pttKey && !e.repeat) {
        voiceEngineRef.current?.setPTTActive(true);
      }
    };
    const keyUp = (e) => {
      if (e.code === pttKey) {
        voiceEngineRef.current?.setPTTActive(false);
      }
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      voiceEngineRef.current?.setPTT(false);
    };
  }, [pttEnabled, pttKey, voiceEngineRef]);

  // Listen for PTT key binding
  useEffect(() => {
    if (!listeningForKey) return;
    const handler = (e) => {
      e.preventDefault();
      setPttKey(e.code);
      setListeningForKey(false);
      toast.success(t("statusMenu.keySet", { key: e.code }));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [listeningForKey]);

  const loadDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter(d => d.kind === "audioinput"));
    } catch {}
  };

  const changeStatus = async (newStatus) => {
    setStatus(newStatus);
    try {
      await api.put("/users/me", { status: newStatus });
    } catch {}
  };

  const changeDevice = async (deviceId) => {
    setSelectedDevice(deviceId);
    const engine = voiceEngineRef?.current;
    if (engine) {
      try {
        await engine.init(deviceId);
        toast.success(t("statusMenu.audioDeviceChanged"));
      } catch {
        toast.error(t("statusMenu.audioDeviceFailed"));
      }
    }
  };

  const currentStatus = statusOptions.find(s => s.value === status) || statusOptions[0];
  const StatusIcon = currentStatus.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 w-full px-3 py-2 rounded-md hover:bg-[#27272A]/50 transition-colors text-left" data-testid="user-status-trigger">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-sm font-bold">
              {user?.display_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0A0A0A]"
              style={{ backgroundColor: currentStatus.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.display_name}</p>
            <p className="text-[10px] text-[#71717A] truncate">@{user?.username}</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-[#18181B] border-[#27272A] text-white w-56" side="top" align="start">
        {/* Status options */}
        {statusOptions.map(opt => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem key={opt.value} onClick={() => changeStatus(opt.value)}
              data-testid={`status-${opt.value}`}
              className={`cursor-pointer focus:bg-[#27272A] ${status === opt.value ? 'text-white' : 'text-[#A1A1AA]'}`}>
              <Icon size={14} weight="fill" style={{ color: opt.color }} className="mr-2" />
              {opt.label}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator className="bg-[#27272A]" />

        {/* PTT Toggle */}
            <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs text-[#A1A1AA] flex items-center gap-1.5">
            <Keyboard size={14} /> {t("statusMenu.pushToTalk")}
          </span>
          <Switch checked={pttEnabled} onCheckedChange={setPttEnabled} className="scale-75" data-testid="ptt-toggle" />
        </div>

        {pttEnabled && (
          <div className="px-2 pb-1.5">
            <button onClick={() => setListeningForKey(true)} data-testid="ptt-key-bind"
              className={`w-full text-xs px-2 py-1 rounded border text-center transition-colors ${
                listeningForKey
                  ? 'border-[#6366F1] text-[#6366F1] bg-[#6366F1]/10'
                  : 'border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]'
              }`}>
              {listeningForKey ? t("statusMenu.pressAnyKey") : t("statusMenu.keyLabel", { key: pttKey })}
            </button>
          </div>
        )}

        <DropdownMenuSeparator className="bg-[#27272A]" />

        {/* Audio Device Selection */}
        {audioDevices.length > 0 && (
            <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-[#A1A1AA] focus:bg-[#27272A] focus:text-white cursor-pointer">
              <Microphone size={14} className="mr-2" /> {t("statusMenu.inputDevice")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="bg-[#18181B] border-[#27272A] text-white">
              {audioDevices.map(d => (
                <DropdownMenuItem key={d.deviceId}
                  onClick={() => changeDevice(d.deviceId)}
                  data-testid={`audio-device-${d.deviceId}`}
                  className={`cursor-pointer text-xs focus:bg-[#27272A] ${
                    selectedDevice === d.deviceId ? 'text-[#6366F1]' : 'text-[#A1A1AA]'
                  }`}>
                  {d.label || t("statusMenu.microphone", { id: d.deviceId.slice(0, 8) })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
