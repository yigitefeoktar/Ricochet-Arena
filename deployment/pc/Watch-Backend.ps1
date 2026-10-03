param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$env:RICOCHET_DEPLOY_CONFIG = $ConfigFile
$taskConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
[PSCustomObject]@{ProcessId=$PID;StartTime=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');Script=$PSCommandPath} | ConvertTo-Json | Set-Content -LiteralPath $taskConfig.watchProcessFile
$taskLog = Join-Path $taskConfig.root 'watcher.log'
function Write-WatchLog([string]$Message) {
    if ((Test-Path -LiteralPath $taskLog) -and (Get-Item -LiteralPath $taskLog).Length -gt 1MB) { Move-Item -LiteralPath $taskLog -Destination "$taskLog.previous" -Force }
    Add-Content -LiteralPath $taskLog -Value "$(Get-Date -Format o) $Message"
}
while (-not (Test-Path -LiteralPath $taskConfig.pauseFile)) {
    try {
        $taskProcess = $null
        if (Test-Path -LiteralPath $taskConfig.processFile) {
            $taskState = Get-Content -LiteralPath $taskConfig.processFile -Raw | ConvertFrom-Json
            $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskState.ProcessId)"
            if ($taskProcess -and ($taskProcess.ExecutablePath -ne $taskState.Executable -or $taskProcess.CommandLine -notmatch 'dist[/\\]backend[/\\]server\.cjs' -or
                (Get-Process -Id $taskState.ProcessId).StartTime.ToUniversalTime() -ne ([datetime]$taskState.ProcessStartTime).ToUniversalTime())) { throw 'Recorded process identity changed; recovery refused.' }
        }
        if (-not $taskProcess) {
            foreach ($taskStream in @('stdout','stderr')) {
                $taskFile = Join-Path $taskConfig.root "backend.$taskStream.log"
                if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination "$taskFile.previous" -Force }
            }
            & $taskConfig.startScript | Out-Null
            Write-WatchLog 'Active release restarted.'
        }
    } catch { Write-WatchLog "Recovery deferred: $($_.Exception.Message)" }
    Start-Sleep -Seconds 5
}
