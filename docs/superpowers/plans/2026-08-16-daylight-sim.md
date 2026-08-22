# 楼房采光模拟 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页版楼房采光模拟：2D 俯视画楼底/围墙 → 3D 场景实时阴影，精确太阳几何驱动，逐层高亮晒到/遮挡。

**Architecture:** 单个 `index.html` + ES modules，无构建。`solar.js` 为纯函数太阳几何模块（node 可单测）；`scene.js` 负责 Three.js 场景、2D 编辑器、控件、渲染循环。state 单一数据源。

**Tech Stack:** Vanilla JS (ES modules)、Three.js（本地 vendored）、`node --test`（内置测试器）。

**Spec:** `docs/superpowers/specs/2026-08-16-daylight-sim-design.md`

## Global Constraints

- 纯 vanilla JS + ES modules，**无构建步骤**（不用 Vite/webpack/bundler）。
- Three.js 本地 vendored 到 `vendor/`，运行时不依赖 CDN。
- 坐标约定：y 朝上，北 = −Z，东 = +X（南 = +Z，西 = −X）。
- 太阳方位角 A 以正南为 0、向西为正、向东为负（度）。
- 长度单位：米。角度公式内部一律先转弧度再算三角。
- `package.json` 含 `"type": "module"`，使 `.js` 在 node 与浏览器都按 ES module 解析。

---

### Task 1: 项目脚手架 + 太阳赤纬与均时差

**Files:**
- Create: `package.json`
- Create: `solar.js`
- Test: `solar.test.js`

**Interfaces:**
- Produces:
  - `deg2rad(d: number): number`、`rad2deg(r: number): number`
  - `solarDeclination(dayOfYear: number): number` — 赤纬（度）
  - `equationOfTime(dayOfYear: number): number` — 均时差（分钟）

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "daylight-sim",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 写失败测试** `solar.test.js`

```js
import test from 'node:test';
import assert from 'node:assert';
import { solarDeclination, equationOfTime } from './solar.js';

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
    assert.ok(e >= -16 && e <= 16, `EoT(${n})=${e}`);
  }
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test`
Expected: FAIL（`solar.js` 不存在 / 函数未定义）

- [ ] **Step 4: 写最小实现** `solar.js`

```js
export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

// 赤纬（度），Cooper 公式
export function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin(deg2rad((360 * (284 + dayOfYear)) / 365));
}

// 均时差（分钟）
export function equationOfTime(dayOfYear) {
  const B = deg2rad((360 * (dayOfYear - 81)) / 365);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test`
Expected: PASS（4 个测试）

- [ ] **Step 6: Commit**

```bash
git add package.json solar.js solar.test.js
git commit -m "feat: solar declination and equation of time"
```

---

### Task 2: 太阳时、高度角/方位角、方向向量

**Files:**
- Modify: `solar.js`
- Test: `solar.test.js`

**Interfaces:**
- Consumes: `solarDeclination`, `equationOfTime`, `deg2rad`, `rad2deg`（Task 1）
- Produces:
  - `solarTime(clockHour, lon, tzMeridian, dayOfYear): number` — 真太阳时（小时）
  - `hourAngle(solarTimeHours): number` — 时角（度）
  - `altitudeAzimuth(latDeg, declDeg, hourAngleDeg): { altitude, azimuth }` — 度，azimuth 从正南、向西为正
  - `sunPosition({ lat, lon, tzMeridian, dayOfYear, time }): { altitude, azimuth, dir: {x,y,z} }` — dir 为指向太阳的单位向量（Three.js 坐标）

- [ ] **Step 1: 追加失败测试** `solar.test.js`

```js
import {
  solarTime, hourAngle, altitudeAzimuth, sunPosition,
} from './solar.js';

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
```

（注：`deg2rad`、`equationOfTime` 已在文件顶部 import；若未 import 需补上。）

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test`
Expected: FAIL（新函数未定义）

- [ ] **Step 3: 追加实现** `solar.js`

```js
// 真太阳时（小时）：时钟 + 经度修正 + 均时差
export function solarTime(clockHour, lon, tzMeridian, dayOfYear) {
  const longitudeCorrMin = (lon - tzMeridian) * 4; // 每度 4 分钟
  const eotMin = equationOfTime(dayOfYear);
  return clockHour + (longitudeCorrMin + eotMin) / 60;
}

// 时角（度）：每小时 15°，正午为 0
export function hourAngle(solarTimeHours) {
  return 15 * (solarTimeHours - 12);
}

