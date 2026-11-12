. (Join-Path $PSScriptRoot 'deployment-common.ps1')
Assert-IprcAdministrator
$manifest = Get-IprcManifest $PSScriptRoot
if ($manifest.ReplacesPublishedName) {
    if ($manifest.ReplacesPublishedName -notmatch '^oem\d+\.inf$') { throw 'Invalid replaced package name' }
    $previous = Join-Path $env:windir ('INF\'+$manifest.ReplacesPublishedName)
    if (Test-Path -LiteralPath $previous) {
        throw ('The failed previous package '+$manifest.ReplacesPublishedName+' is still present. Restore the original keyboard with the old package uninstaller before trying this candidate.')
    }
}
if (-not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Build -lt 22621) {
    throw 'This prototype requires Windows 11 x64 build 22621 or later.'
}
$boot = Get-IprcBootState
if ($boot.SecureBoot -ne 'Off' -or $boot.TestSigning -ne 'On') {
    throw ('Not ready: SecureBoot='+$boot.SecureBoot+', TestSigning='+$boot.TestSigning+'. Run check-state.ps1. This script will not change boot/security settings.')
}
if (Get-Process -Name IPRC1000 -ErrorAction SilentlyContinue) { throw 'Close the existing IPRC1000 desktop application before installing the prototype.' }
$certificateFile = Join-Path $PSScriptRoot 'iprc-local-test.cer'
$thumbprint = $manifest.CertificateThumbprint
$stateFile = Join-Path $PSScriptRoot 'install-state.json'
$state = [ordered]@{ CertificateThumbprint=$thumbprint; HardwareId=$manifest.HardwareId;
    RootAdded=$false; PublisherAdded=$false; PublishedName=$null }
if (Test-Path -LiteralPath $stateFile) {
    throw 'An installation state file already exists. Use uninstall-test-driver.ps1 before installing again.'
}
foreach ($entry in @(@{Store='Root';Flag='RootAdded'},@{Store='TrustedPublisher';Flag='PublisherAdded'})) {
    $target = 'Cert:\LocalMachine\'+$entry.Store
    if (-not (Test-Path -LiteralPath ($target+'\'+$thumbprint))) {
        Import-Certificate -FilePath $certificateFile -CertStoreLocation $target | Out-Null
        $state[$entry.Flag] = $true
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
}
foreach ($relative in @('package\iprcflt.sys','package\iprcflt.cat')) {
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $PSScriptRoot $relative)
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
        throw ('Windows signature verification failed: '+$relative+'; '+$signature.StatusMessage+'. No driver installation was attempted; uninstall-test-driver.ps1 can remove newly imported certificates.')
    }
}
$output = & pnputil.exe /add-driver (Join-Path $PSScriptRoot 'package\iprcflt.inf') /install 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Output $_ }
$names = @([regex]::Matches(($output | Out-String),'(?i)\boem\d+\.inf\b') | ForEach-Object {$_.Value.ToLowerInvariant()} | Select-Object -Unique)
if ($names.Count -eq 1) { $state.PublishedName = $names[0] }
$state['PnpUtilExitCode'] = $code
$state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
if ($code -notin @(0,3010)) { throw ('PnPUtil failed: '+$code+'. Keep its output and install-state.json for diagnosis.') }
Write-Output 'Package staged. Follow any Windows restart request. The driver initially observes; it does not enable mappings automatically.'
Write-Output 'After the device starts, run: .\iprcctl.exe status'
Write-Output 'If status confirms the driver is connected, test mappings with: .\iprcctl.exe enable'
Write-Output 'No boot settings were changed and no reboot was triggered.'
