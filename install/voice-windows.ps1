$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$RuntimeDir = Join-Path $RootDir ".runtime"
$UvBin = Join-Path $RuntimeDir "bin\uv.exe"
$VoicePython = Join-Path $RootDir ".venv-voice\Scripts\python.exe"
$UvVersion = "0.12.5"

$env:UV_CACHE_DIR = Join-Path $RuntimeDir "uv-cache"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $RuntimeDir "python"
$env:UV_PYTHON_BIN_DIR = Join-Path $RuntimeDir "python-bin"
$env:UV_NO_MODIFY_PATH = "1"
$env:UV_PYTHON_INSTALL_REGISTRY = "0"
$env:HF_HOME = Join-Path $RuntimeDir "huggingface"
$env:TORCH_HOME = Join-Path $RuntimeDir "torch"
$env:XDG_CACHE_HOME = Join-Path $RuntimeDir "cache"

function Pause-OnError([string]$Message) {
    Write-Host "`nERROR: $Message" -ForegroundColor Red
    exit 1
}

try {
    if (-not (Test-Path $UvBin)) {
        Write-Host "`nDownloading the isolated Python runner..."
        New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir "bin") | Out-Null
        $env:UV_UNMANAGED_INSTALL = Join-Path $RuntimeDir "bin"
        Invoke-RestMethod "https://astral.sh/uv/$UvVersion/install.ps1" | Invoke-Expression
        Remove-Item Env:UV_UNMANAGED_INSTALL
    }

    Write-Host "`nCreating the private Python 3.12 voice environment..."
    & $UvBin python install 3.12
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 download failed." }
    if (-not (Test-Path $VoicePython)) {
        & $UvBin venv --python 3.12 --managed-python (Join-Path $RootDir ".venv-voice")
        if ($LASTEXITCODE -ne 0) { throw "Voice environment creation failed." }
    }
    & $UvBin pip sync --python $VoicePython "tools\voice-clone-requirements.txt"
    if ($LASTEXITCODE -ne 0) { throw "Voice dependency installation failed." }

    if (-not (Test-Path ".env")) {
        Pause-OnError "The web app has not been installed yet. Run install\windows.ps1 first; it creates the shared private token."
    }
    $tokenLine = Get-Content ".env" | Where-Object { $_ -match '^VOICE_CLONE_TOKEN=' } | Select-Object -Last 1
    $token = if ($tokenLine) { $tokenLine.Substring("VOICE_CLONE_TOKEN=".Length) } else { "" }
    if (-not $token) {
        Pause-OnError "VOICE_CLONE_TOKEN is empty in .env. Run the web app installer once to create it."
    }

    $env:VOICE_CLONE_TOKEN = $token
    $env:VOICE_CLONE_HOST = "0.0.0.0"
    Write-Host "`nVoice cloning is starting on http://127.0.0.1:8765" -ForegroundColor Green
    Write-Host "Keep this window open. The first visit to Station 4 downloads and warms the models."
    Write-Host "Press Ctrl+C to stop voice cloning.`n"
    & $VoicePython -m tools.voice_clone_service
    if ($LASTEXITCODE -ne 0) { throw "The voice service stopped with an error." }
} catch {
    Pause-OnError $_.Exception.Message
}
