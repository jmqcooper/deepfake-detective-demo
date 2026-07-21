#!/usr/bin/env python3
"""STUB: future offline generation for the Station 4 fake factory."""

# TODO(Voxtral): Do not implement until the TTS service is approved and wired up.
# Start the OpenAI-compatible omni server with:
#   vllm serve mistralai/Voxtral-4B-TTS-2603 --omni
# Then generate the approved sentence x voice x language grid by POSTing each
# request to /v1/audio/speech. Store only the pre-rendered assets under
# web/public/samples/factory/ and set fakeFactory.available=true in the manifest.


def main() -> None:
    raise SystemExit("Voxtral fake-factory generation is not implemented yet (see TODO in this file).")


if __name__ == "__main__":
    main()
