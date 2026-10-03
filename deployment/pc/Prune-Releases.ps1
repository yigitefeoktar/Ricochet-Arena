$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $env:RICOCHET_DEPLOY_CONFIG -Raw | ConvertFrom-Json
$taskRoot = [IO.Path]::GetFullPath((Join-Path $taskConfig.root 'releases'))
$taskCurrent = Get-Content -LiteralPath $taskConfig.currentFile -Raw | ConvertFrom-Json
$taskKeep = @($taskCurrent.directory, $taskCurrent.previous)
$taskAll = @(Get-ChildItem -LiteralPath $taskRoot -Directory | Sort-Object LastWriteTime -Descending)
$taskKeep += @($taskAll | Select-Object -First 1 | ForEach-Object { $_.FullName })
foreach ($taskItem in $taskAll) {
    $taskTarget = [IO.Path]::GetFullPath($taskItem.FullName)
    if ((Split-Path $taskTarget -Parent) -ne $taskRoot -or $taskItem.Name -notmatch '^[a-f0-9]{40}$' -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unrecognized release directory; pruning aborted.' }
    if ($taskTarget -notin $taskKeep) { Remove-Item -LiteralPath $taskTarget -Recurse -Force }
}
