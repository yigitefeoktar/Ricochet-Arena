param([Parameter(Mandatory=$true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$taskConfigPath = [IO.Path]::GetFullPath($ConfigFile)
$taskConfig = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
if ($taskConfig.repository -ne 'https://github.com/yigitefeoktar/Ricochet-Arena.git' -or $taskConfig.watcherTask -ne 'Codex-Ricochet-Backend') { throw 'This installer is only for the explicitly enabled Ricochet installation.' }
if (-not (Test-Path -LiteralPath $taskConfig.currentFile)) { throw 'Create the active release pointer before installing startup tasks.' }
$taskCurrent = Get-Content -LiteralPath $taskConfig.currentFile -Raw | ConvertFrom-Json
$taskManifest = Get-Content -LiteralPath (Join-Path $taskCurrent.directory 'deployment.json') -Raw | ConvertFrom-Json
if ($taskManifest.backend.provider -ne 'pc') { throw 'No enabled PC backend; tasks were not installed.' }
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
foreach ($taskDefinition in @(@{name=$taskConfig.watcherTask;script='Watch-Backend.ps1'},@{name='Codex-Ricochet-GitHub-Updates';script='Run-Updater.ps1'})) {
    $taskExisting = Get-ScheduledTask -TaskName $taskDefinition.name -ErrorAction SilentlyContinue
    if ($taskExisting) {
        $taskExpectedScript = Join-Path $PSScriptRoot $taskDefinition.script
        if ($taskExisting.Actions.Arguments -notlike "*$taskExpectedScript*" -and $taskExisting.Actions.Arguments -notlike "*$($taskDefinition.script)*") { throw 'Existing task has an unexpected action; preserve it and inspect manually.' }
        Export-ScheduledTask -TaskName $taskDefinition.name | Set-Content -LiteralPath (Join-Path $taskConfig.root "$($taskDefinition.name).previous.xml")
    }
    $taskArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot $taskDefinition.script) + '" -ConfigFile "' + $taskConfigPath + '"'
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments
    Register-ScheduledTask -TaskName $taskDefinition.name -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
}
Write-Output 'Installed sign-in startup tasks. Start them explicitly after checking the active backend.'
