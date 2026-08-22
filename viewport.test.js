import test from 'node:test';
import assert from 'node:assert';
import {
  worldToPx, pxToWorld, zoomAt, metersPerPixel, gridStepMeters,
  geoBoxToWorld, fitView, geoPointsToWorld, polyBBox, pointInPolygon, buildingCenter,
  resizeImageMpp, imageBounds, translateImage, serializeState, deserializeState,
  pointSegDist, rotateFootprint,
} from './viewport.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('worldToPx applies scale and origin offset', () => {
  const view = { scale: 3, offX: 100, offY: 50 };
  const p = worldToPx(view, 10, -20);
  close(p.px, 100 + 10 * 3);
  close(p.py, 50 + (-20) * 3);
});

test('pxToWorld is inverse of worldToPx', () => {
  const view = { scale: 2.5, offX: 148, offY: 120 };
  const p = worldToPx(view, 17, -33);
  const w = pxToWorld(view, p.px, p.py);
  close(w.x, 17);
  close(w.z, -33);
});

test('zoomAt keeps the world point under the cursor fixed', () => {
  const view = { scale: 3, offX: 148, offY: 120 };
  const cx = 200, cy = 90;
  const worldBefore = pxToWorld(view, cx, cy);
  const zoomed = zoomAt(view, cx, cy, 1.25);
  const worldAfter = pxToWorld(zoomed, cx, cy);
  close(worldAfter.x, worldBefore.x, 1e-9);
  close(worldAfter.z, worldBefore.z, 1e-9);
  close(zoomed.scale, 3 * 1.25);
});

test('zoomAt clamps scale to [0.3, 30]', () => {
  const view = { scale: 25, offX: 0, offY: 0 };
  assert.strictEqual(zoomAt(view, 0, 0, 10).scale, 30);
  assert.strictEqual(zoomAt({ scale: 0.5, offX: 0, offY: 0 }, 0, 0, 0.1).scale, 0.3);
});

test('metersPerPixel divides real distance by pixel distance', () => {
  // two points 100px apart on the image, real 25 m → 0.25 m/px
  close(metersPerPixel({ x: 10, y: 10 }, { x: 110, y: 10 }, 25), 0.25);
  // diagonal 3-4-5
  close(metersPerPixel({ x: 0, y: 0 }, { x: 3, y: 4 }, 10), 2);
});

test('metersPerPixel returns null for coincident points', () => {
  assert.strictEqual(metersPerPixel({ x: 5, y: 5 }, { x: 5, y: 5 }, 10), null);
});

test('geoBoxToWorld converts lat/lon span to metric boundary centered at origin', () => {
  // 0.01° lat span ≈ 1113.2 m; at 40°N lon span 0.01° ≈ 1113.2·cos40 ≈ 852.8 m
  const r = geoBoxToWorld({ north: 40.01, south: 40.0, west: 116.0, east: 116.01 });
  close(r.midLat, 40.005, 1e-9);
  close(r.height, 0.01 * 111320, 1);         // N-S meters
  close(r.width, 0.01 * 111320 * Math.cos(40.005 * Math.PI / 180), 1);
  // centered at origin; north edge at -Z, south at +Z
  close(r.boundary.minZ, -r.height / 2, 1e-6);
  close(r.boundary.maxZ, r.height / 2, 1e-6);
  close(r.boundary.minX, -r.width / 2, 1e-6);
  close(r.boundary.maxX, r.width / 2, 1e-6);
});

test('geoPointsToWorld projects lat/lon points to metric XZ centered on their centroid', () => {
  // square-ish quad around (39.915, 116.395)
  const pts = [
    { lat: 39.91, lon: 116.39 }, // SW
    { lat: 39.91, lon: 116.40 }, // SE
    { lat: 39.92, lon: 116.40 }, // NE
    { lat: 39.92, lon: 116.39 }, // NW
  ];
  const r = geoPointsToWorld(pts);
  close(r.midLat, 39.915, 1e-9);
  // centroid at origin
  const mx = r.world.reduce((a, p) => a + p[0], 0) / 4;
  const mz = r.world.reduce((a, p) => a + p[1], 0) / 4;
  close(mx, 0, 1e-6); close(mz, 0, 1e-6);
  // NE corner: east → +X, north → −Z
  const ne = r.world[2];
  assert.ok(ne[0] > 0, 'east is +X');
  assert.ok(ne[1] < 0, 'north is −Z');
  // east/west symmetric magnitude
  close(Math.abs(r.world[0][0]), Math.abs(r.world[1][0]), 1e-6);
});

test('pointSegDist: perpendicular distance to a segment', () => {
  // 线段 (0,0)-(10,0)，点 (5,3) → 距离 3
  assert.strictEqual(pointSegDist(5, 3, 0, 0, 10, 0), 3);
  // 点在端点外，投影到端点：点 (-3,0) → 距离 3
  assert.strictEqual(pointSegDist(-3, 0, 0, 0, 10, 0), 3);
  // 零长度线段
  assert.strictEqual(pointSegDist(3, 4, 0, 0, 0, 0), 5);
});

test('rotateFootprint rotates a square 90° around its center', () => {
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const r = rotateFootprint(sq, 90);
  // 旋转 90° 后仍在 ±10 内（中心原点不变）
  for (const [x, z] of r) {
    assert.ok(Math.abs(x) <= 10.001 && Math.abs(z) <= 10.001, `[${x},${z}]`);
  }
  // 第一个角 (-10,-10) 绕原点逆时针 90° → (10,-10) 附近（屏幕坐标 z 轴）
  const [x0, z0] = r[0];
  assert.ok(Math.abs(x0 - 10) < 0.001 && Math.abs(z0 - (-10)) < 0.001);
});

