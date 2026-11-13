param(
  [ValidateSet('web','worker','dev','build')][string]$Mode = 'web',
  [string]$BaseUrl = '',
  [int]$Port = 3001
)
$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $previewRoot
$previewConfigPath = Join-Path $previewRoot '.local\operational-preview\config.json'
$previewConfig = Get-Content -LiteralPath $previewConfigPath -Raw | ConvertFrom-Json
if ($previewConfig.marker -ne 'git-tutor-operational-preview-v1') { throw 'Unexpected preview configuration.' }
$previewApi = [Uri]$previewConfig.url
$previewDb = [Uri]$previewConfig.database_url
if ($previewApi.Host -notin @('127.0.0.1','localhost') -or $previewApi.Port -ne 54331 -or $previewDb.Host -ne '127.0.0.1' -or $previewDb.Port -ne 54332) { throw 'The preview must use its separate local database.' }
if (-not $BaseUrl) {
  $previewUrlPath = Join-Path $previewRoot '.local\operational-preview\public-url.txt'
  if (Test-Path -LiteralPath $previewUrlPath) { $BaseUrl = (Get-Content -LiteralPath $previewUrlPath -Raw).Trim() }
  else { $BaseUrl = "http://127.0.0.1:$Port" }
}
$previewOrigin = [Uri]$BaseUrl
if ($previewOrigin.Scheme -notin @('http','https') -or $previewOrigin.UserInfo -or $previewOrigin.Query -or $previewOrigin.Fragment -or $previewOrigin.AbsolutePath -ne '/') { throw 'Provide a website origin without a path or credentials.' }
if ($previewOrigin.Scheme -ne 'https' -and $previewOrigin.Host -ne '127.0.0.1') { throw 'Remote preview addresses must use HTTPS.' }
$previewNode = $null
$previewRequiredVersion = 'v' + (Get-Content -LiteralPath '.node-version' -Raw).Trim()
if ($previewConfig.node_path -and (Test-Path -LiteralPath $previewConfig.node_path) -and ((& $previewConfig.node_path --version) -eq $previewRequiredVersion)) { $previewNode = $previewConfig.node_path }
$previewNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $previewNode -and $previewNodeCommand -and ((& $previewNodeCommand.Source --version) -eq $previewRequiredVersion)) { $previewNode = $previewNodeCommand.Source }
if (-not $previewNode) {
  $previewRuntimes = Get-ChildItem -LiteralPath 'C:\Program Files\WindowsApps' -Directory -Filter 'OpenAI.CodexPrimaryRuntime.*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  foreach ($previewRuntime in $previewRuntimes) {
    $previewCandidate = Join-Path $previewRuntime.FullName 'dependencies\node\bin\node.exe'
    if ((Test-Path -LiteralPath $previewCandidate) -and ((& $previewCandidate --version) -eq $previewRequiredVersion)) { $previewNode = $previewCandidate; break }
  }
}
if (-not $previewNode) { throw 'Node.js is unavailable. Open Codex, then try this command again.' }
$previewVersion = & $previewNode --version
if ($previewVersion -ne $previewRequiredVersion) { throw "Use the pinned Node.js version in .node-version (found $previewVersion)." }
$env:PATH = (Split-Path $previewNode) + [IO.Path]::PathSeparator + $env:PATH
$env:APP_ENV = 'development'
$env:APP_BASE_URL = $BaseUrl.TrimEnd('/')
$env:NEXT_PUBLIC_SUPABASE_URL = $previewConfig.url
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $previewConfig.publishable_key
$env:SUPABASE_SECRET_KEY = $previewConfig.secret_key
$env:WORKER_DATABASE_URL = $previewConfig.worker_database_url
$env:SECRET_ENCRYPTION_KEY = $previewConfig.secret_encryption_key
$env:SECRET_ENCRYPTION_KEY_ID = 'v1'
$env:EMAIL_ADAPTER = 'fake'
$env:CALENDAR_ADAPTER = 'fake'
$env:WHATSAPP_ADAPTER = 'fake'
$env:FILE_SCAN_ADAPTER = 'fake'
$env:PAYMENT_RECONCILIATION_ADAPTER = 'manual'
if ($Mode -eq 'worker') {
  & $previewNode --conditions=react-server --import tsx '.\src\worker\index.ts'
} elseif ($Mode -eq 'dev') {
  if ($previewOrigin.Host -ne '127.0.0.1') { throw 'Use a loopback address for the development server.' }
  & $previewNode '.\node_modules\next\dist\bin\next' dev --hostname 127.0.0.1 --port $Port
} elseif ($Mode -eq 'build') {
  & $previewNode '.\node_modules\next\dist\bin\next' build
} else {
  & $previewNode '.\node_modules\next\dist\bin\next' start --hostname 127.0.0.1 --port $Port
}
exit $LASTEXITCODE
