$ErrorActionPreference = 'Stop'
$driver = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$prepare = Join-Path $driver 'scripts\prepare-package.ps1'
$output = Join-Path $driver ('build\package-tests-' + [Guid]::NewGuid().ToString('N'))
$invalid = @(
    'USB\VID_0A5C&PID_8502',
    'HID\VID_0A5C&PID_85020',
    'HID\VID_0A5C0&PID_8502',
    'HID\VID_1234&PID_8502',
    'HID\VID_0A5C&PID_8502*',
    'HID\VID_0A5C&PID_8502,ROOT\Keyboard',
    'HID\VID_0A5C&PID_8502%Injected%',
    "HID\VID_0A5C&PID_8502`n[Injected]"
)
foreach ($id in $invalid) {
    $rejected = $false
    try { & $prepare -HardwareId $id -OutputDirectory $output | Out-Null }
    catch { $rejected = $true }
    if (-not $rejected) { throw ('Invalid hardware ID accepted: ' + $id) }
}
if (Test-Path -LiteralPath $output) { throw 'Rejected inputs must not create a package' }
& $prepare -HardwareId 'HID\VID_0A5C&PID_8502&Col01' -OutputDirectory $output | Out-Null
$inf = [IO.File]::ReadAllText((Join-Path $output 'iprcflt.inf'))
if ($inf.Contains('__IPRC_HARDWARE_ID__') -or -not $inf.Contains('HID\VID_0A5C&PID_8502&Col01')) { throw 'Template substitution failed' }
if ($inf -match 'HKR,.*UpperFilters') { throw 'Global or legacy UpperFilters must not be generated' }
Write-Output 'PASS 8 rejected hardware IDs and exact-ID INF generation; no driver installation'
