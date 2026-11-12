param(
    [Parameter(Mandatory=$true)][string]$ToolchainRoot,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build\msvc')
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ToolchainRoot).Path
$vc = Join-Path $root 'msvc\Contents\VC\Tools\MSVC\14.44.35207'
$bin = Join-Path $vc 'bin\Hostx64\x64'
$cl = Join-Path $bin 'cl.exe'
$link = Join-Path $bin 'link.exe'
$wdk = Join-Path $root 'wdk\c'
$sdk = Join-Path $root 'sdk\c'
$version = '10.0.26100.0'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = (Resolve-Path -LiteralPath $OutputDirectory).Path
$flags = @('/nologo','/c','/std:c11','/kernel','/W4','/WX','/wd4324','/O2','/Zi','/GS','/Zl','/Zp8','/guard:cf',
    '/D_AMD64_','/DAMD64','/D_WIN64','/D_WIN32_WINNT=0x0A00','/DNTDDI_VERSION=0x0A00000C',
    '/DKMDF_VERSION_MAJOR=1','/DKMDF_VERSION_MINOR=33','/DKMDF_MINIMUM_VERSION_REQUIRED=33',
    ('/I'+(Join-Path $wdk "Include\$version\km")),
    ('/I'+(Join-Path $wdk "Include\$version\km\crt")),
    ('/I'+(Join-Path $vc 'include')),
    ('/I'+(Join-Path $wdk 'Include\wdf\kmdf\1.33')),
    ('/I'+(Join-Path $sdk "Include\$version\shared")),
    ('/I'+(Join-Path $sdk "Include\$version\ucrt")),
    ('/Fd'+(Join-Path $out 'compiler.pdb')))
$objects = @()
foreach ($file in @('core\iprc_core.c','kmdf\iprcflt.c','kmdf\control.c')) {
    $object = Join-Path $out (([IO.Path]::GetFileNameWithoutExtension($file))+'.obj')
    & $cl @flags ('/Fo'+$object) (Join-Path $PSScriptRoot $file)
    if ($LASTEXITCODE -ne 0) { throw ('MSVC compilation failed: '+$file) }
    $objects += $object
}
$kernelLib = Join-Path $wdk "Lib\$version\km\x64"
$wdfLib = Join-Path $wdk 'Lib\wdf\kmdf\x64\1.33'
$libraries = @((Join-Path $kernelLib 'ntoskrnl.lib'),(Join-Path $kernelLib 'hal.lib'),
    (Join-Path $kernelLib 'wdmsec.lib'),(Join-Path $kernelLib 'bufferoverflowfastfailk.lib'),
    (Join-Path $wdfLib 'wdfdriverentry.lib'),(Join-Path $wdfLib 'wdfldr.lib'))
& $link /nologo /DRIVER /KERNEL /SUBSYSTEM:NATIVE,10.00 /ENTRY:FxDriverEntry /NODEFAULTLIB `
    /INTEGRITYCHECK /NXCOMPAT /DYNAMICBASE /HIGHENTROPYVA /GUARD:CF /DEBUG /RELEASE /MANIFEST:NO `
    /OPT:REF /OPT:ICF /INCREMENTAL:NO /MERGE:_TEXT=.text /SECTION:INIT,D `
    ('/OUT:'+(Join-Path $out 'iprcflt.sys')) @objects @libraries
if ($LASTEXITCODE -ne 0) { throw 'Microsoft LINK driver link failed' }
Write-Output ('MSVC-built unsigned candidate: '+(Join-Path $out 'iprcflt.sys'))
Write-Output 'No driver was installed, restarted or loaded.'
