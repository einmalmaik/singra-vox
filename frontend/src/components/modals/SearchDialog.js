import { useState, useCallback, useEffect } from "react";
import { MagnifyingGlass, X, Hash } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

export default function SearchDialog({ serverId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const search = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await api.get(`/search?q=${encodeURIComponent(q)}&server_id=${serverId || ''}`);
      setResults(res.data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [serverId]);

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    if (v.length >= 2) {
      const timeout = setTimeout(() => search(v), 300);
      return () => clearTimeout(timeout);
    } else {
      setResults([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 rounded hover:bg-[#27272A] text-[#71717A] hover:text-white transition-colors" data-testid="search-button">
          <MagnifyingGlass size={18} weight="bold" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-lg max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>Search Messages</DialogTitle>
        </DialogHeader>
        <div className="relative mt-2">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
          <Input
            value={query} onChange={handleChange} placeholder="Search messages..." autoFocus
            data-testid="search-input"
            className="bg-[#121212] border-[#27272A] text-white pl-9 focus:border-[#6366F1]"
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto mt-3 space-y-1 min-h-[200px]">
          {searching && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!searching && results.length === 0 && query.length >= 2 && (
            <p className="text-[#71717A] text-sm text-center py-8">No results found</p>
          )}
          {!searching && results.map(msg => (
            <div key={msg.id} className="p-3 rounded-md hover:bg-[#27272A]/50 transition-colors cursor-pointer" data-testid={`search-result-${msg.id}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-white">{msg.author?.display_name}</span>
                <span className="text-[10px] text-[#52525B]">in</span>
                <span className="flex items-center gap-0.5 text-[10px] text-[#71717A]">
                  <Hash size={10} /> {msg.channel?.name}
                </span>
                <span className="text-[10px] text-[#52525B]">{new Date(msg.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-[#E4E4E7] line-clamp-2">{msg.content}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
