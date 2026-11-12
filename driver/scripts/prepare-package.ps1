param(
    [Parameter(Mandatory=$true)][string]$HardwareId,
    [string]$BinaryDirectory = (Join-Path $PSScriptRoot '..\build'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build\package')
)
$ErrorActionPreference = 'Stop'
if ($HardwareId.Length -gt 199 -or $HardwareId -notmatch '^HID\\[A-Za-z0-9{}&_\\-]+$' -or
    $HardwareId -notmatch '(?i)(?:^|[\\_&])VID(?:&00020A5C|_0A5C)(?=[\\_&]|$)' -or
    $HardwareId -notmatch '(?i)(?:^|[\\_&])PID(?:&8502|_8502)(?=[\\_&]|$)') {
    throw 'Expected an exact inventory-verified HID hardware ID with VID 0A5C and PID 8502; wildcards and INF metacharacters are forbidden.'
}
$source = Join-Path ((Resolve-Path -LiteralPath $BinaryDirectory).Path) 'iprcflt.sys'
if (-not (Test-Path -LiteralPath $source)) { throw 'Build iprcflt.sys first' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$destination = (Resolve-Path -LiteralPath $OutputDirectory).Path
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package\iprcflt.inf.in') -Raw
$inf = $template.Replace('__IPRC_HARDWARE_ID__', $HardwareId).Replace("`r`n","`n").Replace("`n","`r`n")
[IO.File]::WriteAllText((Join-Path $destination 'iprcflt.inf'), $inf, [Text.Encoding]::ASCII)
Copy-Item -LiteralPath $source -Destination (Join-Path $destination 'iprcflt.sys')
Write-Output ('Prepared unsigned device-specific package: ' + $destination)
Write-Output 'No driver was staged or installed. Validate the INF and sign the test package on the test system before deployment.'
