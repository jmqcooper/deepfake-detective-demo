#!/usr/bin/env bash
# One-time setup on Snellius: build the vLLM-Omni environment for Voxtral.
# Run on the LOGIN node (it has internet); the GPU nodes do not need it.
set -euo pipefail

PROJ=/gpfs/work5/0/prjs1904/nemo-demo
# The venv goes on SCRATCH, not the project filesystem: vLLM + the CUDA wheels are
# ~18GB and will blow the prjs1904 disk quota (uv then fails mid-install with
# "Disk quota exceeded", leaving a half-installed vLLM whose CUDA extensions are
# missing — which looks exactly like a broken wheel and is a nightmare to debug).
# Model weights stay on the project fs, where they persist across scratch purges.
VENV=${VENV:-/scratch-shared/$USER/nemo-demo/venv}
export HF_HOME=$PROJ/hf

mkdir -p "$PROJ" "$HF_HOME" "$(dirname "$VENV")"

module load 2023 2>/dev/null || true
module load Python/3.11.3-GCCcore-12.3.0 2>/dev/null || true

if [ ! -d "$VENV" ]; then
  echo "==> creating venv at $VENV"
  uv venv "$VENV" --python 3.11
fi

# Install order matters. Every one of these lines is a bug we already hit:
#
#  1. vllm FIRST, pinned. Installing vllm-omni afterwards with `-U` upgrades torch
#     out from under vLLM and silently invalidates its prebuilt CUDA extensions
#     ("_vllm_fa2_C not found"). We pin torch so omni cannot move it.
#  2. vllm-omni must match vllm's minor version, or it imports a module that does
#     not exist (`vllm.entrypoints.serve.disagg`).
#  3. torchcodec comes along for the ride, needs system FFmpeg libs Snellius does
#     not have, and dies at import. vLLM does not actually need it — remove it.
#  4. vLLM shells out to `nvcc` while profiling GPU memory. There is no system CUDA
#     toolkit, so install a matching one from pip.
echo "==> installing vllm (pinned) — ~10GB of wheels"
VIRTUAL_ENV="$VENV" uv pip install "vllm==0.25.0"

TORCH=$("$VENV/bin/python" -c 'import torch; print(torch.__version__.split("+")[0])')
echo "torch==$TORCH" > "$VENV/.torch-constraint"

echo "==> installing vllm-omni (version-matched, torch pinned to $TORCH)"
VIRTUAL_ENV="$VENV" uv pip install "vllm-omni==0.25.0rc1" \
  --constraint "$VENV/.torch-constraint"

echo "==> removing torchcodec (broken without system FFmpeg; vLLM does not need it)"
VIRTUAL_ENV="$VENV" uv pip uninstall torchcodec || true

echo "==> installing nvcc + client libs"
VIRTUAL_ENV="$VENV" uv pip install "nvidia-cuda-nvcc-cu13==0.0.1"
VIRTUAL_ENV="$VENV" uv pip install "mistral_common==1.10.0" "httpx==0.28.1" "soundfile==0.13.1" \
  --constraint "$VENV/.torch-constraint"

echo "==> pre-downloading models to $HF_HOME (login node has internet, GPU nodes may not)"
VIRTUAL_ENV="$VENV" "$VENV/bin/python" - <<'PY'
import os
from huggingface_hub import snapshot_download
models = {
    "mistralai/Voxtral-4B-TTS-2603": "b81be46c3777f88621676791b512bb01dc1cb970",
    "mistralai/Voxtral-Mini-4B-Realtime-2602": "2769294da9567371363522aac9bbcfdd19447add",
}
for repo, revision in models.items():
    print("downloading", repo, revision)
    snapshot_download(repo, revision=revision, cache_dir=os.environ["HF_HOME"])
print("models ready")
PY

echo "==> done. venv=$VENV  HF_HOME=$HF_HOME"
