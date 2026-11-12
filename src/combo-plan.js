'use strict';
// Historical timing is retained as a compatibility choice, not an API rule.
function comboPlan(vks, gap = 10) {
  const list = [...new Set((vks || []).filter(v => Number.isInteger(v) && v > 0 && v <= 255))];
  const plan = [];
  let delay = 0;
  for (const vk of list) { plan.push({ vk, down: true, at: delay }); delay += gap; }
  for (const vk of list.slice().reverse()) { plan.push({ vk, down: false, at: delay }); delay += gap; }
  for (const vk of list) plan.push({ vk, down: false, at: delay + 40, safety: true });
  return plan;
}
module.exports = { comboPlan };
