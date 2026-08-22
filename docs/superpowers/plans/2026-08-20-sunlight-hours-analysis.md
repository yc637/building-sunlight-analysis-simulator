# 日照时数分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对每栋楼各层立面铺网格采样点，累计真太阳时 8:00–16:00 日照时数，按国标判定达标，以 3D 热力图 + 侧栏报告表呈现。

**Architecture:** 新增纯函数模块 `sunlight.js`（立面采样、太阳时步、时数累计、报告），核心循环把遮挡判定抽成注入的 `isLit(pos,dir)→bool` 便于单测；`solar.js` 加真太阳时太阳方向；`scene.js` 接线按钮、3D 热力图、报告表，几何编辑即失效清空。

**Tech Stack:** 原生 JS（ES module）、three.js（Raycaster）、Canvas；测试 `node --test`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-20-sunlight-hours-analysis-design.md`

## Global Constraints

- 无新增 npm 依赖；构建用 `./build.sh`（esbuild 打包 `scene.js` → `bundle.js`）。
- 测试 `node --test`（`npm test`），测试文件仓库根目录，`*.test.js`。
- 世界坐标：北=−Z，东=+X，y 上；单位米。
- 太阳方向向量公式与 `sunPosition` 一致：`x=-cos(alt)sin(az)`, `y=sin(alt)`, `z=cos(alt)cos(az)`（方位从正南、向西为正）。
- 大寒日 dayOfYear=20 阈值 T=2；冬至日 dayOfYear=355 阈值 T=1。
- commit 以 `feat:`/`fix:` 开头，末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

### Task 1: solar.js 加 sunDirAtSolarTime

**Files:**
- Modify: `solar.js`（末尾追加导出函数）
- Modify: `solar.test.js`（追加测试）

**Interfaces:**
- Consumes: `solar.js` 现有 `solarDeclination(dayOfYear)`、`hourAngle(solarTimeHours)`、`altitudeAzimuth(latDeg, declDeg, hourAngleDeg)`、`deg2rad`。
- Produces: `sunDirAtSolarTime(latDeg, dayOfYear, solarHour)` → `{ dir:{x,y,z}, altitude, azimuth }`（altitude/azimuth 度）。

- [ ] **Step 1: 写失败测试**

在 `solar.test.js` 末尾追加（文件已 `import ... from './solar.js'`；把 `sunDirAtSolarTime` 加进该 import 或新增一行 import）：

```js
import { sunDirAtSolarTime } from './solar.js';

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test solar.test.js`
Expected: FAIL — `sunDirAtSolarTime is not a function` / import 报错。

- [ ] **Step 3: 实现**

在 `solar.js` 末尾追加：

```js
// 真太阳时 solarHour 的太阳方向（世界向量，北=−Z 东=+X y上）+ 高度/方位角。
// 绕过时钟/经度修正/均时差，供日照分析按真太阳时窗口采样。
export function sunDirAtSolarTime(latDeg, dayOfYear, solarHour) {
  const decl = solarDeclination(dayOfYear);
  const H = hourAngle(solarHour);
  const { altitude, azimuth } = altitudeAzimuth(latDeg, decl, H);
  const altR = deg2rad(altitude), azR = deg2rad(azimuth);
  const dir = {
    x: -Math.cos(altR) * Math.sin(azR),
    y: Math.sin(altR),
    z: Math.cos(altR) * Math.cos(azR),
  };
  return { dir, altitude, azimuth };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test solar.test.js`
Expected: PASS（新增 3 项 + 原有全过）。

- [ ] **Step 5: Commit**

```bash
git add solar.js solar.test.js
git commit -m "feat: sunDirAtSolarTime for true-solar-time sun direction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: sunlight.js 纯函数（采样/时步/累计/报告）

**Files:**
- Create: `sunlight.js`
- Create: `sunlight.test.js`

**Interfaces:**
- Consumes: `geometry.js` 的 `floorHeights(building)` → number[]（每层高度）；`viewport.js` 的 `rotateFootprint(points, deg)` → [[x,z],...]；Task 1 的 `sunDirAtSolarTime`（Task 3 用，本任务不用）。
- Produces:
  - `facadeSamplePoints(building, opts={spacing:3, offset:0.3})` → `[{ pos:[x,y,z], buildingId, floor, edgeIndex }]`
  - `solarTimeSteps(startH, endH, stepMin)` → `number[]`
  - `accumulateHours(points, sunDirs, isLit, stepMin)` → `[{...point, hours}]`
  - `buildReport(pointsWithHours, threshold, nameById)` → `[{ buildingId, name, floors:[{floor, hours, pass}] }]`

- [ ] **Step 1: 写失败测试**

创建 `sunlight.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert';
import { facadeSamplePoints, solarTimeSteps, accumulateHours, buildReport } from './sunlight.js';

// 10×10 正方形单层楼，层高3
const sqBuilding = {
  id: 'b1', name: '1号',
  footprint: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
  floorHeight: 3, floorCount: 1, overrides: {},
};

test('facadeSamplePoints: 单层每边3点共12点，y=层中高1.5', () => {
  const pts = facadeSamplePoints(sqBuilding);
  assert.strictEqual(pts.length, 12);  // 每边 floor(10/3)=3
  pts.forEach((p) => assert.ok(Math.abs(p.pos[1] - 1.5) < 1e-9, `y ${p.pos[1]}`));
  pts.forEach((p) => assert.strictEqual(p.floor, 0));
});

test('facadeSamplePoints: 点在墙外（离质心>5，含偏移）', () => {
  const pts = facadeSamplePoints(sqBuilding);
  pts.forEach((p) => {
    const d = Math.hypot(p.pos[0], p.pos[2]); // 质心在原点
    assert.ok(d > 5, `dist ${d}`);            // 边中点到质心5，偏移后>5
  });
});

test('facadeSamplePoints: 两层点数×2，第二层 y=4.5', () => {
  const b = { ...sqBuilding, floorCount: 2 };
  const pts = facadeSamplePoints(b);
  assert.strictEqual(pts.length, 24);
  assert.ok(pts.some((p) => Math.abs(p.pos[1] - 4.5) < 1e-9));
});

test('solarTimeSteps(8,16,5): 长度97，首8末16，步5/60', () => {
  const s = solarTimeSteps(8, 16, 5);
  assert.strictEqual(s.length, 97);
  assert.strictEqual(s[0], 8);
  assert.ok(Math.abs(s[s.length - 1] - 16) < 1e-9);
  assert.ok(Math.abs((s[1] - s[0]) - 5 / 60) < 1e-9);
});

test('accumulateHours: 全亮→满窗口时数', () => {
  const pts = [{ pos: [0, 0, 0], buildingId: 'b1', floor: 0, edgeIndex: 0 }];
  const dirs = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  const out = accumulateHours(pts, dirs, () => true, 5);
  assert.ok(Math.abs(out[0].hours - 3 * 5 / 60) < 1e-9, `h ${out[0].hours}`);
});

test('accumulateHours: 全暗→0；半数亮→半时数', () => {
  const pts = [{ pos: [0, 0, 0], buildingId: 'b1', floor: 0, edgeIndex: 0 }];
  const dirs = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  assert.strictEqual(accumulateHours(pts, dirs, () => false, 5)[0].hours, 0);
  let i = 0;
  const half = accumulateHours(pts, dirs, () => (i++ % 2 === 0), 5);
  assert.ok(Math.abs(half[0].hours - 2 * 5 / 60) < 1e-9, `h ${half[0].hours}`);
});

test('buildReport: 层 hours 取点最大值，pass 按阈值', () => {
  const pts = [
    { buildingId: 'b1', floor: 0, hours: 1.0 },
    { buildingId: 'b1', floor: 0, hours: 2.3 },
    { buildingId: 'b1', floor: 1, hours: 0.5 },
  ];
  const rep = buildReport(pts, 2, { b1: '1号' });
  assert.strictEqual(rep.length, 1);
  assert.strictEqual(rep[0].name, '1号');
  assert.deepStrictEqual(rep[0].floors[0], { floor: 0, hours: 2.3, pass: true });
  assert.deepStrictEqual(rep[0].floors[1], { floor: 1, hours: 0.5, pass: false });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test sunlight.test.js`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

创建 `sunlight.js`：

```js
import { floorHeights } from './geometry.js';
import { rotateFootprint } from './viewport.js';

// 每栋楼各层外墙铺网格采样点（窗位代理）。
// 返回 [{ pos:[x,y,z], buildingId, floor, edgeIndex }]。
export function facadeSamplePoints(building, { spacing = 3, offset = 0.3 } = {}) {
  const rot = rotateFootprint(building.footprint, building.rotation || 0); // [[x,z],...]
  const cx = rot.reduce((a, p) => a + p[0], 0) / rot.length;
  const cz = rot.reduce((a, p) => a + p[1], 0) / rot.length;
  const heights = floorHeights(building);
  const out = [];
  let base = 0;
  for (let i = 0; i < heights.length; i++) {
    const y = base + heights[i] / 2;
    for (let j = 0; j < rot.length; j++) {
      const a = rot[j], b = rot[(j + 1) % rot.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      if (L === 0) continue;
      const n = Math.max(1, Math.floor(L / spacing));
      // 外法向：(dz,-dx) 归一，若指向质心则取反
      let nx = dz / L, nz = -dx / L;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = a[0] + dx * t + nx * offset;
        const pz = a[1] + dz * t + nz * offset;
        out.push({ pos: [px, y, pz], buildingId: building.id, floor: i, edgeIndex: j });
      }
    }
    base += heights[i];
  }
  return out;
}

// 真太阳时步序列（含端点）。整数步计数避免浮点漂移。
export function solarTimeSteps(startH, endH, stepMin) {
  const n = Math.round((endH - startH) * 60 / stepMin);
  const out = [];
  for (let k = 0; k <= n; k++) out.push(startH + k * stepMin / 60);
  return out;
}

// 核心累计：isLit(pos,dir)→bool 注入，便于单测。sunDirs 已过滤 altitude>0。
export function accumulateHours(points, sunDirs, isLit, stepMin) {
  const inc = stepMin / 60;
  return points.map((p) => {
    let hours = 0;
    for (const dir of sunDirs) if (isLit(p.pos, dir)) hours += inc;
    return { ...p, hours };
  });
}

// 报告：按楼分组→按层分组，层 hours 取点最大，pass=hours>=threshold。
export function buildReport(pointsWithHours, threshold, nameById) {
  const order = [];
  const byB = new Map();
  for (const p of pointsWithHours) {
    if (!byB.has(p.buildingId)) { byB.set(p.buildingId, new Map()); order.push(p.buildingId); }
    const byF = byB.get(p.buildingId);
    byF.set(p.floor, Math.max(byF.get(p.floor) ?? -Infinity, p.hours));
  }
  return order.map((bid) => {
    const byF = byB.get(bid);
    const floors = [...byF.keys()].sort((a, b) => a - b).map((floor) => {
      const hours = byF.get(floor);
      return { floor, hours, pass: hours >= threshold };
    });
    return { buildingId: bid, name: nameById[bid], floors };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test sunlight.test.js`
Expected: PASS（7 项）。

- [ ] **Step 5: Commit**

```bash
git add sunlight.js sunlight.test.js
git commit -m "feat: sunlight analysis pure functions (facade sampling, hours, report)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: analyzeSunlight 接线 raycast + 全量测试

**Files:**
- Modify: `sunlight.js`（追加 `analyzeSunlight`）
- Modify: `sunlight.test.js`（追加 analyzeSunlight 用注入 THREE 桩的测试）

**Interfaces:**
- Consumes: Task 1 `sunDirAtSolarTime`；Task 2 `facadeSamplePoints`、`solarTimeSteps`、`accumulateHours`、`buildReport`。
- Produces: `analyzeSunlight({ buildings, occluderMeshes, THREE, latDeg, dayOfYear, threshold, startH, endH, stepMin, spacing, offset })` → `{ points:[{...,hours}], report, threshold }`。

- [ ] **Step 1: 写失败测试**

在 `sunlight.test.js` 末尾追加（用最小 THREE 桩：Raycaster 恒不命中 → 全亮；恒命中 → 全暗）：

```js
import { analyzeSunlight } from './sunlight.js';

function fakeTHREE(hit) {
  return {
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
      normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } },
    Raycaster: class { set() {} intersectObjects() { return hit ? [{}] : []; } },
  };
}

