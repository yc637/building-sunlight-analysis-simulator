import test from 'node:test';
import assert from 'node:assert';
import { floorHeights, buildingTotalHeight, wallSegments } from './geometry.js';

test('无覆盖时各层等于默认层高', () => {
  const b = { floorHeight: 3, floorCount: 5, overrides: {} };
  assert.deepStrictEqual(floorHeights(b), [3, 3, 3, 3, 3]);
});

test('overrides 覆盖指定层', () => {
  const b = { floorHeight: 3, floorCount: 3, overrides: { 0: 4.5 } };
  assert.deepStrictEqual(floorHeights(b), [4.5, 3, 3]);
});

test('总高为各层之和', () => {
  const b = { floorHeight: 3, floorCount: 3, overrides: { 0: 4.5 } };
  assert.strictEqual(buildingTotalHeight(b), 10.5);
});

test('折线 N 点得到 N-1 段', () => {
  const w = { path: [[0, 0], [10, 0], [10, 10]] };
  const segs = wallSegments(w);
  assert.strictEqual(segs.length, 2);
  assert.deepStrictEqual(segs[0], { ax: 0, az: 0, bx: 10, bz: 0 });
});
