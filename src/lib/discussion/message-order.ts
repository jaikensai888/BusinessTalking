export interface ProcessMessageRef {
  id: string;
  role: string;
  sender: string;
  turn: number;
  sessionId?: string | null;
}

export interface ProcessTurnRef {
  key: string;
  sessionId: string;
  turnNumber?: number;
  hasFinalMessage: boolean;
}

export interface ProcessParticipantRef {
  sessionId: string;
  personaName: string;
}

/**
 * Pair each persisted persona message with its DSH process row before the UI
 * renders either list. A process row that has been paired is never emitted as
 * a trailing orphan, so the process always appears directly before its reply.
 */
export function assignProcessTurns(
  messages: readonly ProcessMessageRef[],
  turns: readonly ProcessTurnRef[],
  participants: readonly ProcessParticipantRef[],
): Map<string, string> {
  const usedTurnKeys = new Set<string>();
  const assignments = new Map<string, string>();
  const pending = messages.flatMap((message) => {
    if (message.role === "user" || message.role === "summary") return [];
    const sessionId = message.sessionId?.trim()
      || participants.find((participant) => participant.personaName === message.sender)?.sessionId;
    return sessionId ? [{ message, sessionId }] : [];
  });

  // Reserve explicit round matches first. A transient turn=0 message must not
  // consume a later process row that another message identifies exactly.
  for (const { message, sessionId } of pending) {
    if (message.turn <= 0) continue;
    const candidates = turns.filter((turn) => turn.sessionId === sessionId && !usedTurnKeys.has(turn.key));
    const exact = candidates.find((turn) => turn.turnNumber === message.turn);
    if (exact) {
      usedTurnKeys.add(exact.key);
      assignments.set(message.id, exact.key);
    }
  }

  const unassignedCountBySession = new Map<string, number>();
  for (const { message, sessionId } of pending) {
    if (!assignments.has(message.id)) {
      unassignedCountBySession.set(sessionId, (unassignedCountBySession.get(sessionId) ?? 0) + 1);
    }
  }

  for (const { message, sessionId } of pending) {
    if (assignments.has(message.id)) continue;
    const candidates = turns.filter((turn) => turn.sessionId === sessionId && !usedTurnKeys.has(turn.key));
    if (candidates.length === 0) continue;

    // If only one message is waiting for a row, a completed row is the best
    // signal when older process rows are still present in the replay.
    const selected = unassignedCountBySession.get(sessionId) === 1
      ? candidates.find((turn) => turn.hasFinalMessage) ?? candidates.at(-1)!
      : candidates[0];
    usedTurnKeys.add(selected.key);
    assignments.set(message.id, selected.key);
  }

  return assignments;
}
