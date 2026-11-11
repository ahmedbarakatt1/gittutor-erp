$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = Join-Path $projectRoot '.local'
$dataRoot = Join-Path $localRoot 'postgres'
$pgBin = if ($env:GITTUTOR_POSTGRES_BIN) { $env:GITTUTOR_POSTGRES_BIN } else { 'C:\Program Files\PostgreSQL\17\bin' }
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'initdb.exe'))) { throw 'Set GITTUTOR_POSTGRES_BIN to an installed PostgreSQL 17 bin directory.' }
New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
$manifestPath = Join-Path $localRoot 'database.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  if (Test-Path -LiteralPath $dataRoot) { throw 'Existing unowned database directory: refusing to initialize.' }
  $databasePassword = [Guid]::NewGuid().ToString('N')
  $workerPassword = [Guid]::NewGuid().ToString('N')
  @{ port = 55432; username = 'postgres'; password = $databasePassword; worker_password = $workerPassword; marker = 'git-tutor-disposable-v1' } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.marker -ne 'git-tutor-disposable-v1' -or $manifest.port -ne 55432) { throw 'Invalid local database manifest.' }
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
  $passwordPath = Join-Path $localRoot 'init-password.tmp'
  try {
    Set-Content -LiteralPath $passwordPath -Value $manifest.password -Encoding ascii
    & (Join-Path $pgBin 'initdb.exe') -D $dataRoot -U postgres --encoding=UTF8 --locale=C --auth-local=trust --auth-host=scram-sha-256 "--pwfile=$passwordPath"
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed.' }
    Add-Content -LiteralPath (Join-Path $dataRoot 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = 55432`ntimezone = 'UTC'`n"
  } finally { if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath } }
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $dataRoot status *> $null
if ($LASTEXITCODE -ne 0) {
  $existingListener = Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue
  if ($existingListener) { throw 'Port 55432 is already owned by another process.' }
  $pgControlArgs = @('-D', ('"' + $dataRoot + '"'), '-l', ('"' + (Join-Path $localRoot 'postgres.log') + '"'), '-w', 'start')
  $pgControlProcess = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList $pgControlArgs -WindowStyle Hidden -PassThru
  $pgControlProcess.WaitForExit()
  if ($pgControlProcess.ExitCode -ne 0) { throw 'pg_ctl failed; inspect .local/postgres.log.' }
}
$oldPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $manifest.password
  foreach ($databaseName in @('gittutor_dev', 'gittutor_test')) {
    $exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
    if ($LASTEXITCODE -ne 0) { throw 'Database connectivity check failed.' }
    if ($exists -ne '1') {
      & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U postgres $databaseName
      if ($LASTEXITCODE -ne 0) { throw 'Database creation failed.' }
    }
  }
} finally { $env:PGPASSWORD = $oldPassword }
Write-Output 'Isolated PostgreSQL ready on 127.0.0.1:55432 (gittutor_dev, gittutor_test). Credentials remain in ignored .local/database.json.'
