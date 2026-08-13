/**
 * One UUID-v4 generator for the whole app.
 *
 * There used to be two: `useState` minted a real UUID *or* `String(Math.random())`
 * when `crypto.randomUUID` was missing, while `reset()` called
 * `crypto.randomUUID()` unconditionally. On a kiosk browser without
 * `randomUUID` (any non-secure origin, and older Safari) that meant every
 * session id was rejected by the API's uuid-v4 check, and the first reset threw.
 */

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function randomBytes(crypto: CryptoLike | undefined): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  // Last resort. Only reached on a browser with neither crypto API; the id is
  // a de-duplication key for anonymous counters, never a security token.
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** RFC 4122 version 4, with a `getRandomValues` and a `Math.random` fallback. */
export function uuidV4(cryptoLike: CryptoLike | undefined = globalThis.crypto): string {
  if (typeof cryptoLike?.randomUUID === "function") {
    const native = cryptoLike.randomUUID();
    // Trust but verify: a polyfilled randomUUID that returns something else
    // would otherwise poison every event the kiosk sends.
    if (isUuidV4(native)) return native;
  }

  const bytes = randomBytes(cryptoLike);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (byte) => HEX[byte]);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
