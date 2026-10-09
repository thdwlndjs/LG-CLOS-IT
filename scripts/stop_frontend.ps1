$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot 'test-results/frontend-server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Output 'No recorded frontend process.'
    exit 0
}
$frontendId = [int](Get-Content -LiteralPath $pidFile)
$frontendProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $frontendId)
if ($frontendProcess) {
    $viteEntry = Join-Path $projectRoot 'web/node_modules/vite/bin/vite.js'
    if (-not $frontendProcess.CommandLine.Contains($viteEntry)) {
        throw 'Recorded PID does not identify this workspace frontend. No process was stopped.'
    }
    Stop-Process -Id $frontendId
}
Remove-Item -LiteralPath $pidFile
Write-Output 'Recorded frontend server stopped. Backend services were not changed.'
