$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $env:RICOCHET_DEPLOY_CONFIG -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath $taskConfig.pauseFile) { throw 'Backend was intentionally paused while candidate was building.' }
$taskReleases = [IO.Path]::GetFullPath((Join-Path $taskConfig.root 'releases'))
$taskRelease = [IO.Path]::GetFullPath($env:RICOCHET_RELEASE)
if ((Split-Path $taskRelease -Parent) -ne $taskReleases -or (Split-Path $taskRelease -Leaf) -notmatch '^[a-f0-9]{40}$') { throw 'Release is outside the designated release root.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRelease 'dist/backend/server.cjs'))) { throw 'Candidate bundle is missing.' }
$taskOld = Get-Content -LiteralPath $taskConfig.currentFile -Raw
$taskOldRelease = ($taskOld | ConvertFrom-Json).directory
& $taskConfig.stopScript | Out-Null
Stop-ScheduledTask -TaskName $taskConfig.watcherTask -ErrorAction SilentlyContinue
try {
    [PSCustomObject]@{directory=$taskRelease;commit=$env:RICOCHET_COMMIT;previous=$taskOldRelease} | ConvertTo-Json | Set-Content -LiteralPath $taskConfig.currentFile -Encoding utf8
    & $taskConfig.startScript | Out-Null
} catch {
    $taskFailure = $_
    # Start records identity before checking health; stop only that owned process if still present.
    & $taskConfig.stopScript | Out-Null
    Set-Content -LiteralPath $taskConfig.currentFile -Value $taskOld -Encoding utf8
    & $taskConfig.startScript | Out-Null
    throw "Activation failed and previous release was restored: $taskFailure"
} finally {
    Remove-Item -LiteralPath $taskConfig.pauseFile -Force -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $taskConfig.watcherTask -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $taskConfig.watcherTask }
}
Write-Output "Activated GitHub main $env:RICOCHET_COMMIT"
