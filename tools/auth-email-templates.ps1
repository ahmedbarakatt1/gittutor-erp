[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('pilot', 'production')][string]$Target,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$targets = @{
  pilot = @{ ref = 'tjrbvejvnquhmqdwsacy'; name = 'gittutor-erp-staging'; site = 'https://gittutor-erp-rho.vercel.app' }
  production = @{ ref = 'yuchmvnijdmyfhohlnmx'; name = 'gittutor-erp-production'; site = 'https://gittutor-erp-production.vercel.app' }
}
$project = $targets[$Target]
$projectPath = "/v1/projects/$($project.ref)"
$authPath = "$projectPath/config/auth"
$repo = Split-Path $PSScriptRoot -Parent
$config = [IO.File]::ReadAllText((Join-Path $repo 'supabase/config.toml'))
$expected = [ordered]@{}
foreach ($name in 'invite', 'confirmation', 'recovery') {
  $section = [regex]::Match($config, "(?ms)^\[auth\.email\.template\.$name\]\s*(?<body>.*?)(?=^\[|\z)").Groups['body'].Value
  $subject = [regex]::Match($section, '(?m)^subject = "([^"]+)"').Groups[1].Value
  $contentPath = [regex]::Match($section, '(?m)^content_path = "([^"]+)"').Groups[1].Value
  if (!$subject -or $contentPath -cne "./supabase/templates/$name.html") { throw "Unexpected $name configuration." }
  $expected["mailer_subjects_$name"] = $subject
  $expected["mailer_templates_${name}_content"] = [IO.File]::ReadAllText((Join-Path $repo $contentPath)).Replace("`r`n", "`n")
}

function Invoke-AuthManagement([string]$Path, [string]$Method = 'GET', $Body = $null) {
  if (!$env:SUPABASE_ACCESS_TOKEN) { throw 'Provide the Supabase Management API access token.' }
  $arguments = @{
    Uri = 'https://api.supabase.com' + $Path
    Headers = @{ Authorization = 'Bearer ' + $env:SUPABASE_ACCESS_TOKEN }
    Method = $Method
    MaximumRedirection = 0
    TimeoutSec = 60
  }
  if ($null -ne $Body) {
    $arguments.ContentType = 'application/json; charset=utf-8'
    $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
  }
  Invoke-RestMethod @arguments
}

function Get-Differences($saved) {
  foreach ($key in $expected.Keys) {
    if ([string]$saved.$key -cne $expected[$key]) { $key }
  }
}

$stage = 'project readback'
try {
  $metadata = Invoke-AuthManagement $projectPath
  if ($metadata.id -cne $project.ref -or $metadata.name -cne $project.name -or $metadata.status -cne 'ACTIVE_HEALTHY') {
    throw 'Unexpected project.'
  }
  $stage = 'Auth readback'
  $before = Invoke-AuthManagement $authPath
  if ($before.site_url -cne $project.site) { throw 'Unexpected Auth origin.' }
  $differences = @(Get-Differences $before)
  $changed = $false
  if ($Apply -and $differences.Count) {
    $stage = 'template update'
    $null = Invoke-AuthManagement $authPath 'PATCH' $expected
    $stage = 'post-update verification'
    $after = Invoke-AuthManagement $authPath
    $differences = @(Get-Differences $after)
    if ($differences.Count) { throw 'Template mismatch after update.' }
    $changed = $true
  }
  [pscustomobject]@{ target = $Target; matched = ($differences.Count -eq 0); differing_fields = $differences; changed = $changed } | ConvertTo-Json
} catch {
  # Provider error bodies may echo sensitive configuration.
  throw "Auth template operation failed at $stage for $Target. HTTP status $([int]$_.Exception.Response.StatusCode)."
}
