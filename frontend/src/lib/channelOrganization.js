/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { arrayMove } from "@dnd-kit/sortable";

export const ROOT_CHANNEL_CONTAINER_ID = "__root__";
export const CHANNEL_CONTAINER_DROP_PREFIX = "channel-container:";

export function sortChannelsByPosition(list = []) {
  return [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function getContainerDropId(containerId) {
  return `${CHANNEL_CONTAINER_DROP_PREFIX}${containerId}`;
}

export function parseContainerDropId(dropId) {
  if (typeof dropId !== "string" || !dropId.startsWith(CHANNEL_CONTAINER_DROP_PREFIX)) {
    return null;
  }
  return dropId.slice(CHANNEL_CONTAINER_DROP_PREFIX.length) || null;
}

export function buildChannelOrganization(channels = []) {
  const sortedChannels = sortChannelsByPosition(channels);
  const byId = Object.fromEntries(sortedChannels.map((channel) => [channel.id, channel]));
  const childIdsByCategory = {};

  for (const channel of sortedChannels) {
    if (channel.type === "category") {
      childIdsByCategory[channel.id] = [];
    }
  }

  const rootIds = [];
  for (const channel of sortedChannels) {
    if (!channel.parent_id) {
      rootIds.push(channel.id);
      continue;
    }

    // Deleted categories may briefly leave orphaned children behind until the
    // next websocket refresh arrives. Rendering them at the root level keeps
    // the UI usable instead of silently dropping them from view.
    if (!childIdsByCategory[channel.parent_id]) {
      rootIds.push(channel.id);
      continue;
    }

    childIdsByCategory[channel.parent_id].push(channel.id);
  }

  return {
    byId,
    rootIds,
    topLevelItems: rootIds.map((id) => byId[id]).filter(Boolean),
    childIdsByCategory,
  };
}

export function getContainerIdForChannel(channel) {
  if (!channel) {
    return null;
  }
  if (channel.type === "category") {
    return ROOT_CHANNEL_CONTAINER_ID;
  }
  return channel.parent_id || ROOT_CHANNEL_CONTAINER_ID;
}

export function getContainerItemIds(organization, containerId) {
  if (containerId === ROOT_CHANNEL_CONTAINER_ID) {
    return organization.rootIds;
  }
  return organization.childIdsByCategory[containerId] || [];
}

function getInsertIndex(items, overId) {
  if (!overId) {
    return items.length;
  }
  const overIndex = items.indexOf(overId);
  return overIndex < 0 ? items.length : overIndex;
}

function buildChangedPayload(organization, containerUpdates) {
  const payload = [];

  for (const [containerId, itemIds] of Object.entries(containerUpdates)) {
    const parentId = containerId === ROOT_CHANNEL_CONTAINER_ID ? null : containerId;

    itemIds.forEach((itemId, position) => {
      const channel = organization.byId[itemId];
      if (!channel) {
        return;
      }

      payload.push({
        id: itemId,
        parent_id: channel.type === "category" ? null : parentId,
        position,
      });
    });
  }

  return payload.filter((item) => {
    const original = organization.byId[item.id];
    if (!original) {
      return false;
    }

    const originalParentId = original.type === "category" ? null : (original.parent_id || null);
    return originalParentId !== item.parent_id || (original.position ?? 0) !== item.position;
  });
}

export function computeChannelReorderPayload({
  channels,
  activeId,
  overId = null,
  overContainerId = null,
}) {
  const organization = buildChannelOrganization(channels);
  const activeChannel = organization.byId[activeId];

  if (!activeChannel) {
    return [];
  }

  const sourceContainerId = getContainerIdForChannel(activeChannel);
  if (!sourceContainerId) {
    return [];
  }

  let targetContainerId = overContainerId;
  if (!targetContainerId && overId) {
    targetContainerId = getContainerIdForChannel(organization.byId[overId]);
  }
  if (!targetContainerId) {
    targetContainerId = sourceContainerId;
  }

  if (activeChannel.type === "category" && targetContainerId !== ROOT_CHANNEL_CONTAINER_ID) {
    return [];
  }

  const sourceItems = getContainerItemIds(organization, sourceContainerId);
  const targetItems = getContainerItemIds(organization, targetContainerId);
  const sourceIndex = sourceItems.indexOf(activeId);

  if (sourceIndex < 0) {
    return [];
  }

  if (sourceContainerId === targetContainerId) {
    const targetIndex = getInsertIndex(sourceItems, overId);
    const reorderedItems = arrayMove(sourceItems, sourceIndex, targetIndex);
    return buildChangedPayload(organization, {
      [sourceContainerId]: reorderedItems,
    });
  }

  const nextSourceItems = sourceItems.filter((itemId) => itemId !== activeId);
  const nextTargetItems = [...targetItems];
  nextTargetItems.splice(getInsertIndex(targetItems, overId), 0, activeId);

  return buildChangedPayload(organization, {
    [sourceContainerId]: nextSourceItems,
    [targetContainerId]: nextTargetItems,
  });
}
