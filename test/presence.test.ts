import { afterEach, describe, expect, it } from 'vitest';
import {
  addUserConnection,
  getOnlineUserIds,
  isUserOnline,
  removeUserConnection,
} from '../src/realtime/presence.js';

const connections: Array<[string, string]> = [];

afterEach(() => {
  connections.forEach(([userId, socketId]) => removeUserConnection(userId, socketId));
  connections.length = 0;
});

describe('process-local presence registry', () => {
  it('keeps a user online until the final tab/device disconnects', () => {
    connections.push(['user-a', 'socket-a1'], ['user-a', 'socket-a2']);

    expect(addUserConnection('user-a', 'socket-a1')).toBe(true);
    expect(addUserConnection('user-a', 'socket-a2')).toBe(false);
    expect(isUserOnline('user-a')).toBe(true);
    expect(removeUserConnection('user-a', 'socket-a1')).toBe(false);
    expect(isUserOnline('user-a')).toBe(true);
    expect(removeUserConnection('user-a', 'socket-a2')).toBe(true);
    expect(isUserOnline('user-a')).toBe(false);
  });

  it('lists only currently connected users', () => {
    connections.push(['user-b', 'socket-b1']);
    addUserConnection('user-b', 'socket-b1');

    expect(getOnlineUserIds()).toContain('user-b');
  });
});