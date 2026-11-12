'use strict';

// Measured PS/2 set-1 scan codes for IPRC1000, not HID usage IDs.
// The legacy HTTP/config field "usage" is retained for backwards compatibility.
const SCAN_CODES = Object.freeze({
  pwr: 0x14, back: 0x21, up: 0x48, menu: 0x31,
  left: 0x4b, ok: 0x1c, right: 0x4d, exit: 0x20,
  down: 0x50, info: 0x23, fav: 0x12, mic: 0x32, me: 0x24,
  rew: 0x33, play: 0x2b, ffwd: 0x2f, volup: 0x03, voldown: 0x04,
  chup: 0x1e, chdown: 0x30, mute: 0x22, last: 0x2e,
});

function defaultKeymap() {
  const map = Object.fromEntries(Object.values(SCAN_CODES).map(code => [code, { type: 'none' }]));
  for (const slot of ['up', 'down', 'left', 'right', 'ok']) map[SCAN_CODES[slot]] = { type: 'native' };
  for (const [slot, vk] of Object.entries({ volup: 0xaf, voldown: 0xae, mute: 0xad, play: 0xb3 })) {
    map[SCAN_CODES[slot]] = { type: 'keys', keys: [vk] };
  }
  // Voice is opt-in: opening Win+H before an audio bridge exists is misleading.
  return { version: 1, map };
}
module.exports = { SCAN_CODES, defaultKeymap };
