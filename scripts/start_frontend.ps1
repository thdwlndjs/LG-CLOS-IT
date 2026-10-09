$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot 'web'
$resultsRoot = Join-Path $projectRoot 'test-results'
if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'dist/index.html'))) {
    throw 'Run npm --prefix web ci and npm --prefix web run build first.'
}
if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output 'Port 5173 already has a listener. It was not changed.'
    exit 0
}
New-Item -ItemType Directory -Path $resultsRoot -Force | Out-Null
$viteEntry = Join-Path $webRoot 'node_modules/vite/bin/vite.js'
$frontendProcess = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @(('"' + $viteEntry + '"'), 'preview') `
    -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $resultsRoot 'frontend-server.log') `
    -RedirectStandardError (Join-Path $resultsRoot 'frontend-server-error.log')
$frontendProcess.Id | Set-Content -LiteralPath (Join-Path $resultsRoot 'frontend-server.pid')
Write-Output ('Frontend process ' + $frontendProcess.Id + ': http://127.0.0.1:5173')
