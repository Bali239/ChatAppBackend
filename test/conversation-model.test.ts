import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Conversation, createParticipantKey } from '../src/models/conversation.model.js';
import { ConversationMember } from '../src/models/conversation-member.model.js';
import { MAX_MESSAGE_LENGTH, Message } from '../src/models/message.model.js';

describe('Conversation model', () => {
  it('requires two distinct participants and builds a stable canonical key', async () => {
    const firstParticipant = new mongoose.Types.ObjectId();
    const secondParticipant = new mongoose.Types.ObjectId();
    const conversation = new Conversation({
      type: 'direct',
      participantIds: [secondParticipant, firstParticipant],
      participantKey: createParticipantKey([
        secondParticipant.toString(),
        firstParticipant.toString(),
      ]),
    });

    await expect(conversation.validate()).resolves.toBeUndefined();
    expect(
      createParticipantKey([firstParticipant.toString(), secondParticipant.toString()]),
    ).toBe(conversation.participantKey);
    expect(Conversation.schema.indexes().map(([keys, options]) => ({ keys, options }))).toContainEqual({
      keys: { participantKey: 1 },
      options: expect.objectContaining({ unique: true, name: 'unique_direct_participants' }),
    });
  });

  it('rejects duplicate or missing participants', async () => {
    const participantId = new mongoose.Types.ObjectId();
    const duplicate = new Conversation({
      participantIds: [participantId, participantId],
      participantKey: 'duplicate',
    });
    const missing = new Conversation({ participantIds: [], participantKey: 'missing' });

    await expect(duplicate.validate()).rejects.toThrow(/two distinct participants/);
    await expect(missing.validate()).rejects.toThrow(/two distinct participants/);
  });

  it('keeps per-user cutoff/read state in a uniquely indexed member record', async () => {
    const member = new ConversationMember({
      conversationId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
    });
    await member.validate();

    expect(ConversationMember.schema.indexes().map(([keys, options]) => ({ keys, options }))).toContainEqual({
      keys: { conversationId: 1, userId: 1 },
      options: expect.objectContaining({ unique: true }),
    });
  });

  it('trims text messages and enforces the scoped idempotency index', async () => {
    const message = new Message({
      conversationId: new mongoose.Types.ObjectId(),
      senderId: new mongoose.Types.ObjectId(),
      senderSnapshot: { displayName: 'Sender', avatarUrl: null },
      content: '  hello  ',
      clientMessageId: 'message_key_1',
    });
    await message.validate();

    expect(message.content).toBe('hello');
    expect(Message.schema.path('content').options.maxlength).toBe(MAX_MESSAGE_LENGTH);
    expect(Message.schema.indexes().map(([keys, options]) => ({ keys, options }))).toContainEqual({
      keys: { conversationId: 1, senderId: 1, clientMessageId: 1 },
      options: expect.objectContaining({ unique: true }),
    });

    const empty = new Message({
      conversationId: new mongoose.Types.ObjectId(),
      senderId: new mongoose.Types.ObjectId(),
      senderSnapshot: { displayName: 'Sender' },
      content: '   ',
      clientMessageId: 'message_key_2',
    });
    await expect(empty.validate()).rejects.toThrow();
  });
});