param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($TestRoot)
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskOld = Join-Path $taskRoot 'old'
$taskSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$taskCandidate = Join-Path $taskRoot "releases/$taskSha"
New-Item -ItemType Directory -Path (Join-Path $taskCandidate 'dist/backend') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskCandidate 'dist/backend/server.cjs') -Value '// test fixture'
$taskConfig = [PSCustomObject]@{root=$taskRoot;currentFile=(Join-Path $taskRoot 'current.json');pauseFile=(Join-Path $taskRoot 'paused');watcherTask='Codex-Ricochet-Test-Task-Does-Not-Exist';startScript=(Join-Path $taskRoot 'fake-start.ps1');stopScript=(Join-Path $taskRoot 'fake-stop.ps1')}
$taskConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'config.json')
[PSCustomObject]@{directory=$taskOld;commit='old'} | ConvertTo-Json | Set-Content -LiteralPath $taskConfig.currentFile
Set-Content -LiteralPath $taskConfig.stopScript -Value @'
$fixtureConfig = Get-Content -LiteralPath $env:RICOCHET_DEPLOY_CONFIG -Raw | ConvertFrom-Json
Set-Content -LiteralPath $fixtureConfig.pauseFile -Value 'paused'
'@
Set-Content -LiteralPath $taskConfig.startScript -Value @'
$fixtureConfig = Get-Content -LiteralPath $env:RICOCHET_DEPLOY_CONFIG -Raw | ConvertFrom-Json
$fixtureCurrent = Get-Content -LiteralPath $fixtureConfig.currentFile -Raw | ConvertFrom-Json
if ($fixtureCurrent.commit -ne 'old' -and -not (Test-Path -LiteralPath (Join-Path $fixtureConfig.root 'allow-candidate'))) { throw 'Simulated startup failure after preflight' }
Set-Content -LiteralPath (Join-Path $fixtureConfig.root 'running.txt') -Value $fixtureCurrent.directory
'@
$env:RICOCHET_DEPLOY_CONFIG = Join-Path $taskRoot 'config.json'
$env:RICOCHET_RELEASE = $taskCandidate
$env:RICOCHET_COMMIT = $taskSha
$taskFailed = $false
try { & (Join-Path $PSScriptRoot 'Activate-Ricochet.ps1') } catch { $taskFailed = $true }
if (-not $taskFailed -or (Get-Content -LiteralPath $taskConfig.currentFile -Raw | ConvertFrom-Json).directory -ne $taskOld -or (Get-Content -LiteralPath (Join-Path $taskRoot 'running.txt')).Trim() -ne $taskOld) { throw 'Rollback did not restart the previous release.' }
if (Test-Path -LiteralPath $taskConfig.pauseFile) { throw 'Recovery was left paused after rollback.' }
Set-Content -LiteralPath (Join-Path $taskRoot 'allow-candidate') -Value 'allowed'
& (Join-Path $PSScriptRoot 'Activate-Ricochet.ps1') | Out-Null
if ((Get-Content -LiteralPath $taskConfig.currentFile -Raw | ConvertFrom-Json).directory -ne $taskCandidate) { throw 'Healthy activation did not change the pointer.' }
Write-Output 'PASS: failed activation restored and restarted the old release; healthy activation switched; recovery resumed.'
