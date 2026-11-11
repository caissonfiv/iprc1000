# 修复 Interception 安装器留下的半成品：补上缺失的服务 ImagePath
#
# 背景：install-interception.exe 是 32 位程序，在这台机器上拿到的系统目录是空字符串，
# 于是它把驱动路径写成了 "\system32\drivers\keyboard.sys"（没有盘符），注册表写入失败。
# 结果是：驱动 .sys 拷进去了、服务键建了、键盘类 UpperFilters 也加了，
# 唯独 ImagePath 没写。没有 ImagePath 的服务永远加载不了 —— 这就是 create_context 返回 NULL 的原因。
#
# 本脚本只做三件事：校验文件 → 补 ImagePath → 报告状态。不重装、不覆盖别的值。
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '[FAIL] 需要管理员权限。' -ForegroundColor Red
    exit 1
}

function Set-RegValue {
    param($Path, $Name, $Value, $Type)
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

$drivers = Join-Path $env:SystemRoot 'System32\drivers'
$ok = $true

Write-Host ''
Write-Host '① 校验驱动文件'
foreach ($d in @('keyboard', 'mouse')) {
    $p = Join-Path $drivers "$d.sys"
    if (-not (Test-Path $p)) {
        Write-Host ("   {0}.sys  缺失！" -f $d) -ForegroundColor Red
        $ok = $false
        continue
    }
    $sig = Get-AuthenticodeSignature $p
    $color = 'Yellow'
    if ($sig.Status -eq 'Valid') { $color = 'Green' }
    Write-Host ("   {0}.sys  {1} 字节  签名={2}  签名者={3}" -f $d, (Get-Item $p).Length, $sig.Status, $sig.SignerCertificate.Subject) -ForegroundColor $color
}
if (-not $ok) {
    Write-Host ''
    Write-Host '驱动文件不全，请重新运行 enable-clean-mode.cmd。' -ForegroundColor Red
    exit 2
}

Write-Host ''
Write-Host '② 补上服务的 ImagePath'
foreach ($d in @('keyboard', 'mouse')) {
    $svc = "HKLM:\SYSTEM\CurrentControlSet\Services\$d"
    if (-not (Test-Path $svc)) {
        New-Item -Path $svc -Force | Out-Null
        if ($d -eq 'keyboard') { $dn = 'Keyboard Upper Filter Driver' } else { $dn = 'Mouse Upper Filter Driver' }
        Set-RegValue $svc 'DisplayName'  $dn 'String'
        Set-RegValue $svc 'Type'         1   'DWord'
        Set-RegValue $svc 'ErrorControl' 1   'DWord'
        Set-RegValue $svc 'Start'        3   'DWord'
        Write-Host ("   {0}: 服务键已新建" -f $d)
    }
    $target = "\SystemRoot\System32\drivers\$d.sys"
    $before = (Get-ItemProperty $svc -Name ImagePath -ErrorAction SilentlyContinue).ImagePath
    Set-RegValue $svc 'ImagePath' $target 'String'
    if ([string]::IsNullOrEmpty($before)) {
        Write-Host ("   {0}: ImagePath  (空) -> {1}" -f $d, $target) -ForegroundColor Green
    } else {
        Write-Host ("   {0}: ImagePath  {1} -> {2}" -f $d, $before, $target) -ForegroundColor Green
    }
}

Write-Host ''
Write-Host '③ 校验键盘类的过滤驱动注册'
$cls = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4D36E96B-E325-11CE-BFC1-08002BE10318}'
$uf = (Get-ItemProperty $cls -Name UpperFilters -ErrorAction SilentlyContinue).UpperFilters
if ($uf) {
    Write-Host ("   UpperFilters = {0}" -f ($uf -join ', '))
    if ($uf -contains 'keyboard') {
        Write-Host '   已包含 keyboard' -ForegroundColor Green
    } else {
        $new = @('keyboard') + $uf
        Set-RegValue $cls 'UpperFilters' $new 'MultiString'
        Write-Host ("   已追加，新值 = {0}" -f ($new -join ', ')) -ForegroundColor Yellow
    }
} else {
    Set-RegValue $cls 'UpperFilters' @('keyboard', 'kbdclass') 'MultiString'
    Write-Host '   原本未设置，已写入 keyboard, kbdclass' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '④ 当前状态'
foreach ($d in @('keyboard', 'mouse')) {
    $svc = "HKLM:\SYSTEM\CurrentControlSet\Services\$d"
    $ip = (Get-ItemProperty $svc -Name ImagePath -ErrorAction SilentlyContinue).ImagePath
    $st = Get-Service -Name $d -ErrorAction SilentlyContinue
    $state = '未知'
    if ($st) { $state = $st.Status }
    Write-Host ("   {0,-9} ImagePath={1}  状态={2}" -f $d, $ip, $state)
}

Write-Host ''
Write-Host '------------------------------------------------------------'
Write-Host ' 修复完成。这是上层过滤驱动，要随键盘设备栈一起加载，'
Write-Host ' 所以需要【重启一次】才会真正挂上去。'
Write-Host ''
Write-Host ' 重启后双击 run.cmd，日志出现下面这行就说明生效了：'
Write-Host '   > 接管模式已启用（设备 #N）'
Write-Host '------------------------------------------------------------'
Write-Host ''