// 高度角 + 方位角（度）。azimuth 从正南量、向西为正、向东为负。
export function altitudeAzimuth(latDeg, declDeg, hourAngleDeg) {
  const lat = deg2rad(latDeg);
  const decl = deg2rad(declDeg);
  const H = deg2rad(hourAngleDeg);
  const sinAlt =
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const altitude = rad2deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
  const azimuth = rad2deg(
    Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)
    )
  );
  return { altitude, azimuth };
}

// 完整太阳位置 + 指向太阳的单位方向向量（Three.js 坐标：y上, 北=-Z, 东=+X）
export function sunPosition({ lat, lon, tzMeridian, dayOfYear, time }) {
  const decl = solarDeclination(dayOfYear);
  const st = solarTime(time, lon, tzMeridian, dayOfYear);
  const H = hourAngle(st);
  const { altitude, azimuth } = altitudeAzimuth(lat, decl, H);
  const altR = deg2rad(altitude);
  const azR = deg2rad(azimuth); // 从正南、向西为正
  const dir = {
    x: -Math.cos(altR) * Math.sin(azR), // 西=-X，故东(负方位)得正x
    y: Math.sin(altR),
    z: Math.cos(altR) * Math.cos(azR),  // 南=+Z
  };
  return { altitude, azimuth, dir };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add solar.js solar.test.js
git commit -m "feat: solar altitude/azimuth and direction vector"
```

---

### Task 3: Vendor Three.js + 基础 3D 场景

无纯函数可单测；交付物靠浏览器肉眼验证。

**Files:**
- Create: `vendor/three.module.js`（下载）
- Create: `vendor/OrbitControls.js`（下载）
- Create: `index.html`
- Create: `scene.js`

**Interfaces:**
- Produces:
  - `scene.js` 默认自启动：创建 renderer、相机、OrbitControls、地面、`DirectionalLight`（sun）、`AmbientLight`。
  - 全局状态对象 `state = { buildings: [], walls: [], lat, lon, tzMeridian, dayOfYear, time, playing }`
  - `export const state`（供后续 Task import）
  - `export function render()` — 单帧渲染

- [ ] **Step 1: 下载 Three.js 到 vendor/**

```bash
mkdir -p vendor
curl -L https://unpkg.com/three@0.160.0/build/three.module.js -o vendor/three.module.js
curl -L https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js -o vendor/OrbitControls.js
```

若离线无法下载：从任意可访问处取 three@0.160.0 的 `build/three.module.js` 与 `examples/jsm/controls/OrbitControls.js` 放入 `vendor/`。OrbitControls 内 `import ... from 'three'` 由 index.html 的 importmap 解析。

- [ ] **Step 2: 写 index.html**

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>楼房采光模拟</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; }
    #app { display: flex; height: 100%; }
    #view3d { flex: 1; position: relative; }
    #panel { width: 320px; padding: 12px; box-sizing: border-box;
             overflow-y: auto; background: #f4f4f4; border-left: 1px solid #ccc; }
    #plan2d { width: 100%; height: 240px; background: #fff;
              border: 1px solid #ccc; display: block; }
    canvas#view { display: block; width: 100%; height: 100%; }
    .row { margin: 8px 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .row label { flex: 0 0 90px; font-size: 13px; }
    .row input, .row select { flex: 1; }
  </style>
  <script type="importmap">
  { "imports": { "three": "./vendor/three.module.js" } }
  </script>
</head>
<body>
  <div id="app">
    <div id="view3d"><canvas id="view"></canvas></div>
    <div id="panel">
      <h3>采光控制</h3>
      <canvas id="plan2d" width="296" height="240"></canvas>
      <div id="controls"></div>
      <div id="lists"></div>
    </div>
  </div>
  <script type="module" src="./scene.js"></script>
</body>
</html>
```

- [ ] **Step 3: 写 scene.js 基础场景**

```js
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { sunPosition } from './solar.js';

export const state = {
  buildings: [],
  walls: [],
  lat: 40, lon: 116, tzMeridian: 120,
  dayOfYear: 355, time: 12, playing: false,
};

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
camera.position.set(80, 80, 120);
const controls = new OrbitControls(camera, canvas);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshStandardMaterial({ color: 0x9ccc65 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -200; sc.right = 200; sc.top = 200; sc.bottom = -200;
sc.near = 1; sc.far = 1000;
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const SUN_DIST = 400;
export function updateSun() {
  const { dir, altitude } = sunPosition(state);
  sun.visible = altitude > 0;
  sun.position.set(dir.x * SUN_DIST, dir.y * SUN_DIST, dir.z * SUN_DIST);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
}

// 供后续 Task 挂载楼/墙的容器
export const worldGroup = new THREE.Group();
scene.add(worldGroup);

export function render() {
  renderer.render(scene, camera);
}

function resize() {
  const el = document.getElementById('view3d');
  const w = el.clientWidth, h = el.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function loop() {
  controls.update();
  render();
  requestAnimationFrame(loop);
}
resize();
updateSun();
loop();

// 供后续 Task 复用
export { scene, camera, THREE };
```

- [ ] **Step 4: 浏览器验证**

Run: 在项目根起静态服务器 `python3 -m http.server 8080`，浏览器开 `http://localhost:8080/`。
Expected: 看到蓝天、绿地面、可用鼠标旋转/缩放的 3D 视图；无控制台报错。（此时还没有楼。）

- [ ] **Step 5: Commit**

```bash
git add index.html scene.js vendor/
git commit -m "feat: vendor three.js and base 3d scene with sun light"
```

---

### Task 4: 楼几何 — 多边形楼底分层拉伸

**Files:**
- Create: `geometry.js`
- Test: `geometry.test.js`
- Modify: `scene.js`

**Interfaces:**
- Consumes: `state`, `worldGroup`, `THREE`（Task 3）
- Produces:
  - `floorHeights(building): number[]` — 各层层高数组（应用 overrides）
  - `buildingTotalHeight(building): number`
  - `buildFloorMeshes(building, THREE): THREE.Mesh[]` — 每层一个可独立上色的 Mesh
  - `rebuildWorld(THREE)`（scene.js 导出）— 清空并按 state 重建所有楼/墙 mesh 到 worldGroup

- [ ] **Step 1: 写失败测试** `geometry.test.js`

```js
import test from 'node:test';
import assert from 'node:assert';
import { floorHeights, buildingTotalHeight } from './geometry.js';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test`
Expected: FAIL

- [ ] **Step 3: 写实现** `geometry.js`（纯数据部分）

```js
export function floorHeights(building) {
  const out = [];
  for (let i = 0; i < building.floorCount; i++) {
    out.push(building.overrides?.[i] ?? building.floorHeight);
  }
  return out;
}

export function buildingTotalHeight(building) {
  return floorHeights(building).reduce((a, b) => a + b, 0);
}

// 多边形楼底 [[x,z],...] → 每层一个 Mesh（沿 Y 堆叠）
export function buildFloorMeshes(building, THREE) {
  const shape = new THREE.Shape();
  const fp = building.footprint;
  shape.moveTo(fp[0][0], fp[0][1]);
  for (let i = 1; i < fp.length; i++) shape.lineTo(fp[i][0], fp[i][1]);
  shape.closePath();

  const heights = floorHeights(building);
  const meshes = [];
  let base = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h, bevelEnabled: false,
    });
    // ExtrudeGeometry 在 XY 面拉伸(+Z)，旋转到 XZ 地面(+Y)
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xbfc7cf })
    );
    mesh.position.y = base;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'floor', buildingId: building.id, floor: i };
    meshes.push(mesh);
    base += h;
  }
  return meshes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: 在 scene.js 加 rebuildWorld 并接线**

在 `scene.js` 追加（import 与导出）：

```js
import { buildFloorMeshes } from './geometry.js';

export function rebuildWorld(THREE) {
  while (worldGroup.children.length) {
    const c = worldGroup.children.pop();
    c.geometry?.dispose?.();
    worldGroup.remove(c);
  }
  for (const b of state.buildings) {
    for (const m of buildFloorMeshes(b, THREE)) worldGroup.add(m);
  }
  // 墙在 Task 5 追加
}
```

在启动处（`updateSun(); loop();` 之前）加一栋测试楼并重建，用于肉眼验证：

```js
state.buildings.push({
  id: 'b1',
  footprint: [[-10, -10], [10, -10], [10, 10], [-10, 10]],
  floorHeight: 3, floorCount: 8, overrides: {},
});
rebuildWorld(THREE);
```

- [ ] **Step 6: 浏览器验证**

Run: 刷新 `http://localhost:8080/`
Expected: 地面上出现一栋 8 层高的方楼，投下阴影；旋转相机阴影方向合理。

- [ ] **Step 7: Commit**

```bash
git add geometry.js geometry.test.js scene.js
git commit -m "feat: layered building geometry from polygon footprint"
```

---

### Task 5: 围墙几何 — 折线拉薄墙条

**Files:**
- Modify: `geometry.js`
- Test: `geometry.test.js`
- Modify: `scene.js`

**Interfaces:**
- Consumes: `THREE`, `state`, `worldGroup`, `rebuildWorld`（Task 4）
- Produces:
  - `wallSegments(wall): Array<{ ax, az, bx, bz }>` — 折线相邻点对
  - `buildWallMeshes(wall, THREE): THREE.Mesh[]` — 每段一个带厚度的墙 Mesh

- [ ] **Step 1: 写失败测试** `geometry.test.js`

```js
import { wallSegments } from './geometry.js';

test('折线 N 点得到 N-1 段', () => {
  const w = { path: [[0, 0], [10, 0], [10, 10]] };
  const segs = wallSegments(w);
  assert.strictEqual(segs.length, 2);
  assert.deepStrictEqual(segs[0], { ax: 0, az: 0, bx: 10, bz: 0 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test`
Expected: FAIL

- [ ] **Step 3: 写实现** `geometry.js`

```js
export function wallSegments(wall) {
  const segs = [];
  const p = wall.path;
  for (let i = 0; i < p.length - 1; i++) {
    segs.push({ ax: p[i][0], az: p[i][1], bx: p[i + 1][0], bz: p[i + 1][1] });
  }
  return segs;
}

// 每段折线 → 带厚度、带高度的 box 墙
export function buildWallMeshes(wall, THREE) {
  const meshes = [];
  for (const s of wallSegments(wall)) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const geo = new THREE.BoxGeometry(len, wall.height, wall.thickness);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xd7ccc8 })
    );
    mesh.position.set((s.ax + s.bx) / 2, wall.height / 2, (s.az + s.bz) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'wall', wallId: wall.id };
    meshes.push(mesh);
  }
  return meshes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: 在 scene.js 的 rebuildWorld 里加墙**

在 `rebuildWorld` 的楼循环后追加：

```js
import { buildWallMeshes } from './geometry.js';
// ... 在 rebuildWorld 内，楼循环之后：
  for (const w of state.walls) {
    for (const m of buildWallMeshes(w, THREE)) worldGroup.add(m);
  }
```

在测试楼后加一段测试围墙：

```js
state.walls.push({
  id: 'w1',
  path: [[-30, 20], [30, 20]],
  height: 2.5, thickness: 0.4,
});
rebuildWorld(THREE);
```

- [ ] **Step 6: 浏览器验证**

Run: 刷新页面
Expected: 楼北侧出现一道 2.5m 矮墙，投下细长阴影。

- [ ] **Step 7: Commit**

```bash
git add geometry.js geometry.test.js scene.js
git commit -m "feat: freestanding wall geometry from polyline"
```

---

### Task 6: 2D 俯视编辑器 — 画楼底 / 画围墙

无纯函数交付；靠浏览器交互验证。

**Files:**
- Create: `editor2d.js`
- Modify: `scene.js`（引入 editor2d，rebuild 回调）
- Modify: `index.html`（已有 `#plan2d` canvas 与占位；此处加模式按钮容器）

**Interfaces:**
- Consumes: `state`, `rebuildWorld`, `THREE`（Task 3–5）
- Produces:
  - `initEditor2d({ canvas, state, onChange })` — 绑定 2D canvas 交互
  - 内部维护「建楼 / 围墙」模式与正在绘制的点集；完成后写入 `state.buildings` / `state.walls` 并调用 `onChange()`

- [ ] **Step 1: 写 editor2d.js**

```js
// 世界坐标(米) <-> 2D canvas 像素。以 canvas 中心为原点，SCALE 像素/米。
const SCALE = 3;
function worldToPx(canvas, x, z) {
  return { px: canvas.width / 2 + x * SCALE, py: canvas.height / 2 + z * SCALE };
}
function pxToWorld(canvas, px, py) {
  return { x: (px - canvas.width / 2) / SCALE, z: (py - canvas.height / 2) / SCALE };
}

export function initEditor2d({ canvas, state, onChange }) {
  const ctx = canvas.getContext('2d');
  let mode = 'building'; // 'building' | 'wall'
  let pts = [];          // 正在绘制的点 [{x,z}]

  function setMode(m) { mode = m; pts = []; draw(); }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 网格
    ctx.strokeStyle = '#eee';
    for (let gx = 0; gx <= canvas.width; gx += SCALE * 5) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
    }
    for (let gy = 0; gy <= canvas.height; gy += SCALE * 5) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
    }
    // 已有楼
    ctx.strokeStyle = '#607d8b'; ctx.fillStyle = 'rgba(96,125,139,0.2)';
    for (const b of state.buildings) {
      ctx.beginPath();
      b.footprint.forEach(([x, z], i) => {
        const p = worldToPx(canvas, x, z);
        i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py);
      });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 已有墙
    ctx.strokeStyle = '#8d6e63';
    for (const w of state.walls) {
      ctx.beginPath();
      w.path.forEach(([x, z], i) => {
        const p = worldToPx(canvas, x, z);
        i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py);
      });
      ctx.stroke();
    }
    // 正在绘制
    if (pts.length) {
      ctx.strokeStyle = '#e53935'; ctx.fillStyle = '#e53935';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = worldToPx(canvas, p.x, p.z);
        i ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py);
      });
      ctx.stroke();
      for (const p of pts) {
        const q = worldToPx(canvas, p.x, p.z);
        ctx.beginPath(); ctx.arc(q.px, q.py, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const w = pxToWorld(canvas, e.clientX - r.left, e.clientY - r.top);
    pts.push({ x: Math.round(w.x), z: Math.round(w.z) });
    draw();
  });

  // 双击完成
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    finish();
  });

  function finish() {
    if (mode === 'building') {
      if (pts.length >= 3) {
        const h = parseFloat(prompt('默认层高(米)', '3')) || 3;
        const n = parseInt(prompt('层数', '6')) || 6;
        state.buildings.push({
          id: 'b' + Date.now(),
          footprint: pts.map((p) => [p.x, p.z]),
          floorHeight: h, floorCount: n, overrides: {},
        });
      }
    } else {
      if (pts.length >= 2) {
        const h = parseFloat(prompt('墙高(米)', '2.5')) || 2.5;
        const t = parseFloat(prompt('墙厚(米)', '0.4')) || 0.4;
        state.walls.push({
          id: 'w' + Date.now(),
          path: pts.map((p) => [p.x, p.z]),
          height: h, thickness: t,
        });
      }
    }
    pts = [];
    draw();
    onChange();
  }

  draw();
  return { setMode, redraw: draw };
}
```

- [ ] **Step 2: 在 index.html 的 `#controls` 前加模式按钮**

在 `<canvas id="plan2d">` 之后插入：

```html
<div class="row">
  <button id="mode-building">画楼</button>
  <button id="mode-wall">画围墙</button>
  <small>点击加点，双击完成</small>
</div>
```

- [ ] **Step 3: 在 scene.js 接线 editor2d**

移除 Task 4/5 里写死的测试楼与测试墙（`state.buildings.push(...)`、`state.walls.push(...)`），改为空场景 + 编辑器驱动：

```js
import { initEditor2d } from './editor2d.js';

const editor = initEditor2d({
  canvas: document.getElementById('plan2d'),
  state,
  onChange: () => { rebuildWorld(THREE); },
});
document.getElementById('mode-building').onclick = () => editor.setMode('building');
document.getElementById('mode-wall').onclick = () => editor.setMode('wall');
rebuildWorld(THREE);
```

- [ ] **Step 4: 浏览器验证**

Run: 刷新页面。点「画楼」→ 2D 画布上点 4 个点 → 双击 → 输入层高/层数。
Expected: 3D 场景即时出现对应楼；再点「画围墙」画折线→双击→输入高/厚，出现矮墙。

- [ ] **Step 5: Commit**

```bash
git add editor2d.js index.html scene.js
git commit -m "feat: 2d plan editor for drawing buildings and walls"
```

---

### Task 7: 控件面板 — 纬度/经度/日期/时间 → 太阳

**Files:**
- Create: `controls.js`
- Modify: `scene.js`

**Interfaces:**
- Consumes: `state`, `updateSun`（Task 3）
- Produces:
  - `dateToDayOfYear(year, month, day): number` — 年内第几天
  - `initControls({ container, state, onChange })` — 渲染滑块/输入并回写 state

- [ ] **Step 1: 写失败测试** `controls.test.js`

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test`
Expected: FAIL

- [ ] **Step 3: 写 controls.js**

```js
export function dateToDayOfYear(year, month, day) {
  const start = Date.UTC(year, 0, 1);
  const cur = Date.UTC(year, month - 1, day);
  return Math.floor((cur - start) / 86400000) + 1;
}

export function initControls({ container, state, onChange }) {
  container.innerHTML = `
    <div class="row"><label>纬度</label>
      <input id="c-lat" type="range" min="-66" max="66" step="0.5" value="${state.lat}">
      <span id="c-lat-v">${state.lat}</span></div>
    <div class="row"><label>经度</label>
      <input id="c-lon" type="number" step="0.5" value="${state.lon}"></div>
    <div class="row"><label>时区中央经线</label>
      <input id="c-tz" type="number" step="15" value="${state.tzMeridian}"></div>
    <div class="row"><label>日期</label>
      <input id="c-date" type="date" value="2026-12-21"></div>
    <div class="row"><label>时间</label>
      <input id="c-time" type="range" min="0" max="24" step="0.1" value="${state.time}">
      <span id="c-time-v">${state.time}</span></div>
    <div class="row">
      <button id="c-winter">冬至</button>
      <button id="c-equinox">春秋分</button>
      <button id="c-summer">夏至</button>
    </div>
  `;
  const $ = (id) => container.querySelector(id);

  function syncDate() {
    const [y, m, d] = $('#c-date').value.split('-').map(Number);
    state.dayOfYear = dateToDayOfYear(y, m, d);
  }
  syncDate();

  $('#c-lat').oninput = (e) => { state.lat = +e.target.value; $('#c-lat-v').textContent = e.target.value; onChange(); };
  $('#c-lon').oninput = (e) => { state.lon = +e.target.value; onChange(); };
  $('#c-tz').oninput = (e) => { state.tzMeridian = +e.target.value; onChange(); };
  $('#c-date').oninput = () => { syncDate(); onChange(); };
  $('#c-time').oninput = (e) => { state.time = +e.target.value; $('#c-time-v').textContent = e.target.value; onChange(); };

  const setDate = (v) => { $('#c-date').value = v; syncDate(); onChange(); };
  $('#c-winter').onclick = () => setDate('2026-12-21');
  $('#c-equinox').onclick = () => setDate('2026-03-21');
  $('#c-summer').onclick = () => setDate('2026-06-21');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: 在 scene.js 接线**

```js
import { initControls } from './controls.js';

initControls({
  container: document.getElementById('controls'),
  state,
  onChange: () => { updateSun(); },
});
```

- [ ] **Step 6: 浏览器验证**

Run: 刷新页面，画一栋楼，拖时间滑块。
Expected: 阴影随时间移动；切纬度/日期（冬至按钮）阴影长度变化合理（冬至影长）。

- [ ] **Step 7: Commit**

```bash
git add controls.js controls.test.js scene.js
git commit -m "feat: control panel wiring lat/lon/date/time to sun"
```

---

### Task 8: 播放/暂停阴影动画

**Files:**
- Modify: `index.html`（加播放按钮）
- Modify: `scene.js`

**Interfaces:**
- Consumes: `state`, `updateSun`（Task 3/7）
- Produces: 主循环内按 `state.playing` 自动推进 `state.time`

- [ ] **Step 1: index.html 加按钮**

在 `#controls` 之后、`#lists` 之前插入：

```html
<div class="row"><button id="play">▶ 播放</button></div>
```

- [ ] **Step 2: scene.js 加动画推进**

在 `loop()` 内，`controls.update()` 之后加：

```js
if (state.playing) {
  state.time += 0.02;              // 每帧推进
  if (state.time > 24) state.time = 4;
  const slider = document.getElementById('c-time');
  if (slider) { slider.value = state.time; }
  const label = document.getElementById('c-time-v');
  if (label) label.textContent = state.time.toFixed(1);
  updateSun();
  onFloorsDirty();                 // Task 9 定义；Task 8 阶段可先空实现
}
```

在文件内先加一个占位（Task 9 覆盖）：

```js
export let onFloorsDirty = () => {};
export function setOnFloorsDirty(fn) { onFloorsDirty = fn; }
```

按钮接线：

```js
document.getElementById('play').onclick = (e) => {
  state.playing = !state.playing;
  e.target.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
};
```

- [ ] **Step 3: 浏览器验证**

Run: 刷新页面，画楼，点播放。
Expected: 阴影从早到晚连续扫过，暂停可停。

- [ ] **Step 4: Commit**

```bash
git add index.html scene.js
git commit -m "feat: play/pause shadow animation over time"
```

---

### Task 9: 逐层采光判定 + 高亮

**Files:**
- Create: `daylight.js`
- Test: `daylight.test.js`
- Modify: `scene.js`

**Interfaces:**
- Consumes: `state`, `worldGroup`, `THREE`, `sunPosition`（前序 Task）
- Produces:
  - `floorSamplePoint(building, floorIndex, THREE): THREE.Vector3` — 该层代表点（楼底质心，抬到层中点高度）
  - `computeFloorLit({ THREE, worldGroup, buildings, sunDir, altitude }): Map<meshUUID, boolean>` — 每层 mesh 是否晒到
  - `applyFloorColors(worldGroup, litMap, THREE)` — 按结果给层上色（晒到=暖亮，遮挡=冷暗）
  - `refreshDaylight(THREE)`（scene.js）— 组合上述并在 state 变化时调用

- [ ] **Step 1: 写失败测试** `daylight.test.js`

用最小 Three（几何 + Raycaster）验证遮挡逻辑：

```js
import test from 'node:test';
import assert from 'node:assert';
import * as THREE from './vendor/three.module.js';
import { polygonCentroid } from './daylight.js';

test('矩形质心为中心', () => {
  const c = polygonCentroid([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.z) < 1e-9);
});
```

（注：完整光线遮挡走浏览器验证；单测只覆盖可纯函数化的质心。若 node 无法 import three.module.js（浏览器专用 API），改为不 import THREE、仅测 `polygonCentroid`。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test`
Expected: FAIL

- [ ] **Step 3: 写 daylight.js**

```js
export function polygonCentroid(footprint) {
  let x = 0, z = 0;
  for (const [px, pz] of footprint) { x += px; z += pz; }
  return { x: x / footprint.length, z: z / footprint.length };
}

// 该层代表点：楼底质心，抬到该层中点高度
export function floorSamplePoint(building, floorIndex, heights, THREE) {
  const c = polygonCentroid(building.footprint);
  let base = 0;
  for (let i = 0; i < floorIndex; i++) base += heights[i];
  const y = base + heights[floorIndex] / 2;
  return new THREE.Vector3(c.x, y, c.z);
}

const LIT = 0xfff3c4;   // 暖亮
const DARK = 0x5a6b7a;  // 冷暗

// 对 worldGroup 里每个 floor mesh 判定是否晒到并上色
export function refreshFloorColors({ THREE, worldGroup, sunDir, altitude }) {
  const dir = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize();
  const raycaster = new THREE.Raycaster();
  const blockers = worldGroup.children; // 所有楼层 + 墙 mesh
  for (const mesh of worldGroup.children) {
    if (mesh.userData?.kind !== 'floor') continue;
    let lit;
    if (altitude <= 0) {
      lit = false;
    } else {
      // mesh 几何中心 + 半高 作代表点
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const center = bb.getCenter(new THREE.Vector3());
      center.applyMatrix4(mesh.matrixWorld);
      raycaster.set(center, dir);
      const hits = raycaster.intersectObjects(
        blockers.filter((m) => m !== mesh), true
      );
      lit = hits.length === 0;
    }
    mesh.material.color.setHex(lit ? LIT : DARK);
    mesh.userData.lit = lit;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test`
Expected: PASS（质心测试）

- [ ] **Step 5: 在 scene.js 接线**

```js
import { refreshFloorColors } from './daylight.js';

export function refreshDaylight(THREE) {
  const { dir, altitude } = sunPosition(state);
  refreshFloorColors({ THREE, worldGroup, sunDir: dir, altitude });
}

// 把占位 onFloorsDirty 换成真实刷新
setOnFloorsDirty(() => refreshDaylight(THREE));

// rebuildWorld 之后、控件 onChange、updateSun 之后都要刷新采光：
// - editor onChange: rebuildWorld(THREE); refreshDaylight(THREE);
// - controls onChange: updateSun(); refreshDaylight(THREE);
```

更新 editor 与 controls 的 onChange 回调，使其在几何/太阳变化后调用 `refreshDaylight(THREE)`。

- [ ] **Step 6: 浏览器验证**

Run: 刷新页面。画两栋楼：一栋高（如 20 层）在南、一栋矮（如 6 层）在其北侧近处；日期设冬至、时间正午。
Expected: 矮楼低层被高楼挡的记为暗色、高层为亮色；拖时间，亮/暗分界随太阳移动；夜间全暗。围墙也能压住邻楼一楼。

- [ ] **Step 7: Commit**

```bash
git add daylight.js daylight.test.js scene.js
git commit -m "feat: per-floor daylight raycast and lit/shadowed coloring"
```

---

### Task 10: 楼 / 围墙列表 — 编辑与删除

**Files:**
- Create: `lists.js`
- Modify: `scene.js`

**Interfaces:**
- Consumes: `state`, `rebuildWorld`, `refreshDaylight`, `THREE`
- Produces: `initLists({ container, state, onChange })` — 渲染楼/墙列表，支持改参数与删除

- [ ] **Step 1: 写 lists.js**

```js
export function initLists({ container, state, onChange }) {
  function render() {
    const b = state.buildings.map((x) => `
      <div class="row">
        楼 ${x.id.slice(-4)}
        层高<input data-id="${x.id}" data-k="floorHeight" type="number" step="0.1" value="${x.floorHeight}" style="width:50px">
        层数<input data-id="${x.id}" data-k="floorCount" type="number" value="${x.floorCount}" style="width:45px">
        <button data-del-b="${x.id}">删</button>
      </div>`).join('');
    const w = state.walls.map((x) => `
      <div class="row">
        墙 ${x.id.slice(-4)}
        高<input data-id="${x.id}" data-wk="height" type="number" step="0.1" value="${x.height}" style="width:50px">
        厚<input data-id="${x.id}" data-wk="thickness" type="number" step="0.1" value="${x.thickness}" style="width:50px">
        <button data-del-w="${x.id}">删</button>
      </div>`).join('');
    container.innerHTML = `<h4>楼</h4>${b}<h4>围墙</h4>${w}`;

    container.querySelectorAll('input[data-k]').forEach((el) => {
      el.oninput = () => {
        const t = state.buildings.find((z) => z.id === el.dataset.id);
        t[el.dataset.k] = +el.value;
        onChange();
      };
    });
    container.querySelectorAll('input[data-wk]').forEach((el) => {
      el.oninput = () => {
        const t = state.walls.find((z) => z.id === el.dataset.id);
        t[el.dataset.wk] = +el.value;
        onChange();
      };
    });
    container.querySelectorAll('button[data-del-b]').forEach((el) => {
      el.onclick = () => {
        state.buildings = state.buildings.filter((z) => z.id !== el.dataset.delB);
        onChange(); render();
      };
    });
    container.querySelectorAll('button[data-del-w]').forEach((el) => {
      el.onclick = () => {
        state.walls = state.walls.filter((z) => z.id !== el.dataset.delW);
        onChange(); render();
      };
    });
  }
  render();
  return { render };
}
```

- [ ] **Step 2: 在 scene.js 接线**

```js
import { initLists } from './lists.js';

const lists = initLists({
  container: document.getElementById('lists'),
  state,
  onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); },
});
```

并在 editor 的 onChange（画完新楼/墙后）里调用 `lists.render()` 让列表刷新。

- [ ] **Step 3: 浏览器验证**

Run: 刷新页面，画几栋楼与墙。
Expected: 右侧列表出现条目；改层高/层数/墙高即时反映到 3D 与采光；删除生效。

- [ ] **Step 4: Commit**

```bash
git add lists.js scene.js
git commit -m "feat: building and wall lists with edit and delete"
```

---

## Self-Review

**Spec coverage:**
- 精确太阳几何（赤纬/均时差/太阳时/高度角/方位角/方向向量）→ Task 1–2 ✓
- 无构建 + vendored Three.js + 基础场景 → Task 3 ✓
- 多边形楼底 + 分层层高（C 档：默认层高 + overrides）→ Task 4 ✓
- 围墙（折线 + 高 + 厚）→ Task 5 ✓
- 2D 俯视编辑器（画楼 + 画墙）→ Task 6 ✓
- 控件（纬度/经度/时区/日期/时间 + 节气快捷）→ Task 7 ✓
- 阴影动画（播放/暂停）→ Task 8 ✓
- 逐层晒到/遮挡高亮（含围墙、夜间全遮挡）→ Task 9 ✓
- 楼/墙列表编辑删除 → Task 10 ✓

**Placeholder scan:** 无 TBD/TODO。Task 8 的 `onFloorsDirty` 占位在同任务内给出真实占位实现，Task 9 用 `setOnFloorsDirty` 正式接线，链路完整。

**Type consistency:** `state`（buildings/walls/lat/lon/tzMeridian/dayOfYear/time/playing）贯穿一致；`floorHeights`/`buildFloorMeshes`/`wallSegments`/`buildWallMeshes`/`sunPosition`/`updateSun`/`rebuildWorld`/`refreshDaylight` 名称在定义与调用处一致；mesh `userData.kind` 用 `'floor'`/`'wall'` 一致。

**已知限制（与 spec 一致）:** 单点简化采光判定（非窗级/非时段累计）；自相交多边形不校验；顶点级编辑 YAGNI。
