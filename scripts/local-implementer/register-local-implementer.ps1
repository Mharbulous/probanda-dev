<#
.SYNOPSIS
Registers, or unregisters, the daily scheduled task that runs the local implementer.

.DESCRIPTION
Registers the task "Probanda local implementer" for the current user only, with
no administrator rights: it runs as you, only while you are logged on, at limited
rights, and starts a missed run once you next log on. It runs once a day in the
morning, at a time picked at random between 07:01 and 07:59 when registered
(or the time given with -At), plus up to 10 minutes of random delay each day.

Before registering, it runs run-local-implementer.ps1 -PrepareOnly, which creates
the dedicated clone ($env:LOCALAPPDATA\probanda-local-implementer\probanda-dev)
when it is missing and checks it with the guard. The task runs the copy of
run-local-implementer.ps1 inside that clone, so each run uses the version on main.

Run it again to change the time; -Force replaces the old task.

.PARAMETER At
The daily start time, as HH:mm. Default: a random minute from 07:01 to 07:59.

.PARAMETER Unregister
Remove the task instead. The clone and its logs are left in place.
#>
[CmdletBinding()]
param(
    [string]$At,
    [switch]$Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'Probanda local implementer'

if ($Unregister) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Host "No task named '$TaskName' is registered."
        exit 0
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Unregistered '$TaskName'. The clone and logs under $env:LOCALAPPDATA\probanda-local-implementer are left in place."
    exit 0
}

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set.' }
$Clone = Join-Path (Join-Path $env:LOCALAPPDATA 'probanda-local-implementer') 'probanda-dev'
$HereRun = Join-Path $PSScriptRoot 'run-local-implementer.ps1'
$CloneRun = Join-Path $Clone 'scripts\local-implementer\run-local-implementer.ps1'

if ($At) {
    $time = [datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
} else {
    $time = [datetime]::Today.AddHours(7).AddMinutes((Get-Random -Minimum 1 -Maximum 60))
}

# Create or update the clone, and check it with the guard, before pointing the task at it.
$prepare = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $HereRun, '-PrepareOnly')
& powershell.exe @prepare
if ($LASTEXITCODE -ne 0) {
    throw "Preparing the clone failed (exit $LASTEXITCODE). See the newest log under $env:LOCALAPPDATA\probanda-local-implementer\logs."
}
if (-not (Test-Path -LiteralPath $CloneRun)) {
    throw "The clone has no $CloneRun yet: main does not carry the local implementer scripts."
}

$argLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $CloneRun
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine -WorkingDirectory $Clone
$trigger = New-ScheduledTaskTrigger -Daily -At $time -RandomDelay (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force `
    -Description 'Runs /implement-suggestions local in its own clone of probanda-dev, once a day.' | Out-Null

Write-Host ("Registered '{0}' for {1}: daily at {2:HH:mm}, plus up to 10 minutes. Runs {3}" -f $TaskName, $user, $time, $CloneRun)