test('analyzeSunlight: 无遮挡→各层达标（大寒 T=2）', () => {
  const b = { id: 'b1', name: '1号', footprint: [[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight: 3, floorCount: 2, overrides: {} };
  const r = analyzeSunlight({
    buildings: [b], occluderMeshes: [], THREE: fakeTHREE(false),
    latDeg: 40, dayOfYear: 20, threshold: 2, startH: 8, endH: 16, stepMin: 5,
  });
  assert.ok(r.points.length > 0);
  assert.ok(r.report[0].floors.every((f) => f.pass), '无遮挡应全达标');
  assert.strictEqual(r.threshold, 2);
});

test('analyzeSunlight: 全遮挡→时数0全部不达标', () => {
  const b = { id: 'b1', name: '1号', footprint: [[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight: 3, floorCount: 1, overrides: {} };
  const r = analyzeSunlight({
    buildings: [b], occluderMeshes: [{}], THREE: fakeTHREE(true),
    latDeg: 40, dayOfYear: 20, threshold: 2,
  });
  assert.ok(r.points.every((p) => p.hours === 0));
  assert.ok(r.report[0].floors.every((f) => !f.pass));
});

test('analyzeSunlight: name 兜底用 id 尾4位+号', () => {
  const b = { id: 'b1234', footprint: [[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight: 3, floorCount: 1, overrides: {} };
  const r = analyzeSunlight({ buildings: [b], occluderMeshes: [], THREE: fakeTHREE(false), latDeg: 40, dayOfYear: 20, threshold: 2 });
  assert.strictEqual(r.report[0].name, '1234号');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test sunlight.test.js`
Expected: FAIL — `analyzeSunlight is not a function`。

- [ ] **Step 3: 实现**

在 `sunlight.js` 顶部 import 后加：

```js
import { sunDirAtSolarTime } from './solar.js';
```

在文件末尾追加：

```js
// 接线器：raycast 作 isLit，跑完整分析。occluderMeshes 由调用方（scene）传入。
export function analyzeSunlight({
  buildings, occluderMeshes, THREE,
  latDeg, dayOfYear, threshold,
  startH = 8, endH = 16, stepMin = 5, spacing = 3, offset = 0.3,
}) {
  const points = buildings.flatMap((b) => facadeSamplePoints(b, { spacing, offset }));
  const steps = solarTimeSteps(startH, endH, stepMin);
  const sunDirs = steps
    .map((st) => sunDirAtSolarTime(latDeg, dayOfYear, st))
    .filter((s) => s.altitude > 0)
    .map((s) => s.dir);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const isLit = (pos, dir) => {
    origin.set(pos[0], pos[1], pos[2]);
    rayDir.set(dir.x, dir.y, dir.z).normalize();
    raycaster.set(origin, rayDir);
    return raycaster.intersectObjects(occluderMeshes, true).length === 0;
  };
  const withHours = accumulateHours(points, sunDirs, isLit, stepMin);
  const nameById = Object.fromEntries(
    buildings.map((b) => [b.id, b.name || (String(b.id).slice(-4) + '号')])
  );
  const report = buildReport(withHours, threshold, nameById);
  return { points: withHours, report, threshold };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test sunlight.test.js`
Expected: PASS（10 项）。

- [ ] **Step 5: Commit**

```bash
git add sunlight.js sunlight.test.js
git commit -m "feat: analyzeSunlight wires raycaster as isLit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 面板 UI + scene 接线（热力图 + 报告 + 失效清空）

**Files:**
- Modify: `index.html`（面板加「日照分析」section）
- Modify: `scene.js`（import、analysisGroup、按钮、热力图、报告渲染、clearAnalysis 挂 onChange）
- Modify: `bundle.js`（重新打包）

**Interfaces:**
- Consumes: Task 3 `analyzeSunlight`；`scene.js` 现有 `state`、`worldGroup`、`scene`、`THREE`、`alertModal`、编辑器 `onChange` 链。
- Produces: 无（终端功能）。

- [ ] **Step 1: index.html 加分析区**

在 `<div id="lists"></div>` 所在 section 之后（`</div>` 关闭 panel 之前）插入：

```html
        <section>
          <div class="sec-title">日照分析</div>
          <div class="row" style="gap:10px">
            <label style="flex:0 0 auto"><input type="radio" name="sun-std" value="dahan" checked> 大寒日≥2h</label>
            <label style="flex:0 0 auto"><input type="radio" name="sun-std" value="dongzhi"> 冬至日≥1h</label>
          </div>
          <div class="row"><button id="run-sunlight" class="primary" style="width:100%">日照分析</button></div>
          <div id="sun-report" style="margin-top:6px;font-size:11px"></div>
        </section>
```

- [ ] **Step 2: scene.js 加 import + analysisGroup**

`scene.js` 顶部 import 区加：

```js
import { analyzeSunlight } from './sunlight.js';
```

在 `scene.add(worldGroup);`（worldGroup 定义处）之后加：

```js
// 日照分析热力图容器
const analysisGroup = new THREE.Group();
scene.add(analysisGroup);
const _sphereGeo = new THREE.SphereGeometry(0.6, 8, 6);
function clearAnalysis() {
  while (analysisGroup.children.length) {
    const c = analysisGroup.children.pop();
    c.material?.dispose?.();
    analysisGroup.remove(c);
  }
  const rep = document.getElementById('sun-report');
  if (rep) rep.innerHTML = '';
}
// 时数→颜色：0红→T黄→1.5T绿 分段线性
function hoursColor(h, T) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  const RED = [211, 47, 47], YEL = [251, 192, 45], GRN = [67, 160, 71];
  if (h <= 0) return hex(...RED);
  if (h < T) { const t = h / T; return hex(lerp(RED[0], YEL[0], t), lerp(RED[1], YEL[1], t), lerp(RED[2], YEL[2], t)); }
  if (h < 1.5 * T) { const t = (h - T) / (0.5 * T); return hex(lerp(YEL[0], GRN[0], t), lerp(YEL[1], GRN[1], t), lerp(YEL[2], GRN[2], t)); }
  return hex(...GRN);
}
```

- [ ] **Step 3: scene.js 加热力图 + 报告渲染 + 按钮接线**

在 `scene.js` 底部（`applyLoadedState` 之后或文件末尾接线区）加：

```js
function renderAnalysis(result) {
  clearAnalysis();
  const T = result.threshold;
  for (const p of result.points) {
    const m = new THREE.Mesh(_sphereGeo, new THREE.MeshBasicMaterial({ color: hoursColor(p.hours, T) }));
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    analysisGroup.add(m);
  }
  const rep = document.getElementById('sun-report');
  let passCount = 0, total = 0;
  let html = '';
  for (const b of result.report) {
    html += `<div style="font-weight:600;margin-top:4px">${b.name}</div>`;
    html += '<table style="width:100%;border-collapse:collapse">';
    for (const f of b.floors) {
      total++; if (f.pass) passCount++;
      const color = f.pass ? '#2e7d32' : '#c62828';
      html += `<tr style="color:${color}"><td>第${f.floor + 1}层</td><td style="text-align:right">${f.hours.toFixed(1)}h</td><td style="text-align:right">${f.pass ? '✓' : '✗'}</td></tr>`;
    }
    html += '</table>';
  }
  rep.innerHTML = `<div style="margin-bottom:4px;color:#555">达标 ${passCount}/${total} 层</div>` + html;
}

document.getElementById('run-sunlight').onclick = async () => {
  if (!state.buildings.length) { alertModal({ message: '请先画楼' }); return; }
  const std = document.querySelector('input[name="sun-std"]:checked').value;
  const dayOfYear = std === 'dongzhi' ? 355 : 20;
  const threshold = std === 'dongzhi' ? 1 : 2;
  const btn = document.getElementById('run-sunlight');
  btn.disabled = true; btn.textContent = '计算中…';
  await new Promise((r) => setTimeout(r, 20)); // 让 UI 刷新
  const occluderMeshes = worldGroup.children.filter(
    (m) => m.userData?.kind === 'floor' || m.userData?.kind === 'wall'
  );
  const result = analyzeSunlight({
    buildings: state.buildings, occluderMeshes, THREE,
    latDeg: state.lat, dayOfYear, threshold,
  });
  renderAnalysis(result);
  btn.disabled = false; btn.textContent = '日照分析';
};
```

- [ ] **Step 4: scene.js 几何编辑失效清空**

找到编辑器 `onChange` 定义（`initEditor2d({ ... onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); lists.render(); } })`）与列表 `initLists` 的 onChange。在这两处 onChange 体末尾加 `clearAnalysis();`。示例（editor2d 的 onChange）：

```js
const editor = initEditor2d({
  canvas: document.getElementById('plan2d'),
  state,
  onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); lists.render(); clearAnalysis(); },
  onModeChange: setActiveMode,
});
```

同样在 `initLists({ ..., onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); editor.redraw(); } })` 末尾加 `clearAnalysis();`。

（注意：`clearAnalysis` 需在这些 onChange 定义之前声明——Step 2 已把它放在 worldGroup 之后、编辑器初始化之前；若顺序不符，把 `clearAnalysis` 及其依赖上移到编辑器初始化之前。）

- [ ] **Step 5: 打包 + 全量测试**

Run: `./build.sh && npm test`
Expected: 打包成功；`solar.test.js` + `sunlight.test.js` + 现有全过，无 fail。

- [ ] **Step 6: 手动验证（浏览器）**

serve 后打开 `index.html`：
1. 画 2-3 栋楼（不同高度、间距近）
2. 面板选「大寒日≥2h」，点「日照分析」
3. 楼立面出现彩色小球（低层被邻楼挡→偏红，高层→偏绿）
4. 报告表列出每栋每层时数 + ✓/✗，不达标标红
5. 切「冬至日≥1h」重算，阈值变、颜色/达标随之变
6. 移动/删除一栋楼 → 热力图与报告清空

- [ ] **Step 7: Commit**

```bash
git add index.html scene.js bundle.js
git commit -m "feat: sunlight analysis UI (heatmap + compliance report)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** sunDirAtSolarTime（T1）✓；facadeSamplePoints/solarTimeSteps/accumulateHours/buildReport（T2）✓；analyzeSunlight 接 raycast（T3）✓；3D 热力图着色（T4 hoursColor/renderAnalysis）✓；报告表 + 汇总（T4）✓；标准单选大寒/冬至（T4）✓；无楼提示（T4）✓；几何编辑失效清空（T4 Step4）✓；真太阳时 8-16 步5分（T3 默认 + accumulateHours）✓；遮挡体排除 label/floor-line/地面（T4 filter kind floor|wall）✓。
- **Placeholder scan:** 无 TBD/TODO；各步含完整代码。
- **Type consistency:** `facadeSamplePoints` 产 `{pos,buildingId,floor,edgeIndex}`；`accumulateHours` 加 `hours`；`buildReport` 读 `buildingId/floor/hours`；`analyzeSunlight` 返回 `{points,report,threshold}`；scene `renderAnalysis` 读 `points[].pos/hours`、`report[].name/floors[].{floor,hours,pass}`、`threshold`——全一致。`floorHeights` 已由 geometry.js 导出（无需改动，spec 清单里"已导出"）。
