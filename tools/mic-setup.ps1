# Enable BthPort ETW capture of large HCI packets (needed for remote mic audio)
# Must run as Administrator.
$ErrorActionPreference = 'Stop'
$p = 'HKLM:\SYSTEM\CurrentControlSet\Services\BthPort\Parameters'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '[FAIL] Not running as Administrator.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'BEFORE:'
foreach ($n in 'MaxEtwBytes','EtwDropLargeEvents','EtwLogSensitiveData') {
    $v = (Get-ItemProperty -Path $p -Name $n -ErrorAction SilentlyContinue).$n
    if ($null -eq $v) { Write-Host ("  {0,-22} = (not set)" -f $n) }
    else { Write-Host ("  {0,-22} = {1}" -f $n, $v) }
}

# MaxEtwBytes: max HCI packet size kept in the trace. One audio frame is ~657 bytes,
# so 1024 is enough (Microsoft's own debug profile uses 0x400).
Set-ItemProperty -Path $p -Name 'MaxEtwBytes'      -Value 1024 -Type DWord
# EtwDropLargeEvents defaults to 1 = large HCI packets are thrown away.
# This is why the mic audio never shows up in a trace.
Set-ItemProperty -Path $p -Name 'EtwDropLargeEvents' -Value 0   -Type DWord
Set-ItemProperty -Path $p -Name 'EtwLogSensitiveData' -Value 1  -Type DWord

Write-Host ''
Write-Host 'AFTER:'
foreach ($n in 'MaxEtwBytes','EtwDropLargeEvents','EtwLogSensitiveData') {
    $v = (Get-ItemProperty -Path $p -Name $n -ErrorAction SilentlyContinue).$n
    Write-Host ("  {0,-22} = {1}" -f $n, $v) -ForegroundColor Green
}

Write-Host ''
Write-Host '------------------------------------------------------------'
Write-Host ' These keys are read by the BthPort driver when it LOADS.'
Write-Host ' You must REBOOT for them to take effect.'
Write-Host '------------------------------------------------------------'
Write-Host ''
Write-Host ' After rebooting, run:  mic-test.cmd'
Write-Host ''
