import test from "node:test";
import assert from "node:assert/strict";

import { isCrossOriginRequest } from "@/lib/request-origin";

function request(headers: Record<string, string>): Request {
  // The internal URL intentionally differs from the public Host. This is what
  // Next.js exposes in a production container behind a reverse proxy.
  return new Request("http://0.0.0.0:3000/api/voice-clone/wake", { headers });
}

test("accepts a browser origin matching the public Host", () => {
  assert.equal(
    isCrossOriginRequest(
      request({
        host: "illc-deepfake-detective.science.uva.nl",
        origin: "https://illc-deepfake-detective.science.uva.nl",
      }),
    ),
    false,
  );
});

test("accepts a forwarded HTTPS origin when the proxy rewrites Host", () => {
  assert.equal(
    isCrossOriginRequest(
      request({
        host: "localhost:3000",
        origin: "https://illc-deepfake-detective.science.uva.nl",
        "x-forwarded-host": "illc-deepfake-detective.science.uva.nl",
        "x-forwarded-proto": "https",
      }),
    ),
    false,
  );
});

test("rejects a mismatched host, protocol, malformed origin, and null origin", () => {
  assert.equal(
    isCrossOriginRequest(
      request({ host: "example.test", origin: "https://attacker.test" }),
    ),
    true,
  );
  assert.equal(
    isCrossOriginRequest(
      request({
        host: "example.test",
        origin: "http://example.test",
        "x-forwarded-proto": "https",
      }),
    ),
    true,
  );
  assert.equal(
    isCrossOriginRequest(
      request({ host: "example.test", origin: "not a url" }),
    ),
    true,
  );
  assert.equal(
    isCrossOriginRequest(request({ host: "example.test", origin: "null" })),
    true,
  );
});

test("allows non-browser calls without an Origin header", () => {
  assert.equal(isCrossOriginRequest(request({ host: "example.test" })), false);
});
