param(
    [ValidateSet("start", "install", "stop", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Pause-OnError([string]$Message) {
    Write-Host "`nERROR: $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    if ($script:ContainerRuntime -eq "docker") {
        & docker compose @Arguments
    } else {
        & podman compose @Arguments
    }
    if ($LASTEXITCODE -ne 0) { throw "Container command failed." }
}

function Ensure-PrivateEnv {
    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
    }

    $lines = @(Get-Content ".env")
    $tokenLine = $lines | Where-Object { $_ -match '^VOICE_CLONE_TOKEN=' } | Select-Object -Last 1
    if ($tokenLine -and $tokenLine.Substring("VOICE_CLONE_TOKEN=".Length)) { return }

    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $replaced = $false
    $updated = foreach ($line in $lines) {
        if ($line -match '^VOICE_CLONE_TOKEN=') {
            $replaced = $true
            "VOICE_CLONE_TOKEN=$token"
        } else {
            $line
        }
    }
    if (-not $replaced) { $updated += "VOICE_CLONE_TOKEN=$token" }
    $utf8WithoutBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines((Resolve-Path ".env"), [string[]]$updated, $utf8WithoutBom)
}

try {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker compose version *> $null
        if ($LASTEXITCODE -eq 0) {
            $script:ContainerRuntime = "docker"
            & docker info *> $null
            if ($LASTEXITCODE -ne 0) {
                Pause-OnError "Docker Desktop is installed but not running. Start it, wait until it is ready, then run this file again."
            }
        }
    }
    if (-not $script:ContainerRuntime -and (Get-Command podman -ErrorAction SilentlyContinue)) {
        & podman compose version *> $null
        if ($LASTEXITCODE -eq 0) {
            $script:ContainerRuntime = "podman"
            & podman info *> $null
            if ($LASTEXITCODE -ne 0) {
                Pause-OnError "Podman is installed but not running. Start its machine, then run this file again."
            }
        }
    }
    if (-not $script:ContainerRuntime) {
        Start-Process "https://docs.docker.com/desktop/setup/install/windows-install/"
        Pause-OnError "Install and start Docker Desktop from the page that just opened, then run install\windows.ps1 again."
    }

    switch ($Action) {
        { $_ -in @("start", "install") } {
            Ensure-PrivateEnv
            Write-Host "`nBuilding and starting the Deepfake Detective web app..."
            Invoke-Compose up -d --build
            Write-Host "Waiting for http://localhost:3000 ..."
            for ($attempt = 0; $attempt -lt 90; $attempt++) {
                try {
                    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:3000/api/health"
                    if ($response.StatusCode -eq 200) {
                        Write-Host "`nReady: http://localhost:3000" -ForegroundColor Green
                        Start-Process "http://localhost:3000"
                        exit 0
                    }
                } catch {
                    Start-Sleep -Seconds 2
                }
            }
            Invoke-Compose logs --tail=80 web
            Pause-OnError "The app did not become healthy within three minutes. The last web logs are shown above."
        }
        "stop" {
            Invoke-Compose down
            Write-Host "Stopped. Saved statistics were kept."
        }
        "logs" { Invoke-Compose logs --tail=200 web }
    }
} catch {
    Pause-OnError $_.Exception.Message
}
