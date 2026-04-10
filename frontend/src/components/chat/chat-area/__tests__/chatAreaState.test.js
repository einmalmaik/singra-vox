import {
  buildMessageItems,
  getPinRefreshKey,
  getReplyTarget,
  getTypingNames,
  mergeMessageIntoTimeline,
} from "../chatAreaState";

describe("chatAreaState", () => {
  it("merges a new message into the timeline in chronological order", () => {
    const merged = mergeMessageIntoTimeline(
      [
        { id: "m-2", created_at: "2026-04-11T10:05:00.000Z", content: "later" },
        { id: "m-1", created_at: "2026-04-11T10:00:00.000Z", content: "first" },
      ],
      { id: "m-3", created_at: "2026-04-11T10:03:00.000Z", content: "middle" },
    );

    expect(merged.map((message) => message.id)).toEqual(["m-1", "m-3", "m-2"]);
  });

  it("updates an existing message in place when the ids match", () => {
    const merged = mergeMessageIntoTimeline(
      [{ id: "m-1", created_at: "2026-04-11T10:00:00.000Z", content: "old" }],
      { id: "m-1", created_at: "2026-04-11T10:00:00.000Z", content: "new" },
    );

    expect(merged).toEqual([
      { id: "m-1", created_at: "2026-04-11T10:00:00.000Z", content: "new" },
    ]);
  });

  it("derives reply targets, pin refresh keys, typing names and decrypted display payloads", () => {
    const messages = [
      {
        id: "m-1",
        author_id: "user-1",
        created_at: "2026-04-11T10:00:00.000Z",
        content: "hello",
        is_pinned: true,
        attachments: [],
        reactions: {},
      },
      {
        id: "m-2",
        author_id: "user-1",
        created_at: "2026-04-11T10:02:00.000Z",
        content: "[Encrypted message]",
        is_e2ee: true,
        reply_to_id: "m-1",
        attachments: [],
        reactions: {},
      },
    ];

    const items = buildMessageItems({
      messages,
      decryptedPayloads: {
        "m-2": {
          text: "decrypted hello",
          attachments: [{ id: "blob-1", name: "secret.png" }],
        },
      },
      replyTargets: {},
      highlightedMessageId: "m-2",
    });

    expect(getReplyTarget({ replyToId: "m-1", messages, replyTargets: {} })?.id).toBe("m-1");
    expect(getPinRefreshKey(messages)).toBe("m-1");
    expect(getTypingNames({ a: "Alice", b: "Bob" })).toEqual(["Alice", "Bob"]);
    expect(items[1].displayContent).toBe("decrypted hello");
    expect(items[1].displayAttachments).toEqual([{ id: "blob-1", name: "secret.png" }]);
    expect(items[1].isHighlighted).toBe(true);
    expect(items[1].compact).toBe(true);
  });
});
