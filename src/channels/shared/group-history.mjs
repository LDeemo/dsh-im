export function groupHistoryAttachments(message) {
  const attachments = [];
  for (const [type, sources] of [['image', message?.images], ['file', message?.files]]) {
    for (const [index, source] of (sources ?? []).entries()) {
      attachments.push({ ...source, key: `${type}:${index}`,
        name: source.name ?? source.fileName ?? `${type}-${index + 1}`,
        mediaType: source.mediaType ?? source.mimeType,
        load: source.loadStream ?? source.load,
      });
    }
  }
  return attachments;
}

export function groupHistoryEntry(channel, raw, message, { scope = '', groupName } = {}) {
  const common = { channel, scope, groupName, senderId: message.senderId,
    senderName: message.contextSource?.()?.senderName, attachments: groupHistoryAttachments(message) };
  if (channel === 'whatsapp') return { ...common, groupId: raw.key?.remoteJid,
    messageId: raw.key?.id, sentAt: Number(raw.messageTimestamp) * 1000, text: message.content,
    type: message.files?.length ? 'file' : message.images?.length ? 'image' : 'text' };
  if (channel === 'telegram') {
    const item = raw.message;
    return { ...common, groupId: String(item.chat.id), groupName: item.chat.title,
      messageId: String(item.message_id), sentAt: item.date * 1000, text: item.text ?? item.caption ?? '',
      threadId: item.message_thread_id === undefined ? undefined : String(item.message_thread_id),
      replyToMessageId: item.reply_to_message?.message_id === undefined ? undefined : String(item.reply_to_message.message_id),
      type: item.document ? 'file' : item.photo ? 'image' : 'text',
      capability: '关闭 Privacy Mode 或设为群管理员后才能接收普通群消息；只保存平台实际投递的消息。' };
  }
  if (channel === 'discord') return { ...common, scope: String(raw.guild_id ?? ''), groupId: raw.channel_id,
    messageId: raw.id, sentAt: raw.timestamp, text: raw.content ?? '', type: raw.attachments?.length ? 'file' : 'text',
    replyToMessageId: raw.message_reference?.message_id,
    capability: '需要频道访问权限及 MESSAGE_CONTENT；未授权时正文和附件可能为空。' };
  if (channel === 'slack') return { ...common, scope: raw.team_id ?? scope, groupId: raw.event.channel,
    messageId: raw.event.ts, sentAt: Math.floor(Number(raw.event.ts) * 1000), text: raw.event.text ?? '',
    type: raw.event.files?.length ? 'file' : 'text', threadId: raw.event.thread_ts,
    capability: '需订阅 message.channels / message.groups，并已加入目标频道。' };
  if (channel === 'wecom') {
    // The body of a WeCom callback: `chatid` for a group, `from.userid` for a direct message. A smart
    // bot only receives what was sent to it, so this records addressed traffic and nothing else —
    // there is no room to observe, and the note says so rather than pretending otherwise.
    const chatType = raw.chattype === 'group' ? 'group' : 'single';
    const groupId = chatType === 'group' ? String(raw.chatid ?? '') : String(raw.from?.userid ?? '');
    return {
      ...common,
      scope,
      groupId,
      // The sender comes from the callback body, not from the parsed message: `message.senderId` is
      // not set on this path, and a missing senderId makes the store drop the entry silently.
      senderId: String(raw.from?.userid ?? common.senderId ?? ''),
      messageId: String(raw.msgid ?? ''),
      sentAt: Number.isFinite(Number(raw.send_time)) ? Number(raw.send_time) * 1000 : Date.now(),
      text: message.content ?? '',
      type: message.files?.length ? 'file' : message.images?.length ? 'image' : 'text',
      throwOnFail: true,
      capability: '智能机器人只能收到 @ 和私聊，看不到群里其他消息，因此没有主动观察。',
    };
  }
  return null;
}

/** Record received groups before the response gate, without requiring a mention or an AI session. */
export async function captureGroupHistory(store, message, entry, { logger = console } = {}) {
  if (!store || !entry || message?.kind !== 'group') return message;
  try {
    const context = await store.capture({ ...entry,
      senderId: entry.senderId ?? message.senderId,
      text: entry.text ?? message.content ?? '',
      attachments: entry.attachments ?? groupHistoryAttachments(message),
    });
    // A context is a live service reference, not a model-controlled group selector.
    if (context) message.groupHistory = context;
  } catch (error) {
    logger.warn?.('[dsh-im] unable to save group message:', error?.message ?? 'archive unavailable');
  }
  return message;
}
