#!/usr/bin/env bash
#SBATCH --job-name=voxtral-asr-delivered
#SBATCH --partition=gpu_h100
#SBATCH --gpus=1
#SBATCH --cpus-per-task=16
#SBATCH --time=00:45:00
#SBATCH --output=/gpfs/work5/0/prjs1904/nemo-demo/logs/asr-delivered-%j.out
#
# ASR-only pass over the DELIVERED demo audio (see transcribe_delivered.py).
# Upload the decoded delivery clips to $PROJ/delivered/{audio,codec}/ first:
#   scp -r delivered thesis:/gpfs/work5/0/prjs1904/nemo-demo/
# Environment quirks below are copied from generate_dutch.slurm — see the
# comments there for why each one exists.
set -euo pipefail

PROJ=/gpfs/work5/0/prjs1904/nemo-demo
VENV=${VENV:-/scratch-shared/jcooper/nemo-demo/venv}
export HF_HOME=$PROJ/hf
export VLLM_DISABLE_COMPILE_CACHE=1
export CUDA_HOME="$VENV/lib/python3.11/site-packages/nvidia/cu13"
export PATH="$CUDA_HOME/bin:$PATH"
export VLLM_ATTENTION_BACKEND=FLASH_ATTN
export VLLM_USE_FLASHINFER_SAMPLER=0
export CPATH="/sw/arch/RHEL8/EB_production/2023/software/Python/3.11.3-GCCcore-12.3.0/include/python3.11${CPATH:+:$CPATH}"

mkdir -p "$PROJ/logs"
echo "==> node: $(hostname)  gpu: $(nvidia-smi --query-gpu=name --format=csv,noheader)"

"$VENV/bin/vllm" serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --revision 2769294da9567371363522aac9bbcfdd19447add \
  --port 8011 --max-model-len 8192 --enforce-eager \
  > "$PROJ/logs/vllm-8011-delivered.log" 2>&1 &
ASR_PID=$!

for _ in $(seq 1 120); do
  if curl -sf http://127.0.0.1:8011/health >/dev/null 2>&1; then
    echo "    ASR server is up"; break
  fi
  sleep 10
done
curl -sf http://127.0.0.1:8011/health >/dev/null || {
  echo "ASR server never became ready" >&2
  tail -30 "$PROJ/logs/vllm-8011-delivered.log" >&2
  exit 1
}

PROJ=$PROJ "$VENV/bin/python" "$PROJ/scripts/transcribe_delivered.py"

kill "$ASR_PID" 2>/dev/null || true
echo "==> DONE → $PROJ/delivered_transcripts.json"
