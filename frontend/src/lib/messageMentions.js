import React from "react";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqBy(items, keyBuilder) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyBuilder(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function findActiveMention(content, cursorPosition = content.length) {
  const beforeCursor = content.slice(0, cursorPosition);
  const mentionStart = beforeCursor.lastIndexOf("@");
  if (mentionStart === -1) {
    return null;
  }

  const prefix = beforeCursor.slice(0, mentionStart);
  if (prefix.length > 0 && !/[\s([{\n]$/.test(prefix)) {
    return null;
  }

  const query = beforeCursor.slice(mentionStart + 1);
  if (query.includes("\n")) {
    return null;
  }

  return {
    start: mentionStart,
    end: cursorPosition,
    query,
  };
}

export function buildMentionSuggestions({ query, members = [], roles = [], permissions = {} }) {
  const normalizedQuery = (query || "").trim().toLowerCase();

  const userSuggestions = members
    .filter((member) => member.user?.username)
    .map((member) => ({
      key: `user:${member.user_id}`,
      type: "user",
      id: member.user_id,
      label: member.user.username,
      description: member.user.display_name ? member.user.display_name : `@${member.user.username}`,
      insertText: member.user.username,
    }))
    .filter((item) => (
      normalizedQuery.length === 0
      || item.label.toLowerCase().includes(normalizedQuery)
      || item.description.toLowerCase().includes(normalizedQuery)
    ));

  const roleSuggestions = roles
    .filter((role) => !role.is_default)
    .filter((role) => role.mentionable || permissions.mention_everyone)
    .map((role) => ({
      key: `role:${role.id}`,
      type: "role",
      id: role.id,
      label: role.name,
      description: role.mentionable ? "Mentionable role" : "Requires mention permission",
      insertText: role.name,
      color: role.color,
    }))
    .filter((item) => normalizedQuery.length === 0 || item.label.toLowerCase().includes(normalizedQuery));

  const everyoneSuggestions = permissions.mention_everyone
    && (normalizedQuery.length === 0 || "everyone".includes(normalizedQuery))
    ? [{
        key: "everyone",
        type: "everyone",
        id: "everyone",
        label: "everyone",
        description: "Notify everyone in this server",
        insertText: "everyone",
      }]
    : [];

  return [
    ...everyoneSuggestions,
    ...uniqBy(userSuggestions, (item) => item.key),
    ...uniqBy(roleSuggestions, (item) => item.key),
  ].slice(0, 8);
}

export function applyMentionSuggestion(content, mention, suggestion) {
  const replacement = `@${suggestion.insertText} `;
  return {
    nextContent: `${content.slice(0, mention.start)}${replacement}${content.slice(mention.end)}`,
    nextCursorPosition: mention.start + replacement.length,
  };
}

export function normalizeSelectedMentions(selectedMentions, content) {
  return selectedMentions.filter((item) => content.includes(`@${item.insertText}`));
}

export function buildMentionPayload(selectedMentions, content) {
  const activeMentions = normalizeSelectedMentions(selectedMentions, content);
  return {
    mentioned_user_ids: activeMentions.filter((item) => item.type === "user").map((item) => item.id),
    mentioned_role_ids: activeMentions.filter((item) => item.type === "role").map((item) => item.id),
    mentions_everyone: activeMentions.some((item) => item.type === "everyone"),
  };
}

export function renderMessageContent(content = "", message = {}) {
  const mentionedUsers = (message.mentioned_users || []).map((entry) => `@${entry.username}`);
  const mentionedRoles = (message.mentioned_roles || []).map((entry) => `@${entry.name}`);
  const explicitMentionTokens = uniqBy(
    [
      ...(message.mentions_everyone ? ["@everyone"] : []),
      ...mentionedUsers,
      ...mentionedRoles,
    ],
    (entry) => entry.toLowerCase(),
  );

  if (explicitMentionTokens.length === 0) {
    return content.split(/(@\w+)/g).map((part, index) => (
      part.startsWith("@")
        ? <span key={`${part}-${index}`} className="rounded px-0.5 font-medium text-[#6366F1] bg-[#6366F1]/10">{part}</span>
        : <span key={`${part}-${index}`}>{part}</span>
    ));
  }

  const tokenPattern = explicitMentionTokens
    .sort((left, right) => right.length - left.length)
    .map((token) => escapeRegExp(token))
    .join("|");

  const matcher = new RegExp(`(${tokenPattern})`, "g");
  return content.split(matcher).map((part, index) => {
    const isMention = explicitMentionTokens.some((token) => token.toLowerCase() === part.toLowerCase());
    if (!isMention) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    const isEveryone = part.toLowerCase() === "@everyone";
    return (
      <span
        key={`${part}-${index}`}
        className={`rounded px-0.5 font-medium ${
          isEveryone ? "bg-[#EF4444]/12 text-[#F87171]" : "bg-[#6366F1]/10 text-[#818CF8]"
        }`}
      >
        {part}
      </span>
    );
  });
}
