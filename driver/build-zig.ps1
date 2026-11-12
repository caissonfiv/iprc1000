param(
    [Parameter(Mandatory=$true)][string]$ToolchainRoot,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build')
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$zig = Join-Path $root 'zig-x86_64-windows-0.15.2\zig.exe'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = (Resolve-Path -LiteralPath $OutputDirectory).Path
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $root 'zig-cache'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $root 'zig-local-cache'
$core = Join-Path $PSScriptRoot 'core\iprc_core.c'
& $zig cc -std=c11 -Wall -Wextra -Werror $core (Join-Path $PSScriptRoot 'tests\core_test.c') -o (Join-Path $out 'core_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Shared C test compilation failed' }
& (Join-Path $out 'core_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Shared C tests failed' }
# Keep the old command as an entry point; kernel compilation now uses MSVC.
& (Join-Path $PSScriptRoot 'build-msvc.ps1') -ToolchainRoot $root -OutputDirectory $out
& $zig cc -std=c11 -Wall -Wextra -Werror -O2 $core (Join-Path $PSScriptRoot 'tools\iprcctl.c') -lsetupapi -o (Join-Path $out 'iprcctl.exe')
if ($LASTEXITCODE -ne 0) { throw 'Control tool build failed' }
$uiBin = Join-Path $PSScriptRoot '..\driver-bin'
New-Item -ItemType Directory -Force -Path $uiBin | Out-Null
Copy-Item -LiteralPath (Join-Path $out 'iprcctl.exe') -Destination (Join-Path $uiBin 'iprcctl.exe')
Write-Output 'Kernel: Microsoft CL/LINK. Zig: host-only tests and control tool. No driver was installed or loaded.'
