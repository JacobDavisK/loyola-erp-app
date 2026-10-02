@echo off
title University of the World ERP - Installer
set "SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:SELF); Invoke-Expression $s.Substring($s.LastIndexOf('#'+'PS-BEGIN'))"
echo.
pause
exit /b
#PS-BEGIN
# Everything below is PowerShell. It installs into the current user's profile (no administrator
# rights needed): a private copy of Node.js, then the application from the public download repository.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Join-Path $env:LOCALAPPDATA 'UniversityOfTheWorldERP'
$Node = Join-Path $Root 'tools\node'
$App = Join-Path $Root 'app'
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$NodeUrl = 'https://nodejs.org/dist/v24.15.0/node-v24.15.0-win-x64.zip'
$NodeSha = 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62'
$AppUrl = 'https://github.com/JacobDavisK/loyola-erp-app/archive/refs/heads/main.zip'

function Step($m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Fetch($url, $file) {
  try { Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing }
  catch { throw "Could not download $url. Check the internet connection and run the installer again." }
}
function Unpack($zip, $dest) {
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force $dest | Out-Null
  & $Tar -xf $zip --strip-components=1 -C $dest
  if ($LASTEXITCODE -ne 0) { throw "Could not unpack $zip." }
  Remove-Item -Force $zip
}

try {
  Write-Host 'University of the World ERP (Jacob Davis K)' -ForegroundColor Green
  Write-Host 'First-time installation: 10 to 30 minutes, about 600 MB of downloads. Keep this window open.'
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit edition of Windows 10 or 11 is required.' }
  if (-not (Test-Path $Tar)) { throw 'Windows 10 (version 1803 or newer) or Windows 11 is required.' }
  New-Item -ItemType Directory -Force $Root | Out-Null

  if (-not (Test-Path (Join-Path $Node 'node.exe'))) {
    Step 'Downloading Node.js (private copy for this application)'
    $zip = Join-Path $Root 'node.zip'
    Fetch $NodeUrl $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $NodeSha) { Remove-Item -Force $zip; throw 'The Node.js download is damaged. Run the installer again.' }
    Unpack $zip $Node
  }
  $env:PATH = "$Node;$env:PATH"

  if (-not (Test-Path (Join-Path $App 'package.json'))) {
    Step 'Downloading the application'
    $zip = Join-Path $Root 'app.zip'
    Fetch $AppUrl $zip
    Unpack $zip $App
  }

  Set-Location $App
  & (Join-Path $Node 'node.exe') 'scripts\portable\setup.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Setup did not finish. Run the installer again to continue from where it stopped.' }

  Step 'Creating the desktop shortcut'
  $start = Join-Path $Root 'Start.cmd'
  Set-Content -Path $start -Encoding ASCII -Value @(
    '@echo off',
    'title University of the World ERP',
    'set "PATH=%~dp0tools\node;%PATH%"',
    'cd /d "%~dp0app"',
    'node scripts\portable\start.mjs',
    'if errorlevel 1 pause'
  )
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'University of the World ERP.lnk'))
  $link.TargetPath = $start
  $link.WorkingDirectory = $Root
  $link.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
  $link.Save()

  Write-Host ''
  Write-Host 'Installed. Starting the application; the browser opens by itself.' -ForegroundColor Green
  Write-Host 'Next time, use the "University of the World ERP" shortcut on the desktop.'
  Write-Host 'Sign in as the Super Admin with the name and password you chose during setup.'
  Start-Process -FilePath $start -WorkingDirectory $Root
} catch {
  Write-Host ''
  Write-Host "Installation failed: $($_.Exception.Message)" -ForegroundColor Red
}
