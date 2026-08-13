import test from "node:test";
import assert from "node:assert/strict";

import {
  didActuallyPlay,
  isReportableError,
  mediaErrorToPlaybackError,
  playRejectionToPlaybackError,
  playbackErrorKey,
  progressOf,
  INITIAL_PLAYBACK,
  MEDIA_ERR_ABORTED,
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
} from "@/lib/audio-state";
import { lookup } from "@/lib/i18n-core";
import { dictionaries } from "./dictionaries.ts";

test("a missing sample pack is distinguishable from a flat battery", () => {
  // These need different sentences on screen: one is "generate the pack", the
  // other is "turn your volume up".
  assert.equal(mediaErrorToPlaybackError(MEDIA_ERR_SRC_NOT_SUPPORTED), "missing");
  assert.equal(mediaErrorToPlaybackError(MEDIA_ERR_NETWORK), "network");
  assert.equal(mediaErrorToPlaybackError(MEDIA_ERR_DECODE), "decode");
  assert.equal(mediaErrorToPlaybackError(MEDIA_ERR_ABORTED), "unknown");
  assert.equal(mediaErrorToPlaybackError(undefined), "unknown");
});

test("a blocked autoplay is its own reason, not a failure", () => {
  assert.equal(
    playRejectionToPlaybackError(new DOMException("no", "NotAllowedError")),
    "blocked",
  );
  assert.equal(
    playRejectionToPlaybackError(new DOMException("no", "NotSupportedError")),
    "missing",
  );
});

test("interrupting one clip with the next is not an error to show anyone", () => {
  const reason = playRejectionToPlaybackError(new DOMException("stop", "AbortError"));
  assert.equal(reason, "unknown");
  assert.equal(isReportableError(reason), false);
  assert.equal(isReportableError(null), false);
  assert.equal(isReportableError("blocked"), true);
});

test("every reportable reason has copy in both languages", () => {
  for (const reason of ["blocked", "missing", "network", "decode"] as const) {
    const key = playbackErrorKey(reason);
    for (const lang of ["nl", "en"] as const) {
      const copy = lookup(dictionaries[lang], key);
      assert.equal(typeof copy, "string", `${lang} is missing ${key}`);
      assert.ok((copy ?? "").length > 10, `${lang} ${key} is too terse to help`);
    }
  }
});

test("progress is a clamped fraction even with a nonsense duration", () => {
  assert.equal(progressOf(2, 4), 0.5);
  assert.equal(progressOf(0, 4), 0);
  assert.equal(progressOf(9, 4), 1);
  assert.equal(progressOf(-1, 4), 0);
  // Before metadata resolves, `duration` is NaN or Infinity on most browsers.
  assert.equal(progressOf(2, Number.NaN), 0);
  assert.equal(progressOf(2, Number.POSITIVE_INFINITY), 0);
  assert.equal(progressOf(2, 0), 0);
  assert.equal(progressOf(2, null), 0);
});

test("a station may only continue on a clip that really finished", () => {
  assert.equal(didActuallyPlay({ ...INITIAL_PLAYBACK, status: "ended" }), true);
  assert.equal(
    didActuallyPlay({ ...INITIAL_PLAYBACK, status: "ended", error: "missing" }),
    false,
  );
  for (const status of ["idle", "loading", "ready", "playing", "error"] as const) {
    assert.equal(didActuallyPlay({ ...INITIAL_PLAYBACK, status }), false);
  }
});

test("playback starts idle and silent, not optimistically ready", () => {
  assert.deepEqual(INITIAL_PLAYBACK, {
    status: "idle",
    error: null,
    progress: 0,
    durationSec: null,
  });
});
