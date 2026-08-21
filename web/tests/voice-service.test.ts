import test from "node:test";
import assert from "node:assert/strict";

import { voiceServiceHeaders } from "@/lib/voice-service";

test("local development does not invent an internal credential", () => {
  assert.equal(voiceServiceHeaders(undefined).has("authorization"), false);
  assert.equal(voiceServiceHeaders("").has("authorization"), false);
});

test("a configured model credential is sent as a bearer token", () => {
  assert.equal(
    voiceServiceHeaders("server-secret").get("authorization"),
    "Bearer server-secret",
  );
});
