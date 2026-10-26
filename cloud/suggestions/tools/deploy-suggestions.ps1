# Applies cloud/suggestions/suggestions.sql and deploys the six suggestion-* Edge Functions,
# in the order the lifecycle plan's Phase 1 and Phase 7 need: SQL, the functions, then the SQL
# again (it is idempotent, and the second apply gives an item to any row an old submit saved in
# between). Run from anywhere inside the probanda-dev checkout:
#
#   powershell -ExecutionPolicy Bypass -File cloud\suggestions\tools\deploy-suggestions.ps1
#   powershell -ExecutionPolicy Bypass -File cloud\suggestions\tools\deploy-suggestions.ps1 -Verify
#
# It asks for no key to deploy: the Supabase CLI uses its own login (`supabase login`). Only
# -Verify asks for the project secret key, hidden as it is typed, and passes it to triage.mjs
# alone. It stops at the first step that fails, and it prints and logs every line with anything
# that looks like a key replaced, so the output can be pasted safely.
#
# The CLI is found at SUPABASE_CLI_JS, then ~/tools/supabase-cli/node_modules/supabase/dist/supabase.js
# (where the development machine keeps it), then `supabase` on PATH.

param([switch]$Verify)

$ErrorActionPreference = 'Stop'
$ProjectRef = 'nbzkuhgiqscjkypedqff'
$Functions = @('suggestion-submit', 'suggestion-list', 'suggestion-set-status', 'suggestion-status',
  'suggestion-attach-specification', 'suggestion-withdraw')

$Root = (git rev-parse --show-toplevel 2>$null)
if (-not $Root) { Write-Host 'Run this from inside the probanda-dev checkout.'; exit 1 }
Set-Location $Root
$Log = Join-Path ([System.IO.Path]::GetTempPath()) ("suggestions-deploy-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Hide-Keys([string]$Text) {
  $Text = $Text -replace 'sb_secret_[A-Za-z0-9_-]+', 'sb_secret_[hidden]'
  $Text = $Text -replace 'sbp_[A-Za-z0-9_-]+', 'sbp_[hidden]'
  $Text = $Text -replace 'pb_install_[A-Za-z0-9_-]+', 'pb_install_[hidden]'
  $Text = $Text -replace 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[token hidden]'
  return $Text
}

# The comma keeps a one-element answer an array, so `$Cli + @(...)` appends rather than joins text.
function Find-Cli {
  $candidates = @($env:SUPABASE_CLI_JS, (Join-Path $HOME 'tools/supabase-cli/node_modules/supabase/dist/supabase.js'))
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return ,@('node', $c) } }
  if (Get-Command supabase -ErrorAction SilentlyContinue) { return ,@('supabase') }
  return $null
}

function Invoke-Step([string]$Name, [string[]]$Command) {
  Write-Host "== $Name"
  $exe = $Command[0]
  $rest = @($Command | Select-Object -Skip 1)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $exe @rest 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  $text = Hide-Keys ($out -join "`n")
  Add-Content -Path $Log -Value "== $Name (exit $code)`n$text"
  if ($text) { Write-Host $text }
  if ($code -ne 0) {
    Write-Host "STOPPED at: $Name (exit $code). Nothing after it ran. Log, keys hidden: $Log"
    exit 1
  }
}

$Cli = Find-Cli
if (-not $Cli) {
  Write-Host 'The Supabase CLI was not found. Set SUPABASE_CLI_JS to its supabase.js, or put supabase on PATH.'
  exit 1
}

if ($Verify) {
  $secure = Read-Host 'Supabase project secret key (hidden)' -AsSecureString
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password
  $env:POOL_SECRET_KEY = $plain
  try {
    Invoke-Step 'List every suggestion' @('node', 'cloud/suggestions/tools/triage.mjs', 'list', '--all')
  } finally {
    Remove-Item Env:POOL_SECRET_KEY -ErrorAction SilentlyContinue
  }
  Write-Host "Done. Each suggestion should show an item_list with at least one item. Log: $Log"
  exit 0
}

# db query takes a scratch workdir, as cloud/items/tools/check_items.mjs does, so no supabase/.temp lands in the repo.
$QueryDir = Join-Path ([System.IO.Path]::GetTempPath()) ("suggestions-query-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $QueryDir | Out-Null
$Sql = Join-Path $Root 'cloud/suggestions/suggestions.sql'
$Apply = $Cli + @('db', 'query', '--linked', '--project-ref', $ProjectRef, '--workdir', $QueryDir, '-f', $Sql)

Invoke-Step 'Check the CLI is logged in' ($Cli + @('projects', 'list'))
Invoke-Step 'Apply suggestions.sql' $Apply
Invoke-Step 'Deploy the six suggestion functions' ($Cli + @('functions', 'deploy') + $Functions +
  @('--use-api', '--project-ref', $ProjectRef, '--workdir', 'cloud/legal-commons'))
Invoke-Step 'Apply suggestions.sql again' $Apply
Write-Host "Done. Now run it again with -Verify to list the suggestions. Log, keys hidden: $Log"
