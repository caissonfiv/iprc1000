const koffi = require('koffi');
const HID = require('node-hid');

const k32 = koffi.load('kernel32.dll');
const hid = koffi.load('hid.dll');

const CreateFileW = k32.func('void* __stdcall CreateFileW(str16 lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void* lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void* hTemplateFile)');
const DeviceIoControl = k32.func('bool __stdcall DeviceIoControl(void* hDevice, uint32 dwIoControlCode, void* lpInBuffer, uint32 nInBufferSize, void* lpOutBuffer, uint32 nOutBufferSize, _Out_ uint32* lpBytesReturned, void* lpOverlapped)');
const CloseHandle = k32.func('bool __stdcall CloseHandle(void* hObject)');
const GetLastError = k32.func('uint32 __stdcall GetLastError()');

const HidD_GetPreparsedData = hid.func('bool __stdcall HidD_GetPreparsedData(void* HidDeviceObject, _Out_ void** PreparsedData)');
const HidD_FreePreparsedData = hid.func('bool __stdcall HidD_FreePreparsedData(void* PreparsedData)');
const HidP_GetCaps = hid.func('int __stdcall HidP_GetCaps(void* PreparsedData, _Out_ uint8* Capabilities)');

const dev = HID.devices().find(d => d.vendorId === 0x0a5c && d.productId === 0x8502);
if (!dev) { console.log('设备未找到'); process.exit(1); }
console.log('PATH:', dev.path);

const GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
const OPEN_EXISTING = 3;

let h = CreateFileW(dev.path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, 0, null);
if (koffi.address(h) === 0n || h === 0) {
  console.log('CreateFileW 失败, err=', GetLastError(), '改用只读');
  h = CreateFileW(dev.path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, 0, null);
}
console.log('HANDLE:', h, 'err=', GetLastError());
if (koffi.address(h) === 0n || h === 0) process.exit(1);

// --- HIDP_CAPS ---
const pre = [null];
if (!HidD_GetPreparsedData(h, pre)) {
  console.log('HidD_GetPreparsedData 失败 err=', GetLastError());
} else {
  const caps = Buffer.alloc(128);
  const st = HidP_GetCaps(pre[0], caps);
  const u16 = i => caps.readUInt16LE(i * 2);
  console.log('HidP_GetCaps status=', st);
  console.log(`  UsagePage=0x${u16(1).toString(16)} Usage=0x${u16(0).toString(16)}`);
  console.log(`  InputReportByteLength=${u16(2)}  Output=${u16(3)}  Feature=${u16(4)}`);
  console.log(`  LinkCollectionNodes=${u16(22)} InputButtonCaps=${u16(23)} InputValueCaps=${u16(24)} InputDataIndices=${u16(25)}`);
  HidD_FreePreparsedData(pre[0]);
}

// --- 读原始报表述符 ---
function tryIoctl(code, label) {
  const out = Buffer.alloc(4096);
  const got = [0];
  const ok = DeviceIoControl(h, code, null, 0, out, out.length, got, null);
  console.log(`${label} code=0x${code.toString(16).toUpperCase()} ok=${ok} got=${got[0]} err=${ok ? 0 : GetLastError()}`);
  if (ok && got[0] > 0) return out.subarray(0, got[0]);
  return null;
}

let desc = tryIoctl(0x000b0190, 'IOCTL_HID_GET_REPORT_DESCRIPTOR(A)');
if (!desc) desc = tryIoctl(0x000b0007, 'IOCTL_HID_GET_REPORT_DESCRIPTOR(B)');

if (desc) {
  console.log('\n=== 报表述符 (hex) ===');
  console.log([...desc].map(b => b.toString(16).padStart(2, '0')).join(' '));
  require('fs').writeFileSync(__dirname + '/../out/descriptor.bin', desc);
}

CloseHandle(h);
