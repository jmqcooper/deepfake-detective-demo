param(
    [string]$AppUrl = "http://127.0.0.1:3000",
    [ValidateRange(1, 3600)]
    [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"
$AppUrl = $AppUrl.TrimEnd("/")

try {
    Write-Host "Checking the web application at $AppUrl ..."
    $app = Invoke-RestMethod -Method Get -TimeoutSec 10 -Uri "$AppUrl/api/health"
    if ($app.status -ne "ok") {
        throw "The web health check reported '$($app.status)'."
    }

    Write-Host "Waking the voice models through the web application ..."
    Invoke-RestMethod -Method Post -TimeoutSec 35 -Uri "$AppUrl/api/voice-clone/wake" | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds($ReadyTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $health = $null
        try {
            $health = Invoke-RestMethod -Method Get -TimeoutSec 10 -Uri "$AppUrl/api/voice-clone/health"
        } catch {
            Write-Host "Waiting for the voice service ..."
            Start-Sleep -Seconds 2
            continue
        }
        if ($health.ready -eq $true) {
            Write-Host "PASS: voice cloning and detection models are ready on '$($health.device)'." -ForegroundColor Green
            $health | ConvertTo-Json -Compress
            exit 0
        }
        if ($health.error) {
            throw "The voice worker reported: $($health.error)"
        }
        Write-Host "Models are loading ..."
        Start-Sleep -Seconds 2
    }

    throw "Voice models did not become ready within $ReadyTimeoutSeconds seconds."
} catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
