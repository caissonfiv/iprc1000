'use strict';

// All delayed injection has one owner. Invalidate callbacks before releasing keys.
class InputQueue {
  constructor({ down, up, setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) {
    Object.assign(this, { down, up, setTimer, clearTimer, onError });
    this.tasks = [];
    this.timer = null;
    this.generation = 0;
    this.pressed = new Set();
    this.lastError = '';
    this.holding = false;
  }
  enqueue(steps) {
    if (!steps.length) return;
    this.tasks.push({ steps, index: 0, at: 0 });
    if (this.tasks.length === 1 && this.timer === null) this.schedule();
  }
  schedule() {
    if (this.holding) return;
    const task = this.tasks[0];
    if (!task) return;
    if (task.index === task.steps.length) { this.tasks.shift(); return this.schedule(); }
    const step = task.steps[task.index];
    const generation = this.generation;
    this.timer = this.setTimer(() => {
      if (generation !== this.generation) return;
      this.timer = null;
      try {
        if (step.run) step.run();
        else if (step.down) this.press(step.vk);
        else this.lift(step.vk);
      } catch (error) {
        this.lastError = error.message || String(error);
        this.cancel();
        this.onError(error);
        return;
      }
      task.at = step.at;
      task.index++;
      this.schedule();
    }, Math.max(0, step.at - task.at));
  }
  press(vk) {
    this.pressed.add(vk);
    this.down(vk);
  }
  lift(vk) {
    this.up(vk);
    this.pressed.delete(vk);
  }
  hold(keys) {
    this.cancel();
    this.holding = true;
    try { for (const vk of keys) this.press(vk); }
    catch (error) { this.cancel(); throw error; }
  }
  releaseHold(keys) {
    try { for (const vk of keys.slice().reverse()) if (this.pressed.has(vk)) this.lift(vk); }
    finally {
      if (!this.pressed.size) { this.holding = false; if (this.timer === null) this.schedule(); }
    }
  }
  cancel() {
    this.generation++;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.tasks = [];
    this.holding = false;
    for (const vk of [...this.pressed].reverse()) {
      try { this.lift(vk); } catch (error) { this.lastError = error.message || String(error); }
    }
  }
  info() { return { pending: this.tasks.length, pressed: [...this.pressed], lastError: this.lastError }; }
}
module.exports = { InputQueue };
