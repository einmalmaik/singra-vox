import { useState } from "react";
import {
  Hash, SpeakerHigh, Lock, Plus, GearSix, Microphone, MicrophoneSlash,
  SpeakerSlash, CaretDown, CaretRight, UserPlus
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api from "@/lib/api";
import { toast } from "sonner";
import InviteModal from "@/components/modals/InviteModal";
import ServerSettingsModal from "@/components/modals/ServerSettingsModal";

export default function ChannelSidebar({ server, channels, currentChannel, onSelectChannel, onRefreshChannels, user, members, roles, onRefreshMembers }) {
  const [showCreate, setShowCreate] = useState(false);
  const [chName, setChName] = useState("");
  const [chType, setChType] = useState("text");
  const [creating, setCreating] = useState(false);
  const [textCollapsed, setTextCollapsed] = useState(false);
  const [voiceCollapsed, setVoiceCollapsed] = useState(false);

  // Voice state
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  const textChannels = channels.filter(c => c.type === "text");
  const voiceChannels = channels.filter(c => c.type === "voice");

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!chName.trim()) return;
    setCreating(true);
    try {
      await api.post(`/servers/${server.id}/channels`, { name: chName.trim(), type: chType });
      toast.success("Channel created!");
      setShowCreate(false);
      setChName("");
      onRefreshChannels();
    } catch (err) {
      toast.error("Failed to create channel");
    } finally {
      setCreating(false);
    }
  };

  const joinVoice = async (channel) => {
    try {
      await api.post(`/servers/${server.id}/voice/${channel.id}/join`);
      setVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      onRefreshChannels();
    } catch (err) {
      toast.error("Failed to join voice channel");
    }
  };

  const leaveVoice = async () => {
    if (!voiceChannel) return;
    try {
      await api.post(`/servers/${server.id}/voice/${voiceChannel.id}/leave`);
      setVoiceChannel(null);
      onRefreshChannels();
    } catch {}
  };

  const toggleMute = async () => {
    if (!voiceChannel) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    try {
      await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_muted: newMuted });
    } catch {}
  };

  const toggleDeafen = async () => {
    if (!voiceChannel) return;
    const newDeaf = !isDeafened;
    setIsDeafened(newDeaf);
    try {
      await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_deafened: newDeaf });
    } catch {}
  };

  return (
    <div className="w-[240px] bg-[#121212] border-r border-[#27272A]/40 flex flex-col shrink-0" data-testid="channel-sidebar">
      {/* Server header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
        <h3 className="text-sm font-bold text-white truncate" style={{ fontFamily: 'Manrope' }} data-testid="server-name-header">
          {server?.name}
        </h3>
        <div className="flex items-center gap-1">
          <InviteModal serverId={server?.id} />
          <ServerSettingsModal server={server} members={members} roles={roles} onRefresh={() => { onRefreshChannels(); onRefreshMembers(); }} user={user} />
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {/* Text Channels */}
        <button onClick={() => setTextCollapsed(!textCollapsed)}
          className="flex items-center gap-1 px-2 py-1 text-[#71717A] text-xs font-bold uppercase tracking-[0.2em] hover:text-[#A1A1AA] w-full">
          {textCollapsed ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
          Text Channels
        </button>
        {!textCollapsed && textChannels.map(ch => (
          <button
            key={ch.id}
            onClick={() => onSelectChannel(ch)}
            data-testid={`channel-${ch.name}`}
            className={`channel-item w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${
              currentChannel?.id === ch.id ? 'active text-white' : 'text-[#A1A1AA]'
            }`}
          >
            {ch.is_private ? <Lock size={16} weight="bold" className="text-[#71717A] shrink-0" /> :
              <Hash size={16} weight="bold" className="text-[#71717A] shrink-0" />}
            <span className="truncate">{ch.name}</span>
          </button>
        ))}

        {/* Voice Channels */}
        <button onClick={() => setVoiceCollapsed(!voiceCollapsed)}
          className="flex items-center gap-1 px-2 py-1 mt-3 text-[#71717A] text-xs font-bold uppercase tracking-[0.2em] hover:text-[#A1A1AA] w-full">
          {voiceCollapsed ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
          Voice Channels
        </button>
        {!voiceCollapsed && voiceChannels.map(ch => (
          <div key={ch.id}>
            <button
              onClick={() => joinVoice(ch)}
              data-testid={`voice-channel-${ch.name}`}
              className={`channel-item w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${
                voiceChannel?.id === ch.id ? 'active text-white' : 'text-[#A1A1AA]'
              }`}
            >
              <SpeakerHigh size={16} weight="bold" className="text-[#71717A] shrink-0" />
              <span className="truncate">{ch.name}</span>
            </button>
            {/* Voice participants */}
            {ch.voice_states?.length > 0 && (
              <div className="pl-8 space-y-0.5">
                {ch.voice_states.map(vs => (
                  <div key={vs.user_id} className="flex items-center gap-2 py-0.5 text-xs text-[#A1A1AA]">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                      voiceChannel?.id === ch.id ? 'bg-[#6366F1] voice-active' : 'bg-[#27272A]'
                    }`}>
                      {vs.user?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="truncate">{vs.user?.display_name || 'User'}</span>
                    {vs.is_muted && <MicrophoneSlash size={12} className="text-[#EF4444]" />}
                    {vs.is_deafened && <SpeakerSlash size={12} className="text-[#EF4444]" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Create channel button */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <button data-testid="create-channel-button"
              className="flex items-center gap-2 px-2 py-1.5 mt-2 text-[#71717A] hover:text-[#A1A1AA] text-sm w-full rounded-md hover:bg-[#27272A]/30 transition-colors">
              <Plus size={14} weight="bold" />
              <span>Add Channel</span>
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-sm">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: 'Manrope' }}>Create Channel</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateChannel} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Channel Name</Label>
                <Input value={chName} onChange={e => setChName(e.target.value)} placeholder="new-channel" data-testid="new-channel-name"
                  className="bg-[#121212] border-[#27272A] focus:border-[#6366F1] text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Type</Label>
                <Select value={chType} onValueChange={setChType}>
                  <SelectTrigger className="bg-[#121212] border-[#27272A] text-white" data-testid="channel-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#18181B] border-[#27272A] text-white">
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="voice">Voice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={creating || !chName.trim()} data-testid="create-channel-submit"
                className="w-full bg-[#6366F1] hover:bg-[#4F46E5]">
                {creating ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Voice controls (when in voice) */}
      {voiceChannel && (
        <div className="border-t border-[#27272A] p-3 bg-[#0A0A0A]" data-testid="voice-controls">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#22C55E] voice-active" />
            <span className="text-xs text-[#22C55E] font-medium">Voice Connected</span>
          </div>
          <p className="text-xs text-[#71717A] mb-2 truncate">{voiceChannel.name}</p>
          <div className="flex gap-2">
            <button onClick={toggleMute} data-testid="voice-mute-toggle"
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isMuted ? 'bg-[#EF4444]/20 text-[#EF4444]' : 'bg-[#27272A] text-[#A1A1AA] hover:text-white'
              }`}>
              {isMuted ? <MicrophoneSlash size={14} /> : <Microphone size={14} />}
              {isMuted ? 'Muted' : 'Mute'}
            </button>
            <button onClick={toggleDeafen} data-testid="voice-deafen-toggle"
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isDeafened ? 'bg-[#EF4444]/20 text-[#EF4444]' : 'bg-[#27272A] text-[#A1A1AA] hover:text-white'
              }`}>
              {isDeafened ? <SpeakerSlash size={14} /> : <SpeakerHigh size={14} />}
              {isDeafened ? 'Deaf' : 'Deafen'}
            </button>
            <button onClick={leaveVoice} data-testid="voice-disconnect"
              className="px-3 py-1.5 rounded-md bg-[#EF4444]/20 text-[#EF4444] text-xs font-medium hover:bg-[#EF4444]/30 transition-colors">
              Leave
            </button>
          </div>
        </div>
      )}

      {/* User bar */}
      <div className="h-[52px] flex items-center gap-2 px-3 border-t border-[#27272A] bg-[#0A0A0A] shrink-0" data-testid="user-bar">
        <div className="w-8 h-8 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-sm font-bold">
          {user?.display_name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user?.display_name}</p>
          <p className="text-[10px] text-[#71717A] truncate">@{user?.username}</p>
        </div>
      </div>
    </div>
  );
}
