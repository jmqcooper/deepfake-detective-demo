#!/usr/bin/env bash
# Pull the Voxtral-generated Dutch pack back from Snellius into the local cache.
#
# Run AFTER the GPU job (tools/snellius/generate_dutch.slurm) has finished.
# Everything downstream (transcode, spectrograms, manifest) then runs locally.
#
# NOTE: `ssh` is aliased on the maintainer's machine, so we call the absolute
# binary — this works regardless of shell config.
set -euo pipefail

SSH=/usr/bin/ssh
HOST="${SNELLIUS_HOST:-thesis}"
REMOTE=/gpfs/work5/0/prjs1904/nemo-demo/dutch_pack.tar.gz

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/tools/.cache/dutch"

if ! "$SSH" -o BatchMode=yes "$HOST" "test -f $REMOTE"; then
  echo "error: $REMOTE not found on $HOST." >&2
  echo "       Run the GPU job first:" >&2
  echo "         ssh $HOST 'cd /gpfs/work5/0/prjs1904/nemo-demo && sbatch scripts/generate_dutch.slurm'" >&2
  exit 1
fi

mkdir -p "$CACHE"
echo "==> streaming dutch_pack.tar.gz from $HOST"
"$SSH" -o BatchMode=yes "$HOST" "cat $REMOTE" | tar xzf - -C "$CACHE"

echo "==> unpacked into $CACHE"
echo "    real : $(find "$CACHE/real" -name '*.wav' 2>/dev/null | wc -l | tr -d ' ') clips"
echo "    fake : $(find "$CACHE/fake" -name '*.wav' 2>/dev/null | wc -l | tr -d ' ') clips"
echo
echo "Next: python tools/prepare_samples.py && python tools/prepare_samples.py --verify-only"
