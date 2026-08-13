/**
 * The server's memory of a single visit, and the reason the client no longer
 * gets to declare whether it was right.
 *
 * A guess is accepted once per (session, clip). The session's score is then
 * simply the number of accepted guesses that were correct — derived here, never
 * sent up from the browser. That also removes the read-after-write race the
 * reveal used to have: the same request that records the guess can answer with
 * the running score.
 *
 * Bounded on purpose. This is an anonymous, in-process cache, not storage: at
 * most MAX_SESSIONS live entries, each expiring after SESSION_TTL_MS. Nothing
 * is written to disk, and an id is forgotten long before a museum closes.
 */

import type { ClipLabel } from "@/lib/manifest-schema";

export const MAX_SESSIONS = 2_000;
export const MAX_GUESSES_PER_SESSION = 32;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface SessionScore {
  /** Distinct clips this session has answered. */
  answered: number;
  /** How many of those were right. */
  correct: number;
}

export interface AcceptedGuess {
  accepted: boolean;
  correct: boolean;
  score: SessionScore;
}

interface SessionRecord {
  guesses: Map<string, boolean>;
  finalScenario: boolean | null;
  lastSeen: number;
}

export class SessionLedger {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;

  constructor(maxSessions = MAX_SESSIONS, ttlMs = SESSION_TTL_MS) {
    this.maxSessions = maxSessions;
    this.ttlMs = ttlMs;
  }

  private touch(sessionId: string, now: number): SessionRecord {
    this.evictExpired(now);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastSeen = now;
      // Re-insert so Map iteration order stays least-recently-used first.
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, existing);
      return existing;
    }
    const created: SessionRecord = {
      guesses: new Map(),
      finalScenario: null,
      lastSeen: now,
    };
    this.sessions.set(sessionId, created);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) break;
      this.sessions.delete(oldest.value);
    }
    return created;
  }

  private evictExpired(now: number): void {
    for (const [id, record] of this.sessions) {
      if (now - record.lastSeen <= this.ttlMs) break; // LRU order: the rest are newer
      this.sessions.delete(id);
    }
  }

  /**
   * Records a guess and derives its correctness from the label the *manifest*
   * gave us. A repeat guess on the same clip is ignored, so a visitor cannot
   * inflate a clip's "fooled" percentage by tapping twice.
   */
  recordGuess(
    sessionId: string,
    clipId: string,
    guess: ClipLabel,
    label: ClipLabel,
    now: number,
  ): AcceptedGuess {
    const record = this.touch(sessionId, now);
    const correct = guess === label;

    if (record.guesses.has(clipId)) {
      return { accepted: false, correct: record.guesses.get(clipId)!, score: scoreOf(record) };
    }
    if (record.guesses.size >= MAX_GUESSES_PER_SESSION) {
      return { accepted: false, correct, score: scoreOf(record) };
    }

    record.guesses.set(clipId, correct);
    return { accepted: true, correct, score: scoreOf(record) };
  }

  /** The final scenario is answered once; a second answer does not overwrite it. */
  recordFinalScenario(
    sessionId: string,
    correct: boolean,
    now: number,
  ): { accepted: boolean; correct: boolean } {
    const record = this.touch(sessionId, now);
    if (record.finalScenario !== null) {
      return { accepted: false, correct: record.finalScenario };
    }
    record.finalScenario = correct;
    return { accepted: true, correct };
  }

  scoreFor(sessionId: string, now: number): SessionScore {
    const record = this.sessions.get(sessionId);
    if (!record || now - record.lastSeen > this.ttlMs) {
      return { answered: 0, correct: 0 };
    }
    return scoreOf(record);
  }

  /** A reset is a hard forget: the old id must leave no trace behind it. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }
}

function scoreOf(record: SessionRecord): SessionScore {
  let correct = 0;
  for (const wasRight of record.guesses.values()) {
    if (wasRight) correct += 1;
  }
  return { answered: record.guesses.size, correct };
}

export const sessionLedger = new SessionLedger();
