/**
 * Practical, privacy-preserving throttling for the one write endpoint.
 *
 * The demo's whole compliance story is "no personal data is stored", so the
 * limiter is keyed on the anonymous session id the request already carries —
 * never on an IP address, hashed or otherwise. A stuck kiosk (or a curious
 * visitor holding a button) is what this actually defends against, and a
 * session key catches that exactly. A second, global bucket keeps a swarm of
 * fresh session ids from filling the database.
 *
 * State is in-process and bounded: at most MAX_KEYS buckets, each forgotten one
 * window after its last request.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry; only meaningful when blocked. */
  retryAfterSec: number;
}

export const MAX_KEYS = 4_000;

interface Bucket {
  count: number;
  windowStart: number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = MAX_KEYS) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  check(key: string, now: number): RateLimitDecision {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.delete(key);
      this.buckets.set(key, { count: 1, windowStart: now });
      this.enforceCap();
      return { allowed: true, retryAfterSec: 0 };
    }

    bucket.count += 1;
    if (bucket.count > this.limit) {
      const remainingMs = this.windowMs - (now - bucket.windowStart);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart < this.windowMs) break; // insertion order ≈ age
      this.buckets.delete(key);
    }
  }

  private enforceCap(): void {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * A full run is ~15 events. 60/minute leaves an order of magnitude of headroom
 * for a visitor who replays and skips a lot, and still stops a runaway loop.
 */
export const perSessionLimiter = new FixedWindowLimiter(60, 60_000);

/** A whole exhibition hall of kiosks stays well under this. */
export const globalLimiter = new FixedWindowLimiter(1_200, 60_000, 1);
