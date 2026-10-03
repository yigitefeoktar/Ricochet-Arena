param([string]$ConfigFile = $env:RICOCHET_DEPLOY_CONFIG)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$taskCurrent = Get-Content -LiteralPath $taskConfig.currentFile -Raw | ConvertFrom-Json
$taskNode = (Get-Command node.exe).Source
$taskRoot = $taskCurrent.directory
$taskBundle = Join-Path $taskRoot 'dist/backend/server.cjs'
if (-not (Test-Path -LiteralPath $taskBundle)) { throw 'Recorded active release has no backend bundle.' }
if (@(Get-NetTCPConnection -State Listen -LocalPort 4103 -ErrorAction SilentlyContinue).Count) { throw 'Port 4103 is occupied; no unrelated process was stopped.' }
$taskPrevious = @{NODE_ENV=$env:NODE_ENV; HOST=$env:HOST; PORT=$env:PORT; SERVE_FRONTEND=$env:SERVE_FRONTEND}
try {
    $env:NODE_ENV='production'; $env:HOST='127.0.0.1'; $env:PORT='4103'; $env:SERVE_FRONTEND='false'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList 'dist/backend/server.cjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskConfig.root 'backend.stdout.log') -RedirectStandardError (Join-Path $taskConfig.root 'backend.stderr.log') -PassThru
    [PSCustomObject]@{ProcessId=$taskProcess.Id;ProcessStartTime=$taskProcess.StartTime.ToUniversalTime().ToString('o');Executable=$taskNode;WorkingDirectory=$taskRoot;Bundle=$taskBundle;Commit=$taskCurrent.commit;URL='http://127.0.0.1:4103'} | ConvertTo-Json | Set-Content -LiteralPath $taskConfig.processFile -Encoding utf8
    for ($taskAttempt=0; $taskAttempt -lt 30; $taskAttempt++) {
        try { if ((Invoke-RestMethod 'http://127.0.0.1:4103/api/health' -TimeoutSec 1).status -eq 'ok') { Write-Output "Healthy backend: $($taskCurrent.commit)"; return } }
        catch { Start-Sleep -Milliseconds 200 }
    }
    throw 'Active release did not become healthy.'
} finally {
    $env:NODE_ENV=$taskPrevious.NODE_ENV; $env:HOST=$taskPrevious.HOST; $env:PORT=$taskPrevious.PORT; $env:SERVE_FRONTEND=$taskPrevious.SERVE_FRONTEND
}
