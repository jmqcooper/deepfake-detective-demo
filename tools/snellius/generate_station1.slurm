#!/usr/bin/env bash
#SBATCH --job-name=voxtral-station1
#SBATCH --partition=gpu_h100
#SBATCH --gpus=1
#SBATCH --cpus-per-task=16
#SBATCH --time=00:45:00
#SBATCH --output=/gpfs/work5/0/prjs1904/nemo-demo/logs/station1-%j.out
#
# TTS-only pass: generate the Station 3 codec-ladder utterance
# (see generate_station1.py). Environment quirks are copied from
# generate_dutch.slurm — see the comments there for why each one exists.
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

"$VENV/bin/vllm" serve mistralai/Voxtral-4B-TTS-2603 \
  --revision b81be46c3777f88621676791b512bb01dc1cb970 \
  --port 8010 --max-model-len 8192 --enforce-eager --omni \
  > "$PROJ/logs/vllm-8010-station1.log" 2>&1 &
TTS_PID=$!

for _ in $(seq 1 120); do
  if curl -sf http://127.0.0.1:8010/health >/dev/null 2>&1; then
    echo "    TTS server is up"; break
  fi
  sleep 10
done
curl -sf http://127.0.0.1:8010/health >/dev/null || {
  echo "TTS server never became ready" >&2
  tail -30 "$PROJ/logs/vllm-8010-station1.log" >&2
  exit 1
}

"$VENV/bin/python" "$PROJ/scripts/generate_station1.py"

kill "$TTS_PID" 2>/dev/null || true
echo "==> DONE → $OUT/station1_source.wav"
