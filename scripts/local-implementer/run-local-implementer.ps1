<#
.SYNOPSIS
Runs the local implementer once: the local lane of /implement-queue, in its own clone.

.DESCRIPTION
Started by the scheduled task that register-local-implementer.ps1 registers under the
current user: when a label puts an issue in the local lane, and once a day as a backstop.
Needs no administrator rights.

1. Creates the dedicated clone on first run:
   $env:LOCALAPPDATA\probanda-local-implementer\probanda-dev
   It is never the shared checkout or a worktree of it.
2. Fetches origin and fast-forwards main. A clone off main stops the run. A clone that is
   dirty or holds unpushed commits, left by an earlier run, is saved to
   logs\recovered-<time>.patch and reset to origin/main, unless the local implementer lock
   is live, which stops the run.
3. Runs scripts/local_implementer_guard.py in the clone, which refuses any other folder.
4. Runs npm ci --ignore-scripts in source/lawyer/mcp, source/researcher/commons-mcp and
   source/researcher/canlii-mcp, each from its committed lockfile, so the run's Node
   builds and tests work and the model never installs anything. Brahm approved this on
   2026-11-02 and, for the two researcher folders, on 2026-11-04: the user-level
   package-install guard reserves installs for the human, and this script is the one
   he registered.
5. Exits when the local queue is empty, so an extra start costs no tokens. Otherwise runs
   Claude Code headless there: claude -p "/implement-queue local".
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
$Prompt = '/implement-queue local'
$RepoApi = 'repos/Mharbulous/probanda-dev'

# gh prefers GH_TOKEN over its keyring login, and a stale value fails every call.
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue

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

# Saves a GitHub list to a file and returns choose_issue.py's reply about it for the local lane.
# cmd's redirect keeps gh's UTF-8 bytes, which a PowerShell 5.1 redirect would re-encode.
function Get-ChooseIssue([string]$Endpoint, [string]$Command, [string]$FileFlag) {
    $tmp = Join-Path $AppHome 'tmp'
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $file = Join-Path $tmp 'choose-issue-input.json'
    cmd /c "gh api --paginate `"$Endpoint`" > `"$file`" 2>> `"$Log`""
    if ($LASTEXITCODE -ne 0) { Stop-Run "gh could not read $Endpoint." }
    $reply = & $Python (Join-Path $Clone 'scripts\choose_issue.py') $Command '--lane' 'local' $FileFlag $file
    if ($LASTEXITCODE -ne 0) { Stop-Run "choose_issue.py $Command could not read $Endpoint." }
    return ($reply | Out-String | ConvertFrom-Json)
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
$unpushed = Get-GitOutput @('rev-list', '--count', 'origin/main..HEAD')
if ($null -eq $unpushed) { Stop-Run 'git rev-list failed.' }
if ($dirty -ne '' -or $unpushed -ne '0') {
    # Work left by an earlier run. Nothing is lost: the patch holds it, against the commit it names.
    if ((Get-ChooseIssue "$RepoApi/issues/189/comments?per_page=100" 'lock' '--comments').state -ne 'free') {
        Stop-Run 'the clone holds uncommitted or unpushed work and the local implementer lock is live.'
    }
    $base = Get-GitOutput @('merge-base', 'HEAD', 'origin/main')
    if (-not $base) { Stop-Run 'git merge-base failed.' }
    $patch = Join-Path $LogDir ('recovered-{0}.patch' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if ((Invoke-Logged $Git @('-C', $Clone, 'log', '--oneline', 'origin/main..HEAD')) -ne 0) { Stop-Run 'git log failed.' }
    if ((Invoke-Logged $Git @('-C', $Clone, 'add', '-A')) -ne 0) { Stop-Run 'git add failed.' }
    if ((Invoke-Logged $Git @('-C', $Clone, 'diff', '--cached', '--binary', "--output=$patch", $base)) -ne 0) { Stop-Run 'saving the patch failed.' }
    if ((Invoke-Logged $Git @('-C', $Clone, 'reset', '--hard', 'origin/main')) -ne 0) { Stop-Run 'git reset failed.' }
    if ((Invoke-Logged $Git @('-C', $Clone, 'clean', '-fd')) -ne 0) { Stop-Run 'git clean failed.' }
    Write-Log "Recovered leftover work to $patch, against $base."
}
if ((Invoke-Logged $Git @('-C', $Clone, 'merge', '--ff-only', 'origin/main')) -ne 0) {
    Stop-Run 'main cannot fast-forward to origin/main.'
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
    foreach ($package in @('source\lawyer\mcp', 'source\researcher\commons-mcp', 'source\researcher\canlii-mcp')) {
        Push-Location -LiteralPath (Join-Path $Clone $package)
        try {
            if ((Invoke-Logged $Npm @('ci', '--ignore-scripts')) -ne 0) { Stop-Run 'npm ci failed (see the lines above).' }
        } finally {
            Pop-Location
        }
    }

    if ($PrepareOnly) {
        Write-Log 'Prepared. Claude Code not started (-PrepareOnly).'
        exit 0
    }

    # 5. Claude Code, headless, on the local lane, unless the queue is empty.
    $queue = @((Get-ChooseIssue "$RepoApi/issues?labels=ready-for-agent,local&state=open&per_page=100" 'queue' '--issues').queue)
    if ($queue.Count -eq 0) {
        Write-Log 'The local queue is empty. Claude Code not started.'
        exit 0
    }
    Write-Log ("Local queue: {0}" -f ($queue -join ' '))
    $Claude = Find-Exe @('claude')
    if (-not $Claude) { Stop-Run 'claude is not on PATH.' }
    $code = Invoke-Logged $Claude @('-p', $Prompt, '--permission-mode', 'dontAsk')
    Write-Log "Claude Code exited with $code."
    exit $code
} finally {
    Pop-Location
}
