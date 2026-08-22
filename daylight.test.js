import test from 'node:test';
import assert from 'node:assert';
import { polygonCentroid } from './daylight.js';

test('矩形质心为中心', () => {
  const c = polygonCentroid([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.z) < 1e-9);
});

test('非对称多边形质心为顶点均值', () => {
  const c = polygonCentroid([[0, 0], [4, 0], [4, 2], [0, 2]]);
  assert.ok(Math.abs(c.x - 2) < 1e-9 && Math.abs(c.z - 1) < 1e-9);
});
