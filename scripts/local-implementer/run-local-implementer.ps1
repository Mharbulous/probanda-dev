<#
.SYNOPSIS
Runs the local implementer once: the local lane of /implement-suggestions, in its own clone.

.DESCRIPTION
Started each day by the scheduled task that register-local-implementer.ps1 registers
under the current user. Needs no administrator rights.

1. Creates the dedicated clone on first run:
   $env:LOCALAPPDATA\probanda-local-implementer\probanda-dev
   It is never the shared checkout or a worktree of it.
2. Fetches origin and fast-forwards main. A clone that is dirty, off main, or has
   diverged from origin/main is left for Brahm, and the run stops.
3. Runs scripts/local_implementer_guard.py in the clone, which refuses any other folder.
4. Runs npm ci --ignore-scripts in source/lawyer/mcp, from the committed lockfile, so
   the run's Node builds and tests work and the model never installs anything. Brahm
   approved this on 2026-11-02: the user-level package-install guard reserves installs
   for the human, and this script is the one he registered.
5. Runs Claude Code headless there: claude -p "/implement-suggestions local".
   It passes --permission-mode dontAsk, so a user-wide default of plan mode
   cannot stop the run before it writes, and anything not allowed is refused
   without a prompt. The run gets only the permissions the repo's
   .claude/settings.json, the clone's own .claude/settings.local.json (written by
   register-local-implementer.ps1) and the user's Claude Code settings grant.

Each run logs to $env:LOCALAPPDATA\probanda-local-implementer\logs\run-<time>.log.
The log holds what git, the guard and Claude Code print, and never the environment.

.PARAMETER PrepareOnly
Create or update the clone, run the guard and install the packages, but do not start Claude Code.
#>
[CmdletBinding()]
param(
    [switch]$PrepareOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/Mharbulous/probanda-dev.git'
$Prompt = '/implement-suggestions local'

if (-not $env:LOCALAPPDATA) {
    Write-Error 'LOCALAPPDATA is not set, so the local implementer has no home folder.'
    exit 1
}
$AppHome = Join-Path $env:LOCALAPPDATA 'probanda-local-implementer'
$Clone = Join-Path $AppHome 'probanda-dev'
$LogDir = Join-Path $AppHome 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir ('run-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
    Write-Host $line
}

function Stop-Run([string]$Message) {
    Write-Log "STOPPED: $Message"
    exit 1
}

# Runs a native command, appends its output to the log, and returns its exit code.
# Stderr is merged into the log; with 'Stop' in force, PowerShell 5.1 would throw on it.
function Invoke-Logged([string]$Exe, [string[]]$Arguments) {
    Write-Log ("> {0} {1}" -f $Exe, ($Arguments -join ' '))
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } | Add-Content -LiteralPath $Log -Encoding UTF8
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $saved
    }
}

# Runs git in the clone and returns its trimmed output, or $null when it fails.
function Get-GitOutput([string[]]$Arguments) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $Clone @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (($out | Out-String).Trim())
    } finally {
        $ErrorActionPreference = $saved
    }
}

function Find-Exe([string[]]$Names) {
    foreach ($name in $Names) {
        $cmd = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

Write-Log "Local implementer run. Clone: $Clone"

$Git = Find-Exe @('git')
if (-not $Git) { Stop-Run 'git is not on PATH.' }
$Python = Find-Exe @('python', 'py')
if (-not $Python) { Stop-Run 'python is not on PATH.' }

# 1. The clone, created on first run.
if (-not (Test-Path -LiteralPath $Clone)) {
    Write-Log 'No clone yet: cloning.'
    if ((Invoke-Logged $Git @('clone', $RepoUrl, $Clone)) -ne 0) { Stop-Run 'git clone failed.' }
}

# 2. Fetch and fast-forward main.
if ((Invoke-Logged $Git @('-C', $Clone, 'config', 'core.filemode', 'false')) -ne 0) { Stop-Run 'git config failed.' }
if ((Invoke-Logged $Git @('-C', $Clone, 'fetch', 'origin')) -ne 0) { Stop-Run 'git fetch failed.' }
$branch = Get-GitOutput @('rev-parse', '--abbrev-ref', 'HEAD')
if ($branch -ne 'main') { Stop-Run "the clone is on '$branch', not main. Left for Brahm." }
$dirty = Get-GitOutput @('status', '--porcelain')
if ($null -eq $dirty) { Stop-Run 'git status failed.' }
if ($dirty -ne '') { Stop-Run 'the clone has uncommitted changes, left by an earlier run. Left for Brahm.' }
if ((Invoke-Logged $Git @('-C', $Clone, 'merge', '--ff-only', 'origin/main')) -ne 0) {
    Stop-Run 'main cannot fast-forward to origin/main: the clone holds unpushed commits. Left for Brahm.'
}

# 3. The guard.
Push-Location -LiteralPath $Clone
try {
    if ((Invoke-Logged $Python @('scripts/local_implementer_guard.py')) -ne 0) {
        Stop-Run 'the guard refused this folder (see the line above).'
    }

    # 4. The Node packages, from the committed lockfile, with no install scripts.
    $Npm = Find-Exe @('npm.cmd', 'npm')
    if (-not $Npm) { Stop-Run 'npm is not on PATH.' }
    Push-Location -LiteralPath (Join-Path $Clone 'source\lawyer\mcp')
    try {
        if ((Invoke-Logged $Npm @('ci', '--ignore-scripts')) -ne 0) { Stop-Run 'npm ci failed (see the lines above).' }
    } finally {
        Pop-Location
    }

    if ($PrepareOnly) {
        Write-Log 'Prepared. Claude Code not started (-PrepareOnly).'
        exit 0
    }

    # 5. Claude Code, headless, on the local lane.
    $Claude = Find-Exe @('claude')
    if (-not $Claude) { Stop-Run 'claude is not on PATH.' }
    $code = Invoke-Logged $Claude @('-p', $Prompt, '--permission-mode', 'dontAsk')
    Write-Log "Claude Code exited with $code."
    exit $code
} finally {
    Pop-Location
}
