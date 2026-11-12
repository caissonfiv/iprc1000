param([Parameter(Mandatory=$true)][string]$ZigPath)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $out 'zig-cache'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $out 'zig-local-cache'
& $ZigPath cc -std=c11 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'core\iprc_core.c') `
    (Join-Path $PSScriptRoot 'tests\core_test.c') -o (Join-Path $out 'core_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Core test compilation failed' }
& (Join-Path $out 'core_test.exe')
if ($LASTEXITCODE -ne 0) { throw 'Core tests failed' }
