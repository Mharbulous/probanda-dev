<#
.SYNOPSIS
Registers, or unregisters, the scheduled tasks that run the local implementer and
the GitHub Actions runner that starts it.

.DESCRIPTION
Registers the task "Probanda local implementer" for the current user only, with
no administrator rights: it runs as you, only while you are logged on, at limited
rights, and starts a missed run once you next log on. It runs once a day
overnight, at a time picked at random between 02:01 and 02:59 when registered (or
the time given with -At), plus up to 10 minutes of random delay each day. It wakes
the PC from sleep to run, but cannot run while you are signed out or the PC is
shut down. The daily run is the backstop.

It also registers the task "Probanda local runner", which starts GitHub's Actions
runner at logon and every 5 minutes after, so a runner that exits is back within 5
minutes, the same way: as you, at limited rights, with no stored password. The runner is what lets .github/workflows/local-implementer-trigger.yml
start the implementer task when a label puts an issue in the local lane. Install it
first in $env:LOCALAPPDATA\probanda-local-implementer\runner: extract GitHub's
actions-runner-win-x64 zip there, after checking its SHA-256 against the release notes,
then run config.cmd --unattended --url https://github.com/Mharbulous/probanda-dev
--token <token from POST repos/Mharbulous/probanda-dev/actions/runners/registration-token>
--labels probanda-local.

Before registering, it runs run-local-implementer.ps1 -PrepareOnly, which creates
the dedicated clone ($env:LOCALAPPDATA\probanda-local-implementer\probanda-dev)
when it is missing and checks it with the guard. The task runs the copy of
run-local-implementer.ps1 inside that clone, so each run uses the version on main.
It also writes the clone's .claude/settings.local.json, which allows git, gh, npm ci, python,
node and file edits in that clone only, so the unattended run can act; -Unregister
leaves that file, the clone and the logs in place.

Run it again to change the time; -Force replaces the old task.

.PARAMETER At
The daily start time, as HH:mm. Default: a random minute from 02:01 to 02:59.

.PARAMETER Unregister
Remove both tasks instead, stopping the runner. The clone, its logs and the runner's
folder and GitHub registration are left in place.
#>
[CmdletBinding()]
param(
    [string]$At,
    [switch]$Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'Probanda local implementer'
$RunnerTaskName = 'Probanda local runner'

if ($Unregister) {
    foreach ($name in @($TaskName, $RunnerTaskName)) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) {
            Write-Host "No task named '$name' is registered."
            continue
        }
        if ($name -eq $RunnerTaskName) {
            Stop-ScheduledTask -TaskName $name
            # Stopping the task leaves the runner's own process alive (seen 2026-11-04).
            Stop-Process -Name 'Runner.Listener' -Force -ErrorAction SilentlyContinue
        }
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Unregistered '$name'."
    }
    Write-Host "The clone, logs and runner under $env:LOCALAPPDATA\probanda-local-implementer are left in place."
    exit 0
}

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not set.' }
$Clone = Join-Path (Join-Path $env:LOCALAPPDATA 'probanda-local-implementer') 'probanda-dev'
$RunnerDir = Join-Path (Join-Path $env:LOCALAPPDATA 'probanda-local-implementer') 'runner'
$RunnerCmd = Join-Path $RunnerDir 'run.cmd'
if (-not (Test-Path -LiteralPath (Join-Path $RunnerDir '.runner'))) {
    throw "No configured runner in $RunnerDir. Install it first (see this script's description)."
}
$HereRun = Join-Path $PSScriptRoot 'run-local-implementer.ps1'
$CloneRun = Join-Path $Clone 'scripts\local-implementer\run-local-implementer.ps1'

if ($At) {
    $time = [datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
} else {
    $time = [datetime]::Today.AddHours(2).AddMinutes((Get-Random -Minimum 1 -Maximum 60))
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

# The unattended run's permissions (Brahm, 2026-10-26, option (a)): an allowlist in this clone's own
# .claude/settings.local.json, so they hold in this folder only. The repo's hooks still apply. The
# file is excluded in the clone's .git/info/exclude, so it never makes the clone dirty.
$localSettings = Join-Path $Clone '.claude\settings.local.json'
$allow = '{"permissions":{"allow":["Bash(git:*)","Bash(gh:*)","Bash(env -u GH_TOKEN gh:*)","Bash(env -u GH_TOKEN git:*)","Bash(npm ci:*)","Bash(python:*)","Bash(py:*)","Bash(node:*)","Edit","Write"]}}'
[IO.File]::WriteAllText($localSettings, $allow + "`n", (New-Object Text.UTF8Encoding $false))
$exclude = Join-Path $Clone '.git\info\exclude'
if (-not (Select-String -LiteralPath $exclude -SimpleMatch '/.claude/settings.local.json' -Quiet -ErrorAction SilentlyContinue)) {
    Add-Content -LiteralPath $exclude -Value '/.claude/settings.local.json'
}

$argLine = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $CloneRun
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine -WorkingDirectory $Clone
$trigger = New-ScheduledTaskTrigger -Daily -At $time -RandomDelay (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force `
    -Description 'Runs /implement-queue local in its own clone of probanda-dev, once a day.' | Out-Null

Write-Host ("Registered '{0}' for {1}: daily at {2:HH:mm}, plus up to 10 minutes. Runs {3}" -f $TaskName, $user, $time, $CloneRun)

# The runner, kept up while signed in. No time limit.
$runnerArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "& ''{0}''"' -f $RunnerCmd
$runnerAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $runnerArgs -WorkingDirectory $RunnerDir
# Task Scheduler's RestartCount covers only a failure to start, never a runner that exits (it stayed
# down from 2026-11-05 to 2026-11-07 that way). So a 5-minute repeat starts it again; IgnoreNew
# leaves a running one alone.
$runnerTriggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $user),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$runnerSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $RunnerTaskName -Action $runnerAction -Trigger $runnerTriggers -Settings $runnerSettings `
    -Principal $principal -Force `
    -Description 'Runs the GitHub Actions runner that starts the local implementer when a label queues an issue.' | Out-Null
Start-ScheduledTask -TaskName $RunnerTaskName
Write-Host "Registered and started '$RunnerTaskName': starts at logon and every 5 minutes. Runs $RunnerCmd"
