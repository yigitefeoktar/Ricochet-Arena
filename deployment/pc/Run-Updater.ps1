param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$taskNode = (Get-Command node.exe).Source
$taskScript = Join-Path $PSScriptRoot 'update.cjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskScript + '"'), ('"' + $ConfigFile + '"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskConfig.root 'updater.stdout.log') -RedirectStandardError (Join-Path $taskConfig.root 'updater.stderr.log') -PassThru
[PSCustomObject]@{ProcessId=$taskProcess.Id;ProcessStartTime=$taskProcess.StartTime.ToUniversalTime().ToString('o');Executable=$taskNode;Script=$taskScript} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskConfig.root 'updater-process.json')
$taskProcess.WaitForExit()
if ($taskProcess.ExitCode -ne 0) { throw "Updater exited with code $($taskProcess.ExitCode)" }
