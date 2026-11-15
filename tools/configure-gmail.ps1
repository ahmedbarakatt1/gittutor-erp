# Run interactively in Windows PowerShell. No network calls or email sends.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$tutorWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tutorPrivateDirectory = Join-Path $tutorWorkspace '.local/production-setup'
$tutorSecretPath = Join-Path $tutorPrivateDirectory 'gmail-app-password.dpapi'
if (-not (Test-Path -LiteralPath (Join-Path $tutorWorkspace 'AGENTS.md'))) { throw 'Run this from the Git Tutor repository.' }
$tutorSecurePassword = Read-Host 'Paste the Google App Password for gittutor2@gmail.com (input is hidden)' -AsSecureString
$tutorPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tutorSecurePassword)
try {
    $tutorPlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tutorPointer).Replace(' ', '')
    if ($tutorPlainPassword -cnotmatch '^[a-z]{16}$') { throw 'Expected a 16-letter Google App Password. Nothing was saved.' }
    $tutorNormalizedSecret = ConvertTo-SecureString $tutorPlainPassword -AsPlainText -Force
    New-Item -ItemType Directory -Path $tutorPrivateDirectory -Force | Out-Null
    $tutorProtected = ConvertFrom-SecureString $tutorNormalizedSecret
    [IO.File]::WriteAllText($tutorSecretPath, $tutorProtected, (New-Object Text.UTF8Encoding($false)))
    Write-Output 'Saved using Windows account encryption. No email was sent or provider activated.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tutorPointer)
    $tutorPlainPassword = $null
    if ($tutorNormalizedSecret) { $tutorNormalizedSecret.Dispose() }
    $tutorSecurePassword.Dispose()
}
