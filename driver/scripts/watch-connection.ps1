param([ValidateRange(1,600)][int]$Seconds=90)
. (Join-Path $PSScriptRoot 'deployment-common.ps1')
$manifest = Get-IprcManifest $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$ctl = Join-Path $PSScriptRoot 'iprcctl.exe'
$started = Get-Date
$timer = [Diagnostics.Stopwatch]::StartNew()
$firstSeen = $null
$seen = $false
$lastState = ''
function Invoke-IprcControl {
    param([ValidateSet('inventory','status')][string]$Command)
    # Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords.
    # Read the process streams directly so an expected exit code cannot abort monitoring.
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = $ctl
    $process.StartInfo.Arguments = $Command
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(5000)) {
            $process.Kill()
            throw 'iprcctl did not finish within 5 seconds.'
        }
        [pscustomobject]@{
            ExitCode = $process.ExitCode
            Text = ($stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult()).Trim()
        }
    } finally {
        $process.Dispose()
    }
}
Write-Output ('Administrator: '+$administrator)
Write-Output ('Watching for '+$Seconds+' seconds. NOW press a direction button every second for about 10 seconds.')
Write-Output 'Read-only monitoring: no enable/map commands, pairing changes, device restarts or driver installations.'
function Show-IprcSnapshot {
    Write-Output 'Device snapshot:'
    & pnputil.exe /enum-devices /deviceid $manifest.HardwareId /services /stack
    Write-Output 'Driver service:'
    & sc.exe query iprcflt
}
while ($timer.Elapsed.TotalSeconds -lt $Seconds) {
    $inventory = Invoke-IprcControl inventory
    $present = $inventory.ExitCode -eq 0
    if ($present) {
        $seen = $true
        if ($null -eq $firstSeen) { $firstSeen = $timer.Elapsed.TotalSeconds }
        $result = Invoke-IprcControl status
        $code = $result.ExitCode
        $text = $result.Text
        $state = 'present; '+$text
        if ($state -ne $lastState) {
            Write-Output ((Get-Date -Format 'HH:mm:ss')+' '+$state)
            $lastState = $state
            if ($code -ne 0) { Show-IprcSnapshot }
        }
        if ($code -eq 0 -and $text -match '\bconnected=1\b') {
            Write-Output 'PASS: remote present and driver keyboard connection ready. Mappings have NOT been enabled.'
            Show-IprcSnapshot
            return
        }
        if (-not $administrator) {
            Write-Output 'Remote detected; rerun this monitor as administrator to test the control interface.'
            return
        }
        if ($timer.Elapsed.TotalSeconds - $firstSeen -ge 6) {
            Write-Output 'Remote remained present, but the driver connection did not become ready within 6 seconds.'
            Show-IprcSnapshot
            Get-WinEvent -FilterHashtable @{LogName='System';StartTime=$started.AddSeconds(-2)} -MaxEvents 100 -ErrorAction SilentlyContinue |
                Where-Object { $_.Message -match 'iprcflt' } |
                Select-Object TimeCreated,Id,Message | Format-List
            return
        }
    } else {
        if ($lastState -ne 'absent') {
            Write-Output ((Get-Date -Format 'HH:mm:ss')+' Remote is not present. Keep pressing a direction button to wake it.')
            $lastState = 'absent'
        }
        $firstSeen = $null
    }
    Start-Sleep -Milliseconds 500
}
if (-not $seen) {
    Write-Output 'TIMEOUT: no present IPRC1000 keyboard was observed. Driver loading could not be tested. Check the Bluetooth connection before reinstalling anything.'
} else {
    Write-Output 'TIMEOUT: the remote appeared but no ready driver connection was captured.'
    Show-IprcSnapshot
}
