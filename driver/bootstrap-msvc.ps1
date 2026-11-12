param([string]$ToolchainRoot = (Join-Path $PSScriptRoot '.toolchain'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $ToolchainRoot | Out-Null
$root = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$destination = Join-Path $root 'msvc'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$packages = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchains\msvc-packages.json') -Raw | ConvertFrom-Json
foreach ($package in $packages) {
    $archive = Join-Path $root $package.fileName
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $package.url -OutFile $archive -UseBasicParsing }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.sha256) { throw ('MSVC checksum mismatch: '+$package.fileName) }
    & tar -xf $archive -C $destination
    if ($LASTEXITCODE -ne 0) { throw ('MSVC extraction failed: '+$package.fileName) }
}
Write-Output 'Pinned Microsoft compiler/linker extracted locally; no Visual Studio installer was run.'
Write-Output 'Use of the tools is subject to the Microsoft license terms accompanying their official distribution.'
