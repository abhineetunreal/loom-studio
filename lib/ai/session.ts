// AI session management — CRUD for multi-turn conversation state.

import { db } from "@/lib/db";

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  // tool_use and tool_result are stored in Anthropic's native format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks?: any[];
  timestamp: string;
};

/**
 * Create a new AI chat session.
 */
export async function createAiSession(tenantId: string, platformUserId: string, designId?: string) {
  return db.aiSession.create({
    data: {
      tenantId,
      platformUserId,
      designId: designId ?? null,
      title: designId ? "Design recolor session" : "New session",
    },
  });
}

/**
 * Get an existing session with its message history.
 */
export async function getAiSession(sessionId: string, platformUserId: string) {
  return db.aiSession.findFirst({
    where: { id: sessionId, platformUserId, isActive: true },
  });
}

/**
 * List active sessions for a user.
 */
export async function listAiSessions(platformUserId: string, tenantId: string, limit = 20) {
  return db.aiSession.findMany({
    where: { platformUserId, tenantId, isActive: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      designId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Append messages to session history and update title if needed.
 */
export async function appendMessages(
  sessionId: string,
  newMessages: StoredMessage[],
  title?: string,
) {
  const session = await db.aiSession.findUnique({
    where: { id: sessionId },
    select: { messages: true },
  });
  if (!session) throw new Error("Session not found");

  const existing = (session.messages as StoredMessage[]) ?? [];
  const updated = [...existing, ...newMessages];

  return db.aiSession.update({
    where: { id: sessionId },
    data: {
      messages: updated as unknown as object[],
      ...(title ? { title } : {}),
    },
  });
}

/**
 * Archive a session (soft delete).
 */
export async function archiveAiSession(sessionId: string, platformUserId: string) {
  return db.aiSession.updateMany({
    where: { id: sessionId, platformUserId },
    data: { isActive: false },
  });
}
