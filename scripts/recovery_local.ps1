# Reopen only the reconstructed persistent demo. No restart, seed or migration.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$evidence = Join-Path $projectRoot 'test-results/recovery-normalization'
if (-not (Test-Path -LiteralPath (Join-Path $evidence 'runtime.json'))) {
    throw 'Protected recovered runtime is required; do not regenerate credentials.'
}
Push-Location $projectRoot
try {
    docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Engine unavailable; no automatic restart.' }
    docker compose --env-file test-results/recovery-normalization/.env.recovery -f infra/compose.demo-recovery.yaml up -d --no-build postgres minio redis renderer
    if ($LASTEXITCODE -ne 0) { throw 'New persistent services failed to start.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (-not (Get-NetTCPConnection -LocalPort 18083 -State Listen -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath (Join-Path $projectRoot '.venv/Scripts/python.exe') -ArgumentList 'scripts/recovery_api_local.py' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $evidence "api-$stamp.out.log") -RedirectStandardError (Join-Path $evidence "api-$stamp.err.log") | Out-Null
    }
    if (-not (Get-NetTCPConnection -LocalPort 5196 -State Listen -ErrorAction SilentlyContinue)) {
        $env:WEB_API_TARGET = 'http://127.0.0.1:18083'
        $env:WEB_STORAGE_TARGET = 'http://127.0.0.1:19100'
        $env:WEB_PORT = '5196'
        $env:VITE_HANDOFF_SCENE = 'on'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' -WorkingDirectory (Join-Path $projectRoot 'web') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $evidence "web-$stamp.out.log") -RedirectStandardError (Join-Path $evidence "web-$stamp.err.log") | Out-Null
    }
    Write-Output 'Recovered demo: http://127.0.0.1:5196/ (API 18083, MinIO 19100)'
} finally {
    Pop-Location
}
