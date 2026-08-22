# 立面选择 + 整面连片渐变热力图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日照热力图默认只分析每栋楼最朝南立面（可 3D 点面增减），并从点云小球改为整面 canvas 贴图的连片渐变热力图。

**Architecture:** sunlight.js 加 `southFaceIndex`/`nearestEdge`/`facadeGrid` 纯函数，`analyzeSunlight` 改按选中面密网格采样返回 `faces`；scene.js 加 selectionGroup 高亮 + 3D 单击 raycast 选面 + 整面贴图渲染。选中面存 `building.selectedFaces`，缺失时惰性默认南面。

**Tech Stack:** 原生 JS（ES module）、three.js（Raycaster、CanvasTexture、PlaneGeometry）、Canvas；测试 `node --test`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-20-facade-selection-continuous-heatmap-design.md`

## Global Constraints

- 无新增 npm 依赖；构建 `./build.sh`（esbuild → bundle.js）。测试 `node --test`（`npm test`），`*.test.js` 在仓库根。
- 世界坐标：北=−Z，南=+Z，东=+X，西=−X，y 上；单位米。
- 外法向判据（同现有 facadeSamplePoints）：边 (dx,dz) → `(dz,-dx)/L`，若指向质心取反。
- hoursColor 分段：h≤0 红#d32f2f，h=T 黄#fbc02d，h≥1.5T 绿#43a047，段内线性。
- 大寒 dayOfYear=20 阈值 T=2；冬至 dayOfYear=355 阈值 T=1。
- 选中面存 `building.selectedFaces:number[]`（边索引）；读取处缺失用 `b.selectedFaces ?? [southFaceIndex(b)]`，不静默改数据。
- commit 以 `feat:`/`fix:` 开头，末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

### Task 1: sunlight.js 加 southFaceIndex / nearestEdge / facadeGrid

**Files:**
- Modify: `sunlight.js`（追加 3 个导出函数；顶部 import 加 `pointSegDist`）
- Modify: `sunlight.test.js`（追加测试）

**Interfaces:**
- Consumes: `viewport.js` 的 `rotateFootprint`（已 import）、`pointSegDist`（新 import）；`geometry.js` 的 `floorHeights`（已 import）。
- Produces:
  - `southFaceIndex(building)` → number（边索引）
  - `nearestEdge(footprintRot, x, z)` → number（边索引）
  - `facadeGrid(building, edgeIndex, {step=1.5, offset=0.3})` → `{ nodes:[{pos:[x,y,z], buildingId, floor, iu, iv, edgeIndex}], nu, nv, L, Htotal, edge:{ax,az,bx,bz,nx,nz} }`

- [ ] **Step 1: 写失败测试**

在 `sunlight.test.js` 顶部 import 区加：
```js
import { southFaceIndex, nearestEdge, facadeGrid } from './sunlight.js';
```
末尾追加：
```js
// 未旋转正方形：footprint 顺序 [[-5,-5],[5,-5],[5,5],[-5,5]]
// 边: 0:(-5,-5)->(5,-5) 北(z=-5), 1:(5,-5)->(5,5) 东, 2:(5,5)->(-5,5) 南(z=+5), 3:(-5,5)->(-5,-5) 西
const sq = { id:'b1', footprint:[[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight:3, floorCount:1, overrides:{} };

test('southFaceIndex: 正方形返回南边(外法向+Z)索引2', () => {
  assert.strictEqual(southFaceIndex(sq), 2);
});

test('southFaceIndex: 旋转90°后南边索引改变且外法向仍朝南', () => {
  const b = { ...sq, rotation: 90 };
  const idx = southFaceIndex(b);
  // 校验该边外法向 .z 最大：手工重算
  const rot = (deg => { const r = deg*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
    return sq.footprint.map(([x,z]) => [x*c - z*s, x*s + z*c]); })(90);
  const cx = rot.reduce((a,p)=>a+p[0],0)/4, cz = rot.reduce((a,p)=>a+p[1],0)/4;
  let best=-1, bestZ=-Infinity;
  for (let j=0;j<4;j++){ const a=rot[j], b2=rot[(j+1)%4]; const dx=b2[0]-a[0], dz=b2[1]-a[1]; const L=Math.hypot(dx,dz);
    let nz=-dx/L; let nx=dz/L; const mx=(a[0]+b2[0])/2, mz=(a[1]+b2[1])/2;
    if (nx*(mx-cx)+nz*(mz-cz)<0){ nz=-nz; } if (nz>bestZ){ bestZ=nz; best=j; } }
  assert.strictEqual(idx, best);
});

test('nearestEdge: 南外侧点(0,6)→边2；东外侧点(6,0)→边1', () => {
  const rot = sq.footprint; // 未旋转
  assert.strictEqual(nearestEdge(rot, 0, 6), 2);
  assert.strictEqual(nearestEdge(rot, 6, 0), 1);
});

test('facadeGrid: 单层 Htotal=3 step1.5 → nu8 nv3，节点48，floor全0，朝外偏移', () => {
  const g = facadeGrid(sq, 2, { step:1.5, offset:0.3 }); // 南边，长10
  assert.strictEqual(g.nu, 8);   // ceil(10/1.5)+1=8
  assert.strictEqual(g.nv, 3);   // ceil(3/1.5)+1=3
  assert.strictEqual(g.nodes.length, 24); // 8*3
  assert.ok(g.nodes.every(n => n.floor === 0));
  // 南边外法向 +Z：节点 z 应 > 5（墙外）
  assert.ok(g.nodes.every(n => n.pos[2] > 5));
  // y 范围 0..3
  assert.ok(g.nodes.every(n => n.pos[1] >= 0 && n.pos[1] <= 3 + 1e-9));
});

test('facadeGrid: 两层 Htotal=6 → nv5，顶排floor1 底排floor0', () => {
  const b = { ...sq, floorCount: 2 };
  const g = facadeGrid(b, 2, { step:1.5, offset:0.3 });
  assert.strictEqual(g.nv, 5); // ceil(6/1.5)+1=5
  const top = g.nodes.filter(n => Math.abs(n.pos[1] - 6) < 1e-9);
  const bot = g.nodes.filter(n => Math.abs(n.pos[1] - 0) < 1e-9);
  assert.ok(top.length > 0 && top.every(n => n.floor === 1));
  assert.ok(bot.length > 0 && bot.every(n => n.floor === 0));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test sunlight.test.js`
Expected: FAIL — `southFaceIndex is not a function` 等。

- [ ] **Step 3: 实现**

`sunlight.js` 第 2 行 import 改为同时引入 `pointSegDist`：
```js
import { rotateFootprint, pointSegDist } from './viewport.js';
```
在 `facadeSamplePoints` 之前（或 solarTimeSteps 之后任一处）追加：
```js
// 旋转后各边外法向（(dz,-dx)/L，指向质心则取反）。返回 {nx,nz}。
function outwardNormal(a, b, cx, cz) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  let nx = dz / L, nz = -dx / L;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
  return { nx, nz };
}

// 最朝南（外法向 .z 最大）的边索引。
export function southFaceIndex(building) {
  const rot = rotateFootprint(building.footprint, building.rotation || 0);
  const cx = rot.reduce((a, p) => a + p[0], 0) / rot.length;
  const cz = rot.reduce((a, p) => a + p[1], 0) / rot.length;
  let best = 0, bestZ = -Infinity;
  for (let j = 0; j < rot.length; j++) {
    const { nz } = outwardNormal(rot[j], rot[(j + 1) % rot.length], cx, cz);
    if (nz > bestZ) { bestZ = nz; best = j; }
  }
  return best;
}

// 点(x,z)到轮廓各边距离最小的边索引（3D 拾取用）。
export function nearestEdge(footprintRot, x, z) {
  let best = 0, bestD = Infinity;
  for (let j = 0; j < footprintRot.length; j++) {
    const a = footprintRot[j], b = footprintRot[(j + 1) % footprintRot.length];
    const d = pointSegDist(x, z, a[0], a[1], b[0], b[1]);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

// 一个立面（边 edgeIndex，跨全楼高）铺密集网格。
export function facadeGrid(building, edgeIndex, { step = 1.5, offset = 0.3 } = {}) {
  const rot = rotateFootprint(building.footprint, building.rotation || 0);
  const cx = rot.reduce((a, p) => a + p[0], 0) / rot.length;
  const cz = rot.reduce((a, p) => a + p[1], 0) / rot.length;
  const heights = floorHeights(building);
  const Htotal = heights.reduce((a, b) => a + b, 0);
  // 累计层底高度，供 floor 落层
  const bases = []; let acc = 0;
  for (let i = 0; i < heights.length; i++) { bases.push(acc); acc += heights[i]; }
  const floorAt = (v) => {
    for (let i = heights.length - 1; i >= 0; i--) if (v >= bases[i] - 1e-9) return i;
    return 0;
  };
  const a = rot[edgeIndex], b = rot[(edgeIndex + 1) % rot.length];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const { nx, nz } = outwardNormal(a, b, cx, cz);
  const nu = Math.max(2, Math.ceil(L / step) + 1);
  const nv = Math.max(2, Math.ceil(Htotal / step) + 1);
  const nodes = [];
  for (let iv = 0; iv < nv; iv++) {
    const v = (iv / (nv - 1)) * Htotal;
    for (let iu = 0; iu < nu; iu++) {
      const t = iu / (nu - 1);
      const px = a[0] + dx * t + nx * offset;
      const pz = a[1] + dz * t + nz * offset;
      nodes.push({ pos: [px, v, pz], buildingId: building.id, floor: floorAt(v), iu, iv, edgeIndex });
    }
  }
  return { nodes, nu, nv, L, Htotal, edge: { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx, nz } };
}
```
（注：`facadeSamplePoints` 内部的外法向内联逻辑保持不变，不要求改用 `outwardNormal`——避免动它的现有测试。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test sunlight.test.js`
Expected: PASS（原 10 项 + 新 5 项 = 15）。

- [ ] **Step 5: Commit**

```bash
git add sunlight.js sunlight.test.js
git commit -m "feat: southFaceIndex, nearestEdge, facadeGrid for facade selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: analyzeSunlight 改按选中面网格采样

**Files:**
- Modify: `sunlight.js`（重写 `analyzeSunlight`）
- Modify: `sunlight.test.js`（改 analyzeSunlight 相关测试为 faces 断言）

**Interfaces:**
- Consumes: Task 1 `southFaceIndex`、`facadeGrid`；现有 `solarTimeSteps`、`accumulateHours`、`buildReport`、`sunDirAtSolarTime`。
- Produces: `analyzeSunlight({ buildings, occluderMeshes, THREE, latDeg, dayOfYear, threshold, startH=8, endH=16, stepMin=5, step=1.5, offset=0.3 })` → `{ faces:[{ buildingId, edgeIndex, nu, nv, L, Htotal, edge, nodes:[{...,hours}] }], report, threshold }`。

- [ ] **Step 1: 改测试**

`sunlight.test.js` 里现有 3 个 `analyzeSunlight` 测试（"无遮挡→各层达标"、"全遮挡→0"、"name 兜底"）改为按 faces 断言。替换为：
```js
test('analyzeSunlight: 默认南面(selectedFaces未设)→faces长度1，无遮挡各层达标', () => {
  const b = { id:'b1', name:'1号', footprint:[[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight:3, floorCount:2, overrides:{} };
  const r = analyzeSunlight({ buildings:[b], occluderMeshes:[], THREE: fakeTHREE(false),
    latDeg:40, dayOfYear:20, threshold:2 });
  assert.strictEqual(r.faces.length, 1);
  assert.strictEqual(r.faces[0].edgeIndex, 2); // 南边
  assert.ok(r.faces[0].nodes.length > 0);
  assert.ok(r.faces[0].nodes.every(n => typeof n.hours === 'number'));
  assert.ok(r.report[0].floors.every(f => f.pass));
  assert.strictEqual(r.threshold, 2);
});

test('analyzeSunlight: 全遮挡→节点hours0全不达标', () => {
  const b = { id:'b1', name:'1号', footprint:[[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight:3, floorCount:1, overrides:{} };
  const r = analyzeSunlight({ buildings:[b], occluderMeshes:[{}], THREE: fakeTHREE(true),
    latDeg:40, dayOfYear:20, threshold:2 });
  assert.ok(r.faces[0].nodes.every(n => n.hours === 0));
  assert.ok(r.report[0].floors.every(f => !f.pass));
});

test('analyzeSunlight: selectedFaces=[] → faces空、report空', () => {
  const b = { id:'b1', name:'1号', footprint:[[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight:3, floorCount:1, overrides:{}, selectedFaces:[] };
  const r = analyzeSunlight({ buildings:[b], occluderMeshes:[], THREE: fakeTHREE(false),
    latDeg:40, dayOfYear:20, threshold:2 });
  assert.strictEqual(r.faces.length, 0);
  assert.strictEqual(r.report.length, 0);
});

test('analyzeSunlight: 多选面 selectedFaces=[1,2] → faces长度2', () => {
  const b = { id:'b1', name:'1号', footprint:[[-5,-5],[5,-5],[5,5],[-5,5]], floorHeight:3, floorCount:1, overrides:{}, selectedFaces:[1,2] };
  const r = analyzeSunlight({ buildings:[b], occluderMeshes:[], THREE: fakeTHREE(false),
    latDeg:40, dayOfYear:20, threshold:2 });
  assert.strictEqual(r.faces.length, 2);
});
```
（`fakeTHREE` 桩已存在于文件中，沿用。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test sunlight.test.js`
Expected: FAIL — 现有 analyzeSunlight 返回 `{points,...}` 无 `faces`，新断言失败。

- [ ] **Step 3: 重写 analyzeSunlight**

替换 `sunlight.js` 里整个 `analyzeSunlight` 函数为：
```js
// 接线器：按每栋楼选中面（默认南面）铺密网格，raycast 作 isLit。返回 faces + report。
export function analyzeSunlight({
  buildings, occluderMeshes, THREE,
  latDeg, dayOfYear, threshold,
  startH = 8, endH = 16, stepMin = 5, step = 1.5, offset = 0.3,
}) {
  // 每楼选中面 → facadeGrid → face 对象
  const faces = [];
  for (const b of buildings) {
    const sel = b.selectedFaces ?? [southFaceIndex(b)];
    for (const edgeIndex of sel) {
      const g = facadeGrid(b, edgeIndex, { step, offset });
      faces.push({ buildingId: b.id, edgeIndex, nu: g.nu, nv: g.nv, L: g.L, Htotal: g.Htotal, edge: g.edge, nodes: g.nodes });
    }
  }
  // 拼平节点，记录每 face 的偏移
  const allNodes = [];
  const offsets = [];
  for (const f of faces) { offsets.push(allNodes.length); for (const n of f.nodes) allNodes.push(n); }

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
  const withHours = accumulateHours(allNodes, sunDirs, isLit, stepMin);
  // 切回各 face
  faces.forEach((f, i) => { f.nodes = withHours.slice(offsets[i], offsets[i] + f.nodes.length); });

  const nameById = Object.fromEntries(
    buildings.map((b) => [b.id, b.name || (String(b.id).slice(-4) + '号')])
  );
  const report = buildReport(withHours, threshold, nameById);
  return { faces, report, threshold };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test sunlight.test.js`
Expected: PASS（southFaceIndex/nearestEdge/facadeGrid + 改写后的 analyzeSunlight + 原 facadeSamplePoints/solarTimeSteps/accumulateHours/buildReport 测试全过）。

- [ ] **Step 5: Commit**

```bash
git add sunlight.js sunlight.test.js
git commit -m "feat: analyzeSunlight samples selected facades, returns faces

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: scene.js 选面高亮 + 3D 点面 + 整面贴图渲染

**Files:**
- Modify: `scene.js`（import、selectionGroup、refreshSelection、3D pick、renderAnalysis 重写、clearAnalysis dispose map、wire refreshSelection 到 onChange）
- Modify: `index.html`（分析区加提示行）
- Modify: `bundle.js`（重新打包）

**Interfaces:**
- Consumes: Task 1 `nearestEdge`、`southFaceIndex`；Task 2 `analyzeSunlight`（返回 faces）；现有 `state`、`worldGroup`、`scene`、`camera`、`controls`、`canvas`(=renderer 画布, `const canvas = document.getElementById('view')`)、`THREE`、`hoursColor`、`alertModal`、`rotateFootprint`（从 viewport.js，需 import）。
- Produces: 无（终端功能）。

- [ ] **Step 1: index.html 提示行**

在「日照分析」section 内、radio 行之后、按钮之前插入：
```html
          <div class="row" style="color:#8a909b;font-size:11px">3D 点击楼立面可增减分析面（默认南面）</div>
```

- [ ] **Step 2: scene.js import + selectionGroup**

`scene.js` 顶部 import：`analyzeSunlight` 已从 './sunlight.js' 引入，改为：
```js
import { analyzeSunlight, southFaceIndex, nearestEdge } from './sunlight.js';
```
`viewport.js` 的 import 行加 `rotateFootprint`（若未引入）：确认当前 `import { geoPointsToWorld, serializeState, deserializeState } from './viewport.js';` → 改为
```js
import { geoPointsToWorld, serializeState, deserializeState, rotateFootprint } from './viewport.js';
```
在 `analysisGroup` 定义之后加：
```js
// 选中立面高亮容器
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);
function facadeOf(b) { return b.selectedFaces ?? [southFaceIndex(b)]; }
function refreshSelection() {
  while (selectionGroup.children.length) {
    const c = selectionGroup.children.pop();
    c.geometry?.dispose?.(); c.material?.dispose?.(); selectionGroup.remove(c);
  }
  for (const b of state.buildings) {
    const rot = rotateFootprint(b.footprint, b.rotation || 0);
    const heights = (b.overrides ? Object.assign([], Array.from({length:b.floorCount}, (_,i)=> b.overrides[i] ?? b.floorHeight)) : Array.from({length:b.floorCount}, ()=> b.floorHeight));
    const Htotal = heights.reduce((a, h) => a + h, 0);
    for (const j of facadeOf(b)) {
      const a = rot[j], c2 = rot[(j + 1) % rot.length];
      const off = 0.3;
      const dx = c2[0]-a[0], dz = c2[1]-a[1], L = Math.hypot(dx,dz)||1;
      let nx = dz/L, nz = -dx/L;
      const cx = rot.reduce((s,p)=>s+p[0],0)/rot.length, cz = rot.reduce((s,p)=>s+p[1],0)/rot.length;
      const mx=(a[0]+c2[0])/2, mz=(a[1]+c2[1])/2;
      if (nx*(mx-cx)+nz*(mz-cz)<0){ nx=-nx; nz=-nz; }
      const ax=a[0]+nx*off, az=a[1]+nz*off, bx=c2[0]+nx*off, bz=c2[1]+nz*off;
      const pts = [ax,0,az, bx,0,bz, bx,Htotal,bz, ax,Htotal,az, ax,0,az];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2b5f8a, transparent:true, opacity:0.9 }));
      line.renderOrder = 15;
      selectionGroup.add(line);
    }
  }
}
```

- [ ] **Step 3: scene.js 3D 点面选择**

在文件底部接线区（`#run-sunlight` onclick 附近）加 canvas 单击拾取：
```js
// 3D 单击立面 → toggle 该楼 selectedFaces（拖拽仍旋转视角）
let _pickDown = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) _pickDown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !_pickDown) return;
  const moved = Math.hypot(e.clientX - _pickDown.x, e.clientY - _pickDown.y);
  _pickDown = null;
  if (moved >= 4) return; // 拖拽=旋转，不拾取
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  worldGroup.updateMatrixWorld(true);
  const floors = worldGroup.children.filter((m) => m.userData?.kind === 'floor');
  const hits = rc.intersectObjects(floors, true);
  if (!hits.length) return;
  const bid = hits[0].object.userData.buildingId;
  const b = state.buildings.find((x) => x.id === bid);
  if (!b) return;
  const rot = rotateFootprint(b.footprint, b.rotation || 0);
  const p = hits[0].point;
  const edge = nearestEdge(rot, p.x, p.z);
  const sel = (b.selectedFaces ?? [southFaceIndex(b)]).slice();
  const at = sel.indexOf(edge);
  if (at >= 0) sel.splice(at, 1); else sel.push(edge);
  b.selectedFaces = sel;
  refreshSelection();
  clearAnalysis();
});
```

- [ ] **Step 4: scene.js renderAnalysis 重写为整面贴图**

替换现有 `renderAnalysis(result)`（点云小球版）为：
```js
function renderAnalysis(result) {
  clearAnalysis();
  const T = result.threshold;
  for (const face of result.faces) {
    const { nu, nv, L, Htotal, edge, nodes } = face;
    // canvas 纹理：texel(iu,iv)，iv 从下往上 → canvas 行 (nv-1-iv)
    const cv = document.createElement('canvas');
    cv.width = nu; cv.height = nv;
    const g = cv.getContext('2d');
    const img = g.createImageData(nu, nv);
    for (const n of nodes) {
      const col = hoursColor(n.hours, T);
      const row = nv - 1 - n.iv;
      const idx = (row * nu + n.iu) * 4;
      img.data[idx] = (col >> 16) & 255;
      img.data[idx + 1] = (col >> 8) & 255;
      img.data[idx + 2] = col & 255;
      img.data[idx + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const geo = new THREE.PlaneGeometry(L, Htotal);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: false });
    const mesh = new THREE.Mesh(geo, mat);
    // 定位：面中心 = 边中点(已含外偏移由 edge 的法向? edge 端点未含偏移) → 加外法向偏移
    const off = 0.3;
    const mx = (edge.ax + edge.bx) / 2 + edge.nx * off;
    const mz = (edge.az + edge.bz) / 2 + edge.nz * off;
    mesh.position.set(mx, Htotal / 2, mz);
    // 朝向：plane 默认法线 +Z、宽沿 +X、高沿 +Y。需宽沿边方向、法线=外法向。
    // 边方位角 → 绕 Y 旋转，使 plane +X 对齐边(ax,az)->(bx,bz)。
    const ex = edge.bx - edge.ax, ez = edge.bz - edge.az;
    mesh.rotation.y = -Math.atan2(ez, ex);
    // 若旋转后法线背对外侧则翻 180°（保证正面朝外，DoubleSide 其实两面都渲，纹理方向靠 iu 一致即可）
    mesh.renderOrder = 12;
    analysisGroup.add(mesh);
  }
  // 报告表（不变）
  const rep = document.getElementById('sun-report');
  let passCount = 0, total = 0, html = '';
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
  rep.innerHTML = total ? `<div style="margin-bottom:4px;color:#555">达标 ${passCount}/${total} 层</div>` + html
                        : `<div style="color:#8a909b">无选中立面（3D 点击楼立面选择）</div>`;
}
```
说明：`PlaneGeometry` 高沿 +Y、宽沿 +X；`rotation.y = -atan2(ez,ex)` 把 +X 对齐边方向。纹理 iu 沿宽（+X→边 a→b 方向）、iv 沿高（+Y）。`DoubleSide` 保证从任意角度可见。

- [ ] **Step 5: scene.js clearAnalysis dispose map + wire refreshSelection**

`clearAnalysis` 里 dispose 加 `material.map`（贴图）：
```js
function clearAnalysis() {
  while (analysisGroup.children.length) {
    const c = analysisGroup.children.pop();
    c.geometry?.dispose?.();
    c.material?.map?.dispose?.();
    c.material?.dispose?.();
    analysisGroup.remove(c);
  }
  const rep = document.getElementById('sun-report');
  if (rep) rep.innerHTML = '';
}
```
删除 `_sphereGeo` 定义（不再用）。
把 `refreshSelection()` 加到会改楼几何/增删楼的 onChange 链：`initLists` onChange、`initEditor2d` onChange、`applyLoadedState`。每处在 `clearAnalysis();` 旁加 `refreshSelection();`。并在初始化末尾（首次 `updateSun()` 附近）调用一次 `refreshSelection()` 显示默认南面高亮。

- [ ] **Step 6: 打包 + 全量测试**

Run: `./build.sh && npm test`
Expected: 打包成功；`sunlight.test.js`（15+）+ `solar.test.js` + 现有全过。

- [ ] **Step 7: 手动验证（浏览器）**

serve 打开 index.html：
1. 画 2 栋楼（南北错落）——每栋南立面出现蓝框（默认南面高亮）。
2. 点「日照分析」——各楼南立面出现整面连片渐变热力图（不是点），低处/被挡处偏红、高处偏绿，交界平滑过渡。报告仅列选中面每层时数。
3. 3D 点击某楼另一面（如东面）——蓝框加到该面；再点南面蓝框消失（toggle）。热力图/报告清空（失效）。
4. 重新「日照分析」——按新选面出图。
5. 移动/删除楼——高亮与热力图更新/清空。

- [ ] **Step 8: Commit**

```bash
git add scene.js index.html bundle.js
git commit -m "feat: facade selection (3D pick) + continuous per-facade heatmap texture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** southFaceIndex/nearestEdge/facadeGrid（T1）✓；analyzeSunlight 按选中面返回 faces + hours 切回（T2）✓；selectedFaces 惰性默认南面（T2 analyze + T3 facadeOf）✓；3D 点面 toggle（T3 Step3）✓；选中面高亮 selectionGroup（T3 Step2）✓；整面 canvas 贴图 LinearFilter 连片渐变（T3 Step4）✓；报告仅统计选中面（T2 buildReport on selected nodes）✓；clearAnalysis dispose map（T3 Step5）✓；几何/选择变化清空+刷新高亮（T3 Step5）✓；index 提示（T3 Step1）✓。
- **偏离 spec（有意，已在计划体现）:** spec 说新建楼时设 selectedFaces；改为**惰性默认**（读取处 `?? [southFaceIndex]`），行为等价且避免 editor2d→sunlight 耦合，editor2d 不改。
- **Placeholder scan:** 无 TBD；各步含完整代码。
- **Type consistency:** facadeGrid 产 `{nodes:[{pos,buildingId,floor,iu,iv,edgeIndex}], nu,nv,L,Htotal,edge:{ax,az,bx,bz,nx,nz}}`；analyzeSunlight 产 `{faces:[{buildingId,edgeIndex,nu,nv,L,Htotal,edge,nodes:[{...,hours}]}], report, threshold}`；renderAnalysis 读 `faces[].{nu,nv,L,Htotal,edge,nodes[].{iu,iv,hours}}` + `report[].{name,floors[].{floor,hours,pass}}`——一致。nearestEdge(footprintRot,x,z) 与 T3 调用一致。`pointSegDist` viewport.js 已导出。
- **潜在风险（留给评审/手动验证）:** PlaneGeometry 朝向 `rotation.y=-atan2(ez,ex)` 与纹理 iu 方向的左右一致性、DoubleSide 下正反面纹理镜像——Step7 手动验证覆盖；若热力图左右镜像，交换 iu 或翻转 canvas 列即可。
