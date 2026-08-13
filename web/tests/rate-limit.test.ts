import test from "node:test";
import assert from "node:assert/strict";

import { FixedWindowLimiter } from "@/lib/rate-limit";

test("requests inside the limit are allowed", () => {
  const limiter = new FixedWindowLimiter(3, 1_000);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(limiter.check("session", 0).allowed, true, `request ${i}`);
  }
});

test("the request past the limit is refused with a wait", () => {
  const limiter = new FixedWindowLimiter(3, 1_000);
  for (let i = 0; i < 3; i += 1) limiter.check("session", 0);
  const blocked = limiter.check("session", 400);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 1);
});

test("the window reopens once it has passed", () => {
  const limiter = new FixedWindowLimiter(2, 1_000);
  limiter.check("session", 0);
  limiter.check("session", 0);
  assert.equal(limiter.check("session", 500).allowed, false);
  assert.equal(limiter.check("session", 1_500).allowed, true);
});

test("one noisy session does not throttle the visitor next to it", () => {
  const limiter = new FixedWindowLimiter(2, 1_000);
  limiter.check("kiosk-a", 0);
  limiter.check("kiosk-a", 0);
  assert.equal(limiter.check("kiosk-a", 0).allowed, false);
  assert.equal(limiter.check("kiosk-b", 0).allowed, true);
});

test("the bucket map is bounded, so a flood of new keys cannot grow it forever", () => {
  const limiter = new FixedWindowLimiter(10, 60_000, 50);
  for (let i = 0; i < 5_000; i += 1) {
    limiter.check(`session-${i}`, 0);
  }
  assert.ok(limiter.size <= 50, `held ${limiter.size} buckets`);
});

test("stale buckets are swept rather than accumulated", () => {
  const limiter = new FixedWindowLimiter(10, 1_000);
  for (let i = 0; i < 100; i += 1) limiter.check(`session-${i}`, 0);
  assert.equal(limiter.size, 100);
  limiter.check("later", 10_000);
  assert.equal(limiter.size, 1);
});
