$ErrorActionPreference = 'Stop'
function Assert-IprcAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Open PowerShell with Run as administrator, then run this script again.'
    }
}
function Get-IprcBootState {
    $boot = & bcdedit.exe /enum 2>&1 | Out-String
    $bootCode = $LASTEXITCODE
    $testMode = 'Unknown'
    if ($bootCode -eq 0) {
        $testMode = if ($boot -match '(?im)^\s*testsigning\s+(Yes|是)\s*$') { 'On' } else { 'Off' }
    }
    $secureBoot = 'Unknown'
    try { $secureBoot = if (Confirm-SecureBootUEFI) { 'On' } else { 'Off' } } catch {}
    [pscustomobject]@{ TestSigning=$testMode; SecureBoot=$secureBoot; BootReadExit=$bootCode }
}
function Get-IprcManifest([string]$Root) {
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($file in $manifest.Files.PSObject.Properties) {
        # Accept only package-relative paths; never follow a manifest outside it.
        $resolved = [IO.Path]::GetFullPath((Join-Path $Root $file.Name))
        $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path' }
        if ((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash -ne $file.Value) {
            throw ('Package file changed: '+$file.Name)
        }
    }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $Root 'iprc-local-test.cer'))
    try {
        if ($certificate.Thumbprint -ne $manifest.CertificateThumbprint) { throw 'Certificate identity mismatch' }
        if ($certificate.NotAfter -lt (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'Test certificate is not currently valid' }
    } finally { $certificate.Dispose() }
    return $manifest
}