test('rotateFootprint with 0° returns the same points', () => {
  const sq = [[-10, -10], [10, 10]];
  assert.strictEqual(rotateFootprint(sq, 0), sq);
});

test('pointInPolygon ray-casting hit test', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.strictEqual(pointInPolygon(sq, 5, 5), true);        // inside
  assert.strictEqual(pointInPolygon(sq, 11, 5), false);      // right outside
  assert.strictEqual(pointInPolygon(sq, 5, -1), false);      // top outside
  assert.strictEqual(pointInPolygon(sq, -3, 50), false);     // far
});

test('buildingCenter averages the footprint', () => {
  const c = buildingCenter({ footprint: [[-10, -10], [10, -10], [10, 10], [-10, 10]] });
  close(c.x, 0); close(c.z, 0);
  const c2 = buildingCenter({ footprint: [[0, 0], [10, 0], [10, 10]] });
  close(c2.x, 20 / 3); close(c2.z, 10 / 3);
});

test('serializeState round-trips buildings/walls/boundary/params without bg', () => {
  const s = {
    buildings: [{ id: 'b1', footprint: [[0,0],[10,0],[10,10]], floorHeight: 3, floorCount: 6, overrides: {} }],
    walls: [{ id: 'w1', path: [[0,0],[5,5]], height: 2.5, thickness: 0.4 }],
    boundaryPoly: [[-10,-10],[10,-10],[10,10]],
    lat: 39.9, lon: 116.4, tzMeridian: 120, dayOfYear: 355, time: 12, playing: false,
    bg: null,
  };
  const r = deserializeState(serializeState(s));
  assert.deepStrictEqual(r.buildings, s.buildings);
  assert.deepStrictEqual(r.walls, s.walls);
  assert.deepStrictEqual(r.boundaryPoly, s.boundaryPoly);
  assert.strictEqual(r.lat, s.lat);
  assert.strictEqual(r.bg, null);
});

test('serializeState embeds bg image as base64 and restores it', () => {
  const s = {
    buildings: [], walls: [],
    bg: { worldX: -50, worldZ: -40, mpp: 0.5, imgSrc: 'data:image/png;base64,AAAA' },
  };
  const r = deserializeState(serializeState(s));
  assert.strictEqual(r.bg.mpp, 0.5);
  assert.ok(r.bg.imgSrc.startsWith('data:image/png'));
  assert.ok(r.bg.imgSrc.includes('AAAA'));
});

test('imageBounds returns the image\'s world bounding box', () => {
  const bg = { worldX: 10, worldZ: 20, mpp: 0.5, img: { width: 200, height: 100 } };
  const b = imageBounds(bg);
  close(b.minX, 10); close(b.maxX, 10 + 200 * 0.5);   // 10..110
  close(b.minZ, 20); close(b.maxZ, 20 + 100 * 0.5);   // 20..70
});

test('translateImage shifts worldX/worldZ by world meters', () => {
  const bg = { worldX: 10, worldZ: 20, mpp: 0.5, img: { width: 200, height: 100 } };
  const t = translateImage(bg, -5, 8);
  close(t.worldX, 5); close(t.worldZ, 28);
});

test('resizeImageMpp scales mpp around the image center, keeping center fixed', () => {
  const bg = { worldX: 10, worldZ: 20, mpp: 0.5, img: { width: 200, height: 100 } };
  const cx = bg.worldX + (bg.img.width * bg.mpp) / 2;   // 10 + 50 = 60
  const cz = bg.worldZ + (bg.img.height * bg.mpp) / 2;  // 20 + 25 = 45
  const r = resizeImageMpp(bg, 1.2);
  close(r.mpp, 0.6, 1e-9);                              // 0.5 * 1.2
  // 中心世界点不变
  const ncx = r.worldX + (r.img.width * r.mpp) / 2;
  const ncz = r.worldZ + (r.img.height * r.mpp) / 2;
  close(ncx, cx, 1e-9);
  close(ncz, cz, 1e-9);
});

test('polyBBox returns min/max over polygon points', () => {
  const bb = polyBBox([[-5, 10], [20, -3], [7, 40]]);
  assert.deepStrictEqual(bb, { minX: -5, maxX: 20, minZ: -3, maxZ: 40 });
});

test('fitView scales a boundary to fit the canvas with margin and centers it', () => {
  const boundary = { minX: -400, maxX: 400, minZ: -200, maxZ: 200 }; // 800×400 m
  const v = fitView(300, 240, boundary, 0.1); // 10% margin
  // width-limited: (300·0.9)/800 = 0.3375; height: (240·0.9)/400 = 0.54 → min = 0.3375
  close(v.scale, 0.3375, 1e-9);
  // boundary center is origin → offset is canvas center
  close(v.offX, 150, 1e-9);
  close(v.offY, 120, 1e-9);
});

test('gridStepMeters keeps grid lines at least 20px apart', () => {
  // scale 3 px/m: step must satisfy step*3 >= 20 → step >= 6.67 → 10
  assert.strictEqual(gridStepMeters(3), 10);
  // scale 30 px/m (zoomed in): step 1 gives 30px ≥ 20 → 1
  assert.strictEqual(gridStepMeters(30), 1);
  // scale 0.5 px/m (zoomed out): need big step; 50*0.5=25 ≥20 → 50
  assert.strictEqual(gridStepMeters(0.5), 50);
});
