. (Join-Path $PSScriptRoot 'deployment-common.ps1')
Assert-IprcAdministrator
$manifest = Get-IprcManifest $PSScriptRoot
$stateFile = Join-Path $PSScriptRoot 'install-state.json'
if (-not (Test-Path -LiteralPath $stateFile)) { throw 'No install-state.json found; this script will not guess an OEM package to remove.' }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($state.CertificateThumbprint -ne $manifest.CertificateThumbprint -or $state.HardwareId -ne $manifest.HardwareId) { throw 'Installation state does not match this package.' }
if ($state.PublishedName) {
    if ($state.PublishedName -notmatch '^oem\d+\.inf$') { throw 'Invalid OEM package name' }
    $installed = Join-Path $env:windir ('INF\'+$state.PublishedName)
    if (Test-Path -LiteralPath $installed) {
        $text = Get-Content -LiteralPath $installed -Raw
        if (-not $text.Contains('{3806a9d0-c131-4af1-9ec2-7f58c7e50b3d}') -or -not $text.Contains($manifest.HardwareId)) {
            throw 'Installed INF does not match this exact IPRC1000 extension.'
        }
        & pnputil.exe /delete-driver $state.PublishedName /uninstall
        if ($LASTEXITCODE -notin @(0,3010)) { throw 'Driver removal failed; certificate trust has been left unchanged.' }
    }
} elseif ($state.PSObject.Properties.Name -contains 'PnpUtilExitCode') {
    throw 'PnPUtil did not expose one unambiguous OEM name. Identify this extension with pnputil /enum-drivers before removing anything.'
}
foreach ($entry in @(@{Store='Root';Added=$state.RootAdded},@{Store='TrustedPublisher';Added=$state.PublisherAdded})) {
    if ($entry.Added) {
        $item = 'Cert:\LocalMachine\'+$entry.Store+'\'+$manifest.CertificateThumbprint
        if (Test-Path -LiteralPath $item) { Remove-Item -LiteralPath $item }
    }
}
Move-Item -LiteralPath $stateFile -Destination ($stateFile+'.removed-'+(Get-Date -Format 'yyyyMMddHHmmss'))
Write-Output 'Removed this test package and only certificate entries created by its installer. Restart if Windows requests it.'
Write-Output 'Test-signing boot mode is unchanged; disable it separately after testing if no other test driver needs it.'
