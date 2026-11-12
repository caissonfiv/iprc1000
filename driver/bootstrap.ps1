param([string]$ToolchainRoot = (Join-Path $PSScriptRoot '.toolchain'))
$ErrorActionPreference = 'Stop'
# Portable downloads only. No installer, certificate, registry or boot changes.
New-Item -ItemType Directory -Force -Path $ToolchainRoot | Out-Null
$root = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$packages = @(
    @{
        File='zig.zip'; Destination='';
        Url='https://ziglang.org/download/0.15.2/zig-x86_64-windows-0.15.2.zip';
        Sha256='3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c'
    },
    @{
        File='wdk.nupkg'; Destination='wdk';
        Url='https://api.nuget.org/v3-flatcontainer/microsoft.windows.wdk.x64/10.0.26100.6584/microsoft.windows.wdk.x64.10.0.26100.6584.nupkg';
        Sha256='c393d03dfb640b5c92f546b32f6770ef68cd3aaf691956e7d66d8e2c28a1b55e'
    },
    @{
        File='sdk.nupkg'; Destination='sdk';
        Url='https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.cpp/10.0.26100.6584/microsoft.windows.sdk.cpp.10.0.26100.6584.nupkg';
        Sha256='5d31b38205bdd9ac761b4cb39fbbc6b7209b01c11194324afc674d7d119483a0'
    }
)
foreach ($package in $packages) {
    $archive = Join-Path $root $package.File
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri $package.Url -OutFile $archive -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.Sha256) {
        throw ('Checksum mismatch: ' + $package.File)
    }
    $destination = if ($package.Destination) { Join-Path $root $package.Destination } else { $root }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    & tar -xf $archive -C $destination
    if ($LASTEXITCODE -ne 0) { throw ('Extraction failed: ' + $package.File) }
}
Write-Output ('Portable toolchain ready: ' + $root)
Write-Output 'Microsoft SDK/WDK license terms are in the downloaded packages; no SDK/WDK tools are redistributed in this repository.'
