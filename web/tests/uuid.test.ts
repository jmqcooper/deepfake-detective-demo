import test from "node:test";
import assert from "node:assert/strict";

import { isUuidV4, uuidV4, UUID_V4_PATTERN } from "@/lib/uuid";

test("uses the native generator when it is present and correct", () => {
  const id = "1b4e28ba-2fa1-4d3b-a3f5-ccbf1a2c1b31";
  assert.equal(uuidV4({ randomUUID: () => id }), id);
});

test("falls back to getRandomValues when randomUUID is missing", () => {
  const generated = uuidV4({
    getRandomValues: (array) => {
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      bytes.fill(0xab);
      return array;
    },
  });
  assert.match(generated, UUID_V4_PATTERN);
  // Version and variant nibbles must be forced regardless of the random bytes.
  assert.equal(generated[14], "4");
  assert.ok(["8", "9", "a", "b"].includes(generated[19]));
});

test("falls back to Math.random when the browser has no crypto at all", () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(uuidV4(undefined), UUID_V4_PATTERN);
  }
});

test("rejects a polyfilled randomUUID that returns something else", () => {
  const generated = uuidV4({ randomUUID: () => "0.8342342341" });
  assert.match(generated, UUID_V4_PATTERN);
});

test("isUuidV4 rejects the old Math.random session ids", () => {
  // What `String(Math.random()).slice(2)` used to produce — every event sent
  // with one of these was refused by the API's validator.
  assert.equal(isUuidV4("8342342341234"), false);
  assert.equal(isUuidV4(""), false);
  assert.equal(isUuidV4(undefined), false);
  assert.equal(isUuidV4("1b4e28ba-2fa1-1d3b-a3f5-ccbf1a2c1b31"), false); // v1
});

test("generated ids are distinct", () => {
  const ids = new Set(Array.from({ length: 500 }, () => uuidV4(undefined)));
  assert.equal(ids.size, 500);
});
