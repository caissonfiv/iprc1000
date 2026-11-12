'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InputQueue } = require('../src/input-queue');
const { comboPlan } = require('../src/combo-plan');

function fixture(overrides = {}) {
  let id = 0;
  const timers = new Map(), events = [];
  const queue = new InputQueue({
    down: vk => events.push(['down', vk]), up: vk => events.push(['up', vk]),
    setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key),
    ...overrides,
  });
  const next = () => {
    const first = timers.entries().next().value;
    if (!first) return false;
    timers.delete(first[0]); first[1](); return true;
  };
  const drain = () => { let n = 0; while (next()) assert(++n < 1000); };
  return { queue, events, timers, next, drain };
}

test('combos execute serially, including their cleanup', () => {
  const f = fixture();
  f.queue.enqueue(comboPlan([91, 72])); f.queue.enqueue(comboPlan([17, 86])); f.drain();
  assert.deepEqual(f.events, [...comboPlan([91,72]), ...comboPlan([17,86])].map(s => [s.down?'down':'up',s.vk]));
  assert.deepEqual(f.queue.info().pressed, []);
});
test('panic cancels every old task and releases owned keys', () => {
  const f = fixture();
  f.queue.enqueue(comboPlan([91,72])); f.queue.enqueue(comboPlan([17,86])); f.next();
  const lateCallback = [...f.timers.values()][0];
  f.queue.cancel(); lateCallback(); f.drain();
  assert.deepEqual(f.events, [['down',91],['up',91]]);
  assert.equal(f.queue.info().pending, 0);
});
test('queue can restart after panic; stale callbacks cannot cancel the new timer', () => {
  const f = fixture();
  f.queue.enqueue(comboPlan([91,72]));
  const late = [...f.timers.values()][0]; f.queue.cancel();
  f.queue.enqueue(comboPlan([65])); late(); f.drain();
  assert.deepEqual(f.events, [['down',65],['up',65],['up',65]]);
});
test('clipboard mutation and Ctrl+V stay in the same task; panic cancels both', () => {
  const f = fixture();
  for (const text of ['first','second']) f.queue.enqueue([
    {at:0,run:()=>f.events.push(['clipboard',text])}, ...comboPlan([17,86]),
  ]);
  f.drain();
  assert.equal(f.events[0][1], 'first'); assert.equal(f.events[7][1], 'second');
  f.queue.enqueue([{at:20,run:()=>assert.fail('cancelled paste ran')}]); f.queue.cancel(); f.drain();
});
test('failed injection aborts following commands and attempts key release', () => {
  let failure;
  const f = fixture({down:()=>{throw new Error('UIPI');},onError:e=>failure=e});
  f.queue.enqueue(comboPlan([91,72])); f.drain();
  assert.equal(failure.message,'UIPI'); assert.deepEqual(f.events,[['up',91]]);
  assert.equal(f.queue.info().pending,0);
});
test('voice holds pause combos until release and panic cancels waiting combos', () => {
  const f = fixture(); f.queue.hold([17,91]); f.queue.enqueue(comboPlan([65]));
  assert.equal(f.timers.size,0);
  f.queue.releaseHold([17,91]); f.drain();
  assert.deepEqual(f.events.slice(0,4),[['down',17],['down',91],['up',91],['up',17]]);
  f.queue.hold([17]); f.queue.enqueue(comboPlan([66])); f.queue.cancel(); f.drain();
  assert.equal(f.events.some(e=>e[0]==='down'&&e[1]===66),false);
});
