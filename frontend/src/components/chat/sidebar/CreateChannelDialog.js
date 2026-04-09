/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROOT_PARENT_ID } from "./channelSidebarUtils";

export default function CreateChannelDialog({
  open,
  onOpenChange,
  channelName,
  channelType,
  parentId,
  categories,
  creating,
  onChannelNameChange,
  onChannelTypeChange,
  onParentIdChange,
  onSubmit,
  t,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-panel-solid max-w-sm text-white">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "Manrope" }}>
            {channelType === "category" ? t("serverSettings.createCategory") : t("channel.addChannel")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="workspace-section-label">
              {channelType === "category" ? t("serverSettings.categoryName") : t("serverSettings.channelName")}
            </Label>
            <Input
              value={channelName}
              onChange={(event) => onChannelNameChange(event.target.value)}
              placeholder={channelType === "category" ? t("serverSettings.newCategoryPlaceholder") : t("serverSettings.createChannelPlaceholder")}
              className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus-visible:border-cyan-400/50 focus-visible:ring-cyan-400/40"
            />
          </div>
          <div className="space-y-2">
            <Label className="workspace-section-label">{t("common.type")}</Label>
            <Select value={channelType} onValueChange={onChannelTypeChange}>
              <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus:border-cyan-400/50 focus:ring-cyan-400/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-900 text-white">
                <SelectItem value="text">{t("serverSettings.channelTypeText")}</SelectItem>
                <SelectItem value="voice">{t("serverSettings.channelTypeVoice")}</SelectItem>
                <SelectItem value="category">{t("serverSettings.channelTypeCategory")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {channelType !== "category" && (
            <div className="space-y-2">
              <Label className="workspace-section-label">{t("common.category")}</Label>
              <Select value={parentId} onValueChange={onParentIdChange}>
                <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus:border-cyan-400/50 focus:ring-cyan-400/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-900 text-white">
                  <SelectItem value={ROOT_PARENT_ID}>{t("common.noCategory")}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button type="submit" disabled={creating || !channelName.trim()} className="w-full rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300 font-semibold">
            {creating ? t("server.creating") : t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
