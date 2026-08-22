import test from 'node:test';
import assert from 'node:assert';
import { dateToDayOfYear } from './controls.js';

test('1月1日为第1天', () => {
  assert.strictEqual(dateToDayOfYear(2026, 1, 1), 1);
});

test('12月21日(冬至附近)约第355天', () => {
  const n = dateToDayOfYear(2026, 12, 21);
  assert.ok(Math.abs(n - 355) <= 1, `got ${n}`);
});
