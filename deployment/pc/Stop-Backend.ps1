param([string]$ConfigFile = $env:RICOCHET_DEPLOY_CONFIG)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
Set-Content -LiteralPath $taskConfig.pauseFile -Value 'Intentionally paused.'
if (-not (Test-Path -LiteralPath $taskConfig.processFile)) { return }
$taskState = Get-Content -LiteralPath $taskConfig.processFile -Raw | ConvertFrom-Json
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskState.ProcessId)"
if (-not $taskProcess) { return }
if ($taskProcess.ExecutablePath -ne $taskState.Executable -or $taskProcess.CommandLine -notmatch 'dist[/\\]backend[/\\]server\.cjs' -or
    (Get-Process -Id $taskState.ProcessId).StartTime.ToUniversalTime() -ne ([datetime]$taskState.ProcessStartTime).ToUniversalTime()) { throw 'Backend process identity changed; nothing was stopped.' }
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 4103 -ErrorAction SilentlyContinue)
if (@($taskListeners | Where-Object { $_.OwningProcess -ne $taskState.ProcessId }).Count) { throw 'Port belongs to another process; nothing was stopped.' }
Stop-Process -Id $taskState.ProcessId
