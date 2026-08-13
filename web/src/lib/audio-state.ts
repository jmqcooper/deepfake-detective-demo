/**
 * Playback state, as data.
 *
 * `useAudio` used to swallow every failure — `el.play().catch(() => {})` and
 * nothing else. On a kiosk that is the worst possible behaviour: the station
 * advances on a timer, the visitor hears silence, and there is no way to tell a
 * muted tablet from a missing file from a browser that blocked autoplay. Each
 * of those needs a different sentence on screen, so each gets its own reason
 * here, and the components render it.
 */

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "ended"
  | "error";

/**
 * `blocked` is the one that is not really an error: the browser refused to
 * start audio without a gesture, and the fix is "tap the button", not "get an
 * engineer". Keeping it distinct is what lets the sound check say so.
 */
export type PlaybackError = "blocked" | "missing" | "network" | "decode" | "unknown";

export interface PlaybackState {
  status: PlaybackStatus;
  error: PlaybackError | null;
  /** 0..1 through the clip. */
  progress: number;
  /** Seconds, or null until metadata resolves. */
  durationSec: number | null;
}

export const INITIAL_PLAYBACK: PlaybackState = {
  status: "idle",
  error: null,
  progress: 0,
  durationSec: null,
};

/** MediaError codes, per the HTML spec. */
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function mediaErrorToPlaybackError(code: number | undefined): PlaybackError {
  switch (code) {
    case MEDIA_ERR_NETWORK:
      return "network";
    case MEDIA_ERR_DECODE:
      return "decode";
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      // A pack that was never generated looks exactly like this: the <audio>
      // element gets a 404 HTML page where an MP3 should be.
      return "missing";
    case MEDIA_ERR_ABORTED:
      return "unknown";
    default:
      return "unknown";
  }
}

/** `play()` rejects with a DOMException whose name carries the reason. */
export function playRejectionToPlaybackError(reason: unknown): PlaybackError {
  const name =
    typeof reason === "object" && reason !== null && "name" in reason
      ? String((reason as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
      return "blocked";
    case "NotSupportedError":
      return "missing";
    case "AbortError":
      // A new clip interrupted this one. Not worth a message.
      return "unknown";
    default:
      return "unknown";
  }
}

export function progressOf(currentTime: number, duration: number | null): number {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

/** An AbortError from switching clips must not paint an error on the screen. */
export function isReportableError(error: PlaybackError | null): boolean {
  return error !== null && error !== "unknown";
}

/** i18n key for the message a visitor sees when playback fails. */
export function playbackErrorKey(error: PlaybackError): string {
  return `audio.error.${error}`;
}

/**
 * Whether a station may treat "the clip finished" as true. A station that
 * advances its story on a timer will happily narrate over silence; one that
 * asks this will not.
 */
export function didActuallyPlay(state: PlaybackState): boolean {
  return state.status === "ended" && state.error === null;
}
