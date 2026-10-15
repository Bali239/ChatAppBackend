const socketsByUser = new Map<string, Set<string>>();

export function addUserConnection(userId: string, socketId: string): boolean {
  const userSockets = socketsByUser.get(userId) ?? new Set<string>();
  const wasOffline = userSockets.size === 0;
  userSockets.add(socketId);
  socketsByUser.set(userId, userSockets);
  return wasOffline;
}

export function removeUserConnection(userId: string, socketId: string): boolean {
  const userSockets = socketsByUser.get(userId);
  if (!userSockets) return false;

  userSockets.delete(socketId);
  if (userSockets.size > 0) return false;

  socketsByUser.delete(userId);
  return true;
}

export function isUserOnline(userId: string): boolean {
  return (socketsByUser.get(userId)?.size ?? 0) > 0;
}

export function getOnlineUserIds(): string[] {
  return [...socketsByUser.keys()];
}