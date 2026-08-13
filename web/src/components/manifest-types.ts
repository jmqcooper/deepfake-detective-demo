/**
 * Client-side view of `public/samples/manifest.json` (see SPEC.md).
 *
 * There is exactly ONE description of the pack — `@/lib/manifest-schema` — and
 * this module only re-exports it under the names the stations already use.
 * The hand-written interfaces that used to live here drifted away from both the
 * pipeline's output and the server's schema, which is how the API ended up
 * unable to read a manifest the stations rendered happily.
 */

export type {
  Clip,
  ClipLabel,
  ClueBox,
  CodecRung,
  FactoryClip,
  FakeFactory,
  Lang as ClipLang,
  Manifest,
  SpectrogramRef,
} from "@/lib/manifest-schema";
