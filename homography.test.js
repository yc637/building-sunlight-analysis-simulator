import test from 'node:test';
import assert from 'node:assert';
import { solveHomography, invertHomography, transformPoint } from './homography.js';

const close = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const closeArr = (a, b, tol = 1e-5) => a.forEach((v, i) => close(v, b[i], tol));

test('solveHomography: 单位映射（正方形四点不变）', () => {
  const p = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const H = solveHomography(p, p);
  assert.ok(H);
  // 归一化 h33=1，期望为单位矩阵
  closeArr(H[0], [1, 0, 0]);
  closeArr(H[1], [0, 1, 0]);
  closeArr(H[2], [0, 0, 1]);
});

test('solveHomography: 已知透视矩阵可精确恢复', () => {
  const Hk = [
    [1.2, 0.3, 40],
    [0.1, 1.1, 25],
    [0.0005, 0.0002, 1],
  ];
  const src = [[0, 0], [200, 0], [200, 150], [0, 150]];
  // 用 Hk 正向计算目标点（独立于被测函数）
  const f = (x, y) => {
    const w = Hk[2][0] * x + Hk[2][1] * y + Hk[2][2];
    return [(Hk[0][0] * x + Hk[0][1] * y + Hk[0][2]) / w,
            (Hk[1][0] * x + Hk[1][1] * y + Hk[1][2]) / w];
  };
  const dst = src.map(([x, y]) => f(x, y));
  const H = solveHomography(src, dst);
  assert.ok(H);
  H.forEach((row, i) => closeArr(row, Hk[i], 1e-5));
});

test('solveHomography: 四点共线返回 null', () => {
  const src = [[0, 0], [10, 0], [20, 0], [30, 0]];
  const dst = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.strictEqual(solveHomography(src, dst), null);
});

test('invertHomography: H * H⁻¹ = 单位矩阵', () => {
  const H = [
    [2, 0, 10],
    [0, 3, -5],
    [0.001, 0, 1],
  ];
  const inv = invertHomography(H);
  assert.ok(inv);
  // 逆作用于 H 的列向量应还原单位矩阵列（用 transformPoint 验证回程）
  const p = [37, -12];
  const q = transformPoint(H, p[0], p[1]);
  const back = transformPoint(inv, q[0], q[1]);
  close(back[0], p[0], 1e-6);
  close(back[1], p[1], 1e-6);
});

test('invertHomography: 奇异矩阵返回 null', () => {
  const H = [[1, 1, 0], [1, 1, 0], [0, 0, 1]];
  assert.strictEqual(invertHomography(H), null);
});
