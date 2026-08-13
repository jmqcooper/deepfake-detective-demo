#!/usr/bin/env bash
#SBATCH --job-name=voxtral-english
#SBATCH --partition=gpu_h100
#SBATCH --gpus=1
#SBATCH --cpus-per-task=16
#SBATCH --time=01:00:00
#SBATCH --output=/gpfs/work5/0/prjs1904/nemo-demo/logs/english-%j.out
#
# English mirror of every scripted clip: TTS (see generate_english.py), then
# ASR transcripts for the new English factory clips. Environment quirks are
# copied from generate_dutch.slurm — see the comments there.
set -euo pipefail

PROJ=/gpfs/work5/0/prjs1904/nemo-demo
VENV=${VENV:-/scratch-shared/jcooper/nemo-demo/venv}
export HF_HOME=$PROJ/hf
export OUT=$PROJ/dutch
export VLLM_DISABLE_COMPILE_CACHE=1
export CUDA_HOME="$VENV/lib/python3.11/site-packages/nvidia/cu13"
export PATH="$CUDA_HOME/bin:$PATH"
export VLLM_ATTENTION_BACKEND=FLASH_ATTN
export VLLM_USE_FLASHINFER_SAMPLER=0
export CPATH="/sw/arch/RHEL8/EB_production/2023/software/Python/3.11.3-GCCcore-12.3.0/include/python3.11${CPATH:+:$CPATH}"

mkdir -p "$PROJ/logs"
echo "==> node: $(hostname)  gpu: $(nvidia-smi --query-gpu=name --format=csv,noheader)"

serve() {
  local model=$1 port=$2; shift 2
  local revision
  case "$model" in
    mistralai/Voxtral-4B-TTS-2603) revision=b81be46c3777f88621676791b512bb01dc1cb970 ;;
    mistralai/Voxtral-Mini-4B-Realtime-2602) revision=2769294da9567371363522aac9bbcfdd19447add ;;
    *) echo "unapproved model: $model" >&2; return 2 ;;
  esac
  "$VENV/bin/vllm" serve "$model" --port "$port" --max-model-len 8192 \
    --revision "$revision" --enforce-eager "$@" \
    > "$PROJ/logs/vllm-$port-english.log" 2>&1 &
  echo $!
}

wait_ready() {
  local port=$1
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      echo "    server on :$port is up"; return 0
    fi
    sleep 10
  done
  tail -30 "$PROJ/logs/vllm-$port-english.log" >&2
  return 1
}

echo "==> starting Voxtral TTS (--omni)"
TTS_PID=$(serve mistralai/Voxtral-4B-TTS-2603 8010 --omni)
wait_ready 8010
"$VENV/bin/python" "$PROJ/scripts/generate_english.py"
kill "$TTS_PID" 2>/dev/null || true
sleep 20

echo "==> starting Voxtral Mini Realtime (ASR) for the English factory clips"
ASR_PID=$(serve mistralai/Voxtral-Mini-4B-Realtime-2602 8011)
wait_ready 8011
"$VENV/bin/python" - <<'PY'
import json, os
from pathlib import Path
import httpx

OUT = Path(os.environ["OUT"])
MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"
transcripts, failed = {}, []
with httpx.Client(timeout=600) as client:
    for wav in sorted((OUT / "factory").glob("*_en.wav")):
        key = f"factory/{wav.stem}"
        with wav.open("rb") as f:
            r = client.post(
                "http://127.0.0.1:8011/v1/audio/transcriptions",
                files={"file": (wav.name, f, "audio/wav")},
                data={"model": MODEL, "language": "en"},
            )
        if r.status_code != 200:
            failed.append(key)
            continue
        transcripts[key] = r.json().get("text", "").strip()
        print(f"  {wav.stem:<24} {transcripts[key][:48]}")
(OUT / "factory_transcripts_en.json").write_text(
    json.dumps({"model": MODEL, "transcripts": transcripts}, ensure_ascii=False, indent=2)
)
print(f"transcribed {len(transcripts)} English factory clips")
if failed:
    raise SystemExit(f"ERROR: missing transcripts: {failed}")
PY
kill "$ASR_PID" 2>/dev/null || true
echo "==> DONE"
