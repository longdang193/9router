param(
    [int]$Port = 20128,
    [int]$IntervalSeconds = 300
)

$HealthUrl = "http://127.0.0.1:$Port/api/health"

function Test-9RouterHealthy {
    try {
        $response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 10
        return $response.ok -eq $true
    } catch {
        return $false
    }
}

function Start-9Router {
    Write-Host "9router is not running. Starting it..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "9router"
}

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] Checking 9router..."

    if (-not (Test-9RouterHealthy)) {
        Start-9Router
    } else {
        Write-Host "[$timestamp] 9router is running. No action needed."
    }

    Write-Host "Next check in $IntervalSeconds seconds."
    Start-Sleep -Seconds $IntervalSeconds
}
