#!/usr/bin/env bash
#SBATCH --job-name=voxtral-nl
#SBATCH --partition=gpu_h100
#SBATCH --gpus=1
#SBATCH --cpus-per-task=16
#SBATCH --time=01:30:00
#SBATCH --output=/gpfs/work5/0/prjs1904/nemo-demo/logs/voxtral-%j.out
#
# Generates the Dutch half of the demo on one H100:
#   1. Voxtral-4B-TTS  → a deepfake of every MLS sentence (the "fake" clips)
#   2. Voxtral-Mini-Realtime → transcribes every clip (this is Miko, the ASR)
#
# Both models are served through vLLM-Omni on localhost inside this job.
set -euo pipefail

PROJ=/gpfs/work5/0/prjs1904/nemo-demo
# The venv lives on scratch, not on the project filesystem: vLLM + CUDA wheels are
# ~18GB and blow the prjs1904 quota. Model weights stay in $PROJ/hf (they persist).
VENV=${VENV:-/scratch-shared/jcooper/nemo-demo/venv}
export HF_HOME=$PROJ/hf
export OUT=$PROJ/dutch
export VLLM_DISABLE_COMPILE_CACHE=1

# NOTE: do NOT load the FFmpeg/GCCcore module here.
# It was needed for torchcodec (which vLLM pulls in but does not require — we
# uninstall it in setup_env.sh). Loading it puts an EasyBuild GCC on PATH, which
# torch's inductor then picks as its C++ compiler and dies with
# "InductorError: CalledProcessError" before the engine ever starts.
#
# vLLM still needs `nvcc` during its GPU memory profiling ("Could not find nvcc
# and default cuda home not found"). Snellius has no system CUDA toolkit, so we
# point CUDA_HOME at the pip-installed nvcc (nvidia-cuda-nvcc-cu13), which matches
# torch's cu130 build exactly and keeps the EasyBuild compilers off PATH.
export CUDA_HOME="$VENV/lib/python3.11/site-packages/nvidia/cu13"
export PATH="$CUDA_HOME/bin:$PATH"

# Use the FlashAttention kernels that ship PREBUILT inside the vLLM wheel
# (_vllm_fa2_C / _vllm_fa3_C). The default backend, FlashInfer, JIT-compiles its
# kernels at startup with ninja + nvcc, and that build fails here:
#   error "CUDA compiler and CUDA toolkit headers are in different versions"
# because our pip nvcc (13.2) does not match the pip CUDA headers. Nothing needs
# compiling at all for a dozen short clips, so sidestep the JIT entirely.
export VLLM_ATTENTION_BACKEND=FLASH_ATTN
export VLLM_USE_FLASHINFER_SAMPLER=0

# Triton compiles a small C helper (cuda_utils.c) at startup and needs the CPython
# dev headers. The venv is built on the system python3.11, and python3.11-devel is
# NOT installed on Snellius — so gcc dies with "fatal error: Python.h: No such file
# or directory". Point it at the EasyBuild Python 3.11 headers. (3.11.3 vs 3.11.13:
# the CPython ABI is stable across patch releases, so this is safe.) We only export
# the include path — we deliberately do NOT `module load` it, which would put an
# EasyBuild GCC on PATH and break torch's inductor.
export CPATH="/sw/arch/RHEL8/EB_production/2023/software/Python/3.11.3-GCCcore-12.3.0/include/python3.11${CPATH:+:$CPATH}"

mkdir -p "$PROJ/logs" "$OUT/fake"

echo "==> node: $(hostname)  gpu: $(nvidia-smi --query-gpu=name --format=csv,noheader)"

serve() {  # serve <model> <port> <extra-args...>
  local model=$1 port=$2; shift 2
  local revision
  case "$model" in
    mistralai/Voxtral-4B-TTS-2603) revision=b81be46c3777f88621676791b512bb01dc1cb970 ;;
    mistralai/Voxtral-Mini-4B-Realtime-2602) revision=2769294da9567371363522aac9bbcfdd19447add ;;
    *) echo "unapproved model: $model" >&2; return 2 ;;
  esac
  # --enforce-eager: skip torch.compile/CUDA-graph capture. We generate a dozen
  # short clips once, so compilation buys nothing and inductor is fragile in this
  # environment. Belt-and-braces alongside not loading the GCCcore module above.
  "$VENV/bin/vllm" serve "$model" --port "$port" --max-model-len 8192 \
    --revision "$revision" --enforce-eager "$@" \
    > "$PROJ/logs/vllm-$port.log" 2>&1 &
  echo $!
}

wait_ready() {  # wait_ready <port>
  local port=$1
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      echo "    server on :$port is up"; return 0
    fi
    sleep 10
  done
  echo "    server on :$port never became ready; see $PROJ/logs/vllm-$port.log" >&2
  tail -30 "$PROJ/logs/vllm-$port.log" >&2
  return 1
}

# ---------------------------------------------------------------- 1. the fakes
echo "==> starting Voxtral TTS (--omni)"
TTS_PID=$(serve mistralai/Voxtral-4B-TTS-2603 8010 --omni)
wait_ready 8010

"$VENV/bin/python" "$PROJ/scripts/tts_generate.py"

# Station 4's fake factory: the same TTS server, but speaking sentences we wrote —
# modern Dutch a child actually recognises, including the scam line. Station 2's text
# is dictated by the source corpus (nobody reads it, it's a listening game); Station 4
# DISPLAYS its transcript, so the words have to land.
"$VENV/bin/python" "$PROJ/scripts/factory_generate.py"

kill "$TTS_PID" 2>/dev/null || true
sleep 20

# --------------------------------------------------- 2. Miko listens to it all
echo "==> starting Voxtral Mini Realtime (ASR)"
ASR_PID=$(serve mistralai/Voxtral-Mini-4B-Realtime-2602 8011)
wait_ready 8011

"$VENV/bin/python" "$PROJ/scripts/asr_transcribe.py"

kill "$ASR_PID" 2>/dev/null || true

# ------------------------------------------------------------------ 3. package
cd "$OUT"
tar czf "$PROJ/dutch_pack.tar.gz" real fake factory sentences.json fakes.json factory.json transcripts.json
echo "==> DONE → $PROJ/dutch_pack.tar.gz"
