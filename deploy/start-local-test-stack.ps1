[CmdletBinding()]
param(
    [switch]$NoBuild,
    [switch]$SkipSeed,
    [switch]$StartTauriDev,
    [ValidateSet("hosted", "local")]
    [string]$LiveKitMode = "hosted",
    [int]$TimeoutSeconds = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$backendDir = Join-Path $repoRoot "backend"
$desktopDir = Join-Path $repoRoot "desktop"
$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$seedScript = Join-Path $backendDir "scripts\seed_local_test_stack.py"
$dbName = if ($env:DB_NAME) { $env:DB_NAME } else { "singravox_v1_e2e" }

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-DotEnvMap {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $key = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()
        if ((($value.StartsWith('"') -and $value.EndsWith('"'))) -or (($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Seconds 2
            continue
        }
        Start-Sleep -Seconds 2
    }

    throw "Timeout while waiting for $Url"
}

function Test-PortListening {
    param([int]$Port)

    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

Write-Step "Starting Docker local test stack ($LiveKitMode LiveKit)"

if ($LiveKitMode -eq "local") {
    $env:LIVEKIT_URL = "ws://livekit:7880"
    $env:LIVEKIT_PUBLIC_URL = "ws://localhost:7880"
    $env:LIVEKIT_API_KEY = "devkey"
    $env:LIVEKIT_API_SECRET = "secret"
} else {
    $dotenv = Get-DotEnvMap -Path (Join-Path $scriptDir ".env")
    foreach ($requiredKey in @("LIVEKIT_URL", "LIVEKIT_PUBLIC_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")) {
        if (-not $dotenv.ContainsKey($requiredKey) -or -not $dotenv[$requiredKey]) {
            throw "Missing $requiredKey in deploy/.env for hosted LiveKit mode"
        }
    }
    $env:LIVEKIT_URL = $dotenv["LIVEKIT_URL"]
    $env:LIVEKIT_PUBLIC_URL = $dotenv["LIVEKIT_PUBLIC_URL"]
    $env:LIVEKIT_API_KEY = $dotenv["LIVEKIT_API_KEY"]
    $env:LIVEKIT_API_SECRET = $dotenv["LIVEKIT_API_SECRET"]
}

$dockerArgs = @(
    "compose",
    "-f", "docker-compose.yml",
    "-f", "docker-compose.localtest.yml",
    "up",
    "-d",
    "--force-recreate"
)

if (-not $NoBuild) {
    $dockerArgs += "--build"
}

$services = @(
    "mongodb",
    "minio",
    "mailpit",
    "backend",
    "frontend",
    "proxy"
)
if ($LiveKitMode -eq "local") {
    $services += "livekit"
}
$dockerArgs += $services

Push-Location $scriptDir
try {
    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
    if ($LiveKitMode -eq "hosted") {
        & docker compose -f docker-compose.yml -f docker-compose.localtest.yml stop livekit | Out-Null
    }
} finally {
    Pop-Location
}

Write-Step "Waiting for backend and proxy health"
Wait-HttpReady -Url "http://127.0.0.1:8001/api/health" -TimeoutSeconds $TimeoutSeconds
Wait-HttpReady -Url "http://127.0.0.1:8080/api/health" -TimeoutSeconds $TimeoutSeconds

if (-not $SkipSeed) {
    if (-not (Test-Path $backendPython)) {
        throw "Backend venv python not found at $backendPython. Run backend dependency install first or rerun with -SkipSeed."
    }
    if (-not (Test-Path $seedScript)) {
        throw "Seed script not found at $seedScript"
    }

    Write-Step "Seeding deterministic local test fixtures"
    Push-Location $backendDir
    try {
        $env:MONGO_URL = "mongodb://127.0.0.1:27017"
        $env:DB_NAME = $dbName
        & $backendPython $seedScript
        if ($LASTEXITCODE -ne 0) {
            throw "Seed script failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

if ($StartTauriDev) {
    if (Test-PortListening -Port 3000) {
        Write-Host "==> Tauri/React dev server already listening on :3000, skipping start" -ForegroundColor Yellow
    } else {
        $logDir = Join-Path $desktopDir ".logs"
        $stdoutLog = Join-Path $logDir "tauri-dev.out.log"
        $stderrLog = Join-Path $logDir "tauri-dev.err.log"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null

        Write-Step "Starting Tauri dev in background"
        $process = Start-Process `
            -FilePath "yarn.cmd" `
            -ArgumentList "tauri:dev" `
            -WorkingDirectory $desktopDir `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru

        Write-Host "Started Tauri dev (PID $($process.Id))" -ForegroundColor Green
        Wait-HttpReady -Url "http://127.0.0.1:3000" -TimeoutSeconds $TimeoutSeconds
    }
}

Write-Host ""
Write-Host "Local test stack is ready." -ForegroundColor Green
Write-Host "Backend direct: http://127.0.0.1:8001"
Write-Host "Backend via proxy: http://127.0.0.1:8080"
Write-Host "MongoDB: mongodb://127.0.0.1:27017"
Write-Host "Mailpit: http://127.0.0.1:8025"
Write-Host "MinIO console: http://127.0.0.1:9001"
Write-Host "LiveKit mode: $LiveKitMode"
if ($StartTauriDev) {
    Write-Host "Desktop web dev server: http://127.0.0.1:3000"
    Write-Host "Tauri logs: $desktopDir\.logs"
}
