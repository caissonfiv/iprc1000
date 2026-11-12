. (Join-Path $PSScriptRoot 'deployment-common.ps1')
$manifest = Get-IprcManifest $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$boot = Get-IprcBootState
$bitLocker = 'Unknown'
try {
    $volume = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
    if ($volume) { $bitLocker = [string]$volume.ProtectionStatus }
} catch {}
[pscustomobject]@{
    Administrator=$administrator
    WindowsBuild=[Environment]::OSVersion.Version.Build
    Is64BitOS=[Environment]::Is64BitOperatingSystem
    PackageHashes='Match'
    HardwareId=$manifest.HardwareId
    TestSigning=$boot.TestSigning
    SecureBoot=$boot.SecureBoot
    BitLockerProtection=$bitLocker
    CertificateThumbprint=$manifest.CertificateThumbprint
    RootTrusted=(Test-Path -LiteralPath ('Cert:\LocalMachine\Root\'+$manifest.CertificateThumbprint))
    PublisherTrusted=(Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$manifest.CertificateThumbprint))
} | Format-List
Write-Output 'Read-only check. No certificates, boot settings or drivers were changed.'
if (-not $administrator) { Write-Output 'Rerun in an administrator PowerShell window for reliable boot/security state.' }
