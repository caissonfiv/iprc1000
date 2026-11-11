const HID = require('node-hid');

const targets = HID.devices().filter(d =>
  d.vendorId === 0x0a5c || d.vendorId === 0x0A5C ||
  /IPRC|FiOS|Verizon/i.test(d.product || '')
);

console.log('=== 所有 HID 设备 ===');
for (const d of HID.devices()) {
  console.log([
    `VID_${(d.vendorId ?? 0).toString(16).padStart(4, '0')}`,
    `PID_${(d.productId ?? 0).toString(16).padStart(4, '0')}`,
    `up=${d.usagePage}`,
    `u=${d.usage}`,
    d.interface,
    JSON.stringify(d.product || d.manufacturer || ''),
    d.path
  ].join(' | '));
}

console.log('\n=== IPRC1000 命中 ===');
if (!targets.length) {
  console.log('未找到。设备当前可能未连接（遥控器休眠/未唤醒）。');
} else {
  for (const d of targets) console.log(JSON.stringify(d, null, 2));
}
