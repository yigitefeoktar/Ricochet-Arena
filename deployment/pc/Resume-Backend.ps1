param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
Remove-Item -LiteralPath $taskConfig.pauseFile -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskConfig.watcherTask
if (Get-ScheduledTask -TaskName 'Codex-Ricochet-GitHub-Updates' -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName 'Codex-Ricochet-GitHub-Updates' }
Write-Output 'Backend recovery and GitHub updates resumed.'
