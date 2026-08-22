import test from 'node:test';
import assert from 'node:assert';
import { solarDeclination, equationOfTime, deg2rad, solarTime, hourAngle, altitudeAzimuth, sunPosition, daylightCurve } from './solar.js';
import { sunDirAtSolarTime } from './solar.js';

const close = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('冬至赤纬 ≈ -23.45°', () => {
  close(solarDeclination(355), -23.45, 0.6);
});

test('夏至赤纬 ≈ +23.45°', () => {
  close(solarDeclination(172), 23.45, 0.6);
});

test('春秋分赤纬 ≈ 0°', () => {
  close(solarDeclination(81), 0, 1.0);
});

test('均时差量级在 -16..+16 分钟内', () => {
  for (const n of [1, 60, 120, 180, 240, 300, 360]) {
    const e = equationOfTime(n);
    assert.ok(e >= -17 && e <= 17, `EoT(${n})=${e}`);
  }
});

test('时角：真太阳时正午为 0', () => {
  close(hourAngle(12), 0, 1e-9);
});

test('北纬40°冬至正午高度角 ≈ 26.55°', () => {
  const { altitude, azimuth } = altitudeAzimuth(40, -23.44, 0);
  close(altitude, 26.55, 0.6);
  close(azimuth, 0, 0.5); // 正午太阳在正南
});

test('北纬40°夏至正午高度角 ≈ 73.45°', () => {
  const { altitude } = altitudeAzimuth(40, 23.44, 0);
  close(altitude, 73.45, 0.6);
});

test('赤道春秋分正午高度角 ≈ 90°', () => {
  const { altitude } = altitudeAzimuth(0, 0, 0);
  close(altitude, 90, 0.5);
});

test('sunPosition 正午方向向量：朝南、y=sin(alt)', () => {
  // 经度=时区中央经线，选时刻使真太阳时≈12
  const N = 355;
  const eot = equationOfTime(N);
  const clock = 12 - eot / 60;
  const { dir, altitude } = sunPosition({
    lat: 40, lon: 120, tzMeridian: 120, dayOfYear: N, time: clock,
  });
  close(dir.x, 0, 0.02);           // 无东西分量
  assert.ok(dir.z > 0, 'dir.z 朝南(+Z)');
  close(dir.y, Math.sin(deg2rad(altitude)), 0.02);
});

test('上午太阳在东侧 (dir.x > 0)', () => {
  const { dir } = sunPosition({
    lat: 40, lon: 120, tzMeridian: 120, dayOfYear: 172, time: 8,
  });
  assert.ok(dir.x > 0, `上午应在东(+X)，实际 ${dir.x}`);
});

test('daylightCurve returns 24-hour altitude array with noon max, night negative', () => {
  const c = daylightCurve({ lat: 40, lon: 116, tzMeridian: 120, dayOfYear: 172 });
  assert.strictEqual(c.length, 24);
  // 正午(12)高度角最大，应为全天最高
  let maxIdx = 0;
  for (let i = 1; i < 24; i++) if (c[i] > c[maxIdx]) maxIdx = i;
  assert.strictEqual(maxIdx, 12);
  // 夜间(0点)高度角为负
  assert.ok(c[0] < 0);
  // 夏至正午高度角 ≈ 73.45°
  assert.ok(Math.abs(c[12] - 73.45) < 0.6);
});

test('daylightCurve respects equation of time: solar noon is not clock noon', () => {
  const c = daylightCurve({ lat: 40, lon: 116, tzMeridian: 120, dayOfYear: 172 });
  // 均时差使上午/下午不对称，差应显著大于 0（证明 EoT 生效）
  assert.ok(Math.abs(c[11] - c[13]) > 1, 'EoT should break strict symmetry');
});

test('sunDirAtSolarTime 正午 H=0 高度角=90-|lat-decl|，方向朝南', () => {
  // 冬至 decl≈-23.45，lat=40 → altitude≈90-63.45=26.55
  const r = sunDirAtSolarTime(40, 355, 12);
  assert.ok(Math.abs(r.altitude - 26.55) < 0.3, `alt ${r.altitude}`);
  assert.ok(Math.abs(r.dir.x) < 1e-6, `x ${r.dir.x}`); // 正午方位角 0
  assert.ok(r.dir.z > 0, `z ${r.dir.z}`);              // 朝南 +Z
});

test('sunDirAtSolarTime 上午偏东（dir.x>0）', () => {
  const r = sunDirAtSolarTime(40, 355, 9);
  assert.ok(r.dir.x > 0, `x ${r.dir.x}`);
});

test('sunDirAtSolarTime 方向为单位向量', () => {
  const r = sunDirAtSolarTime(40, 172, 12);
  const len = Math.hypot(r.dir.x, r.dir.y, r.dir.z);
  assert.ok(Math.abs(len - 1) < 1e-9, `len ${len}`);
});
