/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MagnifyingGlass, X, Hash } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

export default function SearchDialog({ serverId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
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
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (v.length >= 2) {
      searchTimeoutRef.current = window.setTimeout(() => {
        void search(v);
      }, 300);
    } else {
      setResults([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="workspace-icon-button" data-testid="search-button">
          <MagnifyingGlass size={18} weight="bold" />
        </button>
      </DialogTrigger>
      <DialogContent className="workspace-panel-solid max-h-[70vh] max-w-lg text-white">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "Manrope" }}>{t("search.title")}</DialogTitle>
        </DialogHeader>
        <div className="relative mt-2">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query} onChange={handleChange} placeholder={t("search.placeholder")} autoFocus
            data-testid="search-input"
            className="h-12 rounded-2xl border-white/10 bg-zinc-950/75 pl-9 text-white focus-visible:ring-cyan-400/40"
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto mt-3 space-y-1 min-h-[200px]">
          {searching && (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
            </div>
          )}
          {!searching && results.length === 0 && query.length >= 2 && (
            <p className="py-8 text-center text-sm text-zinc-500">{t("search.noResults")}</p>
          )}
          {!searching && results.map(msg => (
            <div key={msg.id} className="workspace-card cursor-pointer p-3 transition-colors hover:border-cyan-400/20 hover:bg-white/[0.04]" data-testid={`search-result-${msg.id}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-white">{msg.author?.display_name}</span>
                <span className="text-[10px] text-zinc-600">{t("search.inChannel")}</span>
                <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                  <Hash size={10} /> {msg.channel?.name}
                </span>
                <span className="text-[10px] text-zinc-600">{new Date(msg.created_at).toLocaleString()}</span>
              </div>
              <p className="line-clamp-2 text-sm text-zinc-200">{msg.content}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
