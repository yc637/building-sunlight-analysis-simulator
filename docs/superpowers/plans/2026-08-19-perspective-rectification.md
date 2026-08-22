# 透视校正底图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户用 4 组「图像像素 ↔ 经纬度」对应点，把斜拍底图校正为正射平面图，接入现有 2D/3D 底图管线。

**Architecture:** 新增纯函数模块 `homography.js` 求解 4 点单应矩阵并做逆映射重采样；`editor2d.js` 增加 `calibrate` 标定模式（点 4 点、逐点填经纬度），校正后用新图替换 `bg`，复用现有绘制/3D 贴图/拖拽缩放管线。

**Tech Stack:** 原生 JS（ES module）、Canvas 2D、Node 内置 `node:test`。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-19-perspective-rectification-design.md`

## Global Constraints

- 无新增 npm 依赖；构建用现有 `./build.sh`（esbuild 打包 `scene.js`）。
- 测试用 `node --test`（`npm test`），测试文件放仓库根目录，命名 `*.test.js`。
- 世界坐标约定（沿用 viewport.js）：北=−Z，南=+Z，东=+X，西=−X；世界米 `[[x,z],...]`。
- 底图对象形状：`bg = { img, worldX, worldZ, mpp }`，`img` 为 Image 或 Canvas。
- commit 消息以 `feat:`/`fix:`/`docs:` 开头，末尾追加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

### Task 1: homography.js 核心（解矩阵 + 逆 + 点变换）

**Files:**
- Create: `homography.js`
- Create: `homography.test.js`

**Interfaces:**
- Consumes: 无（独立纯模块）。
- Produces:
  - `solveHomography(srcPts, dstPts)` → 3x3 数组 `H`（`src→dst`，`H[2][2]=1`）或 `null`。`srcPts`/`dstPts` 均为 `[[x,y]×4]`。
  - `invertHomography(H)` → 3x3 数组 `H⁻¹` 或 `null`。
  - `transformPoint(H, x, y)` → `[x', y']`（齐次正向映射）。
  - `applyHomography(img, H, worldBBox, outW)` → `{ canvas, mpp, worldX, worldZ }`（浏览器侧，Task 2 依赖）。

- [ ] **Step 1: 写失败测试**

创建 `homography.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test homography.test.js`
Expected: FAIL — `Cannot find module './homography.js'`

- [ ] **Step 3: 写最小实现**

创建 `homography.js`：

```js
// 透视校正：4 组对应点解单应矩阵（Homography），并做像素逆映射重采样。
// 约定：H 为 3x3 行主序数组，src→dst，H[2][2]=1。

// 4 组对应点 (srcPts→dstPts) 解 3x3 单应矩阵。点退化（共线/秩亏）返回 null。
export function solveHomography(srcPts, dstPts) {
  const A = []; // 8 行 × 9 列（含常数项）
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i];
    const [u, v] = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]); // 分子 x 方程
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]); // 分子 y 方程
  }
  const h = gaussSolve8(A);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// 高斯消元（部分主元）解 8 元线性方程组，A 为 8×(8+1) 增广矩阵。奇异返回 null。
function gaussSolve8(A) {
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

// 齐次正向映射：H 作用于 (x,y,1)。
export function transformPoint(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [
    (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  ];
}

// 3x3 逆矩阵（伴随矩阵/行列式）。奇异返回 null。
export function invertHomography(H) {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test homography.test.js`
Expected: PASS（5 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add homography.js homography.test.js
git commit -m "feat: homography solver + tests (4-point perspective rectification)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 重采样 + 标定 UI

**Files:**
- Modify: `homography.js`（追加 `applyHomography`）
- Modify: `editor2d.js`（import、calibrate 模式、标定绘制与流程、导出 `startCalibrate`）
- Modify: `index.html`（底图工具栏加「校正」按钮）
- Modify: `scene.js`（按钮接线）

**Interfaces:**
- Consumes: Task 1 的 `solveHomography`、`invertHomography`、`transformPoint`；`viewport.js` 的 `geoPointsToWorld`、`polyBBox`；`modal.js` 的 `promptModal`、`alertModal`。
- Produces: `applyHomography(img, H, worldBBox, outW)`；`editor.startCalibrate()`。

- [ ] **Step 1: 追加 applyHomography 到 homography.js**

在 `homography.js` 末尾追加（浏览器侧，用 `document.createElement`/`ImageData`）：

```js
// 逆映射重采样：把 src 图（img）按 H（像素→世界米）重投影成正射图。
// worldBBox = {minX,maxX,minZ,maxZ}（目标4点世界包围盒）；outW 控制输出横向分辨率（默认=img.width）。
// 返回 { canvas, mpp, worldX, worldZ }，直接可作 bg 使用。
export function applyHomography(img, H, worldBBox, outW = img.width) {
  const mpp = (worldBBox.maxX - worldBBox.minX) / outW;
  const outH = Math.max(1, Math.round((worldBBox.maxZ - worldBBox.minZ) / mpp));
  const Hinv = invertHomography(H);
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  // 先把 img 落到普通 canvas 以读像素
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, img.width, img.height).data;
  const odata = octx.createImageData(outW, outH);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      // 输出像素中心 → 世界米 → 源像素（H 逆）
      const wx = worldBBox.minX + (ox + 0.5) * mpp;
      const wz = worldBBox.minZ + (oy + 0.5) * mpp;
      const [sx, sy] = transformPoint(Hinv, wx, wz);
      const xi = Math.round(sx - 0.5), yi = Math.round(sy - 0.5);
      if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) {
        const s = (yi * img.width + xi) * 4;
        const d = (oy * outW + ox) * 4;
        odata.data[d] = sdata[s];
        odata.data[d + 1] = sdata[s + 1];
        odata.data[d + 2] = sdata[s + 2];
        odata.data[d + 3] = 255;
      }
      // 源图外保持透明（alpha 0）
    }
  }
  octx.putImageData(odata, 0, 0);
  return { canvas: out, mpp, worldX: worldBBox.minX, worldZ: worldBBox.minZ };
}
```

- [ ] **Step 2: editor2d.js 加 import**

替换 `editor2d.js` 顶部 import 块：

```js
import {
  worldToPx, pxToWorld, zoomAt, gridStepMeters, fitView, polyBBox, pointSegDist,
  pointInPolygon, buildingCenter, resizeImageMpp, imageBounds, translateImage, rotateFootprint,
  geoPointsToWorld,
} from './viewport.js';
import { solveHomography, applyHomography } from './homography.js';
import { promptModal, alertModal } from './modal.js';
```

- [ ] **Step 3: editor2d.js 加标定状态**

在 `let selected = null;` 之后（约第 16 行）追加：

```js
  let calibrating = false;              // 透视校正标定模式
  let calibPts = [];                    // [{px, py, lat, lon}]
```

- [ ] **Step 4: editor2d.js 加标定绘制**

在 `drawLabel` 函数之后（约第 261 行）追加：

```js
  // 标定模式：画已标定的点 + 序号
  function drawCalibPts() {
    if (!calibrating) return;
    calibPts.forEach((p, i) => {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.px, p.py, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ef6c00';
      ctx.beginPath(); ctx.arc(p.px, p.py, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.px, p.py);
    });
  }
```

在 `draw()` 函数内，`drawBg();` 之后插入 `drawCalibPts();`：

```js
  function draw() {
    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBg();
    drawCalibPts();
    const step = drawGrid();
    ...
  }
```

- [ ] **Step 5: editor2d.js 加标定流程函数**

在 `loadImage` 之后（约第 568 行）追加：

```js
  // 进入透视校正标定：需先载入底图
  function startCalibrate() {
    if (!bg) return;
    calibrating = true; calibPts = [];
    canvas.style.cursor = 'crosshair';
    draw();
  }

  async function addCalibPoint(px, py) {
    const r = await promptModal({
      title: `标定点 ${calibPts.length + 1}/4`,
      fields: [
        { key: 'lat', label: '纬度', type: 'number', step: '0.000001', placeholder: '如 39.9100' },
        { key: 'lon', label: '经度', type: 'number', step: '0.000001', placeholder: '如 116.3900' },
      ],
    });
    if (!r) return; // 取消：不加点
    if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      calibPts.push({ px, py, lat: r.lat, lon: r.lon });
    }
    draw();
    if (calibPts.length === 4) finishCalibrate();
  }

  async function finishCalibrate() {
    const srcPts = calibPts.map((p) => [p.px, p.py]);
    const geo = geoPointsToWorld(calibPts.map((p) => ({ lat: p.lat, lon: p.lon })));
    const H = solveHomography(srcPts, geo.world);
    if (!H) {
      await alertModal({ title: '校正失败', message: '4 点退化（多点共线），请重新标定' });
      calibrating = false; calibPts = []; canvas.style.cursor = 'crosshair'; draw();
      return;
    }
    const bbox = polyBBox(geo.world);
    const res = applyHomography(bg.img, H, bbox, bg.img.width);
    bg = { img: res.canvas, worldX: res.worldX, worldZ: res.worldZ, mpp: res.mpp };
    syncBg();
    calibrating = false; calibPts = [];
    canvas.style.cursor = 'crosshair';
    onChange(); // 同步 3D 底图 + 列表
    draw();
  }
```

- [ ] **Step 6: editor2d.js 接线鼠标事件**

在 `mousedown` 处理器内，`lDown = p; moved = false; dragTarget = null; rotating = null;` 之后、`const w = wAt(...)` 之前，插入标定早退：

```js
    if (calibrating) { lDown = p; return; }
```

（把原 `const w = wAt(p.px, p.py);` 移到早退之后保持不变。）

在 `mouseup` 处理器内，`if (lDown && !moved) {` 块的开头（选中楼判断之前）插入标定点击：

```js
    if (calibrating && lDown && !moved) {
      addCalibPoint(lDown.px, lDown.py);
      lDown = null; moved = false; dragTarget = null; dragStartWorld = null; rectStart = null; rectCur = null; rotating = null;
      return;
    }
```

- [ ] **Step 7: editor2d.js 键盘 Esc 取消标定**

在 `keydown` 处理器内，`e.key === 'Escape'` 分支开头加标定取消：

```js
    } else if (e.key === 'Escape') {
      if (calibrating) { calibrating = false; calibPts = []; draw(); }
      else if (selected) clearSel(); else pts = [];
      draw();
    }
```

- [ ] **Step 8: editor2d.js 导出 startCalibrate**

把 `return { ... }` 末尾追加 `startCalibrate`：

```js
  return { setMode, redraw: draw, loadImage, resetView, fitToBoundary, undo: () => pts.pop() && draw(), resizeCanvas, resizeBg, setBgMpp, clearBg, setHover, hasBg, startCalibrate };
```

- [ ] **Step 9: index.html 加按钮**

在底图组内 `load-bg` 之后加：

```html
        <button id="calibrate-bg">校正</button>
```

即：

```html
      <div class="group">
        <button id="load-bg">底图</button>
        <button id="calibrate-bg">校正</button>
        <button id="bg-dec">−</button>
        ...
      </div>
```

- [ ] **Step 10: scene.js 接线按钮**

在 `document.getElementById('load-bg').onclick = ...` 之后追加：

```js
document.getElementById('calibrate-bg').onclick = () => {
  if (!state.bg) { alertModal({ message: '请先载入底图' }); return; }
  editor.startCalibrate();
  setActiveMode('drag');
};
```

（`alertModal` 已从 `./modal.js` 导入于 scene.js 顶部；若未导入则补。）

- [ ] **Step 11: 重新打包 + 全量测试**

Run: `./build.sh && npm test`
Expected: 打包成功；`homography.test.js` 5 项 + 现有 41 项全过，无 fail。

- [ ] **Step 12: 手动验证（浏览器）**

打开 `index.html`：
1. 「底图」载入一张斜拍图
2. 点「校正」，图上点 4 个角，逐点填经纬度
3. 第 4 点确认后，底图变正射，2D 与 3D 底图同步更新
4. 在图上画楼/围墙，坐标合理
5. Esc 中途取消标定 → 底图保持原样

- [ ] **Step 13: Commit**

```bash
git add homography.js editor2d.js index.html scene.js bundle.js
git commit -m "feat: perspective-rectify slanted basemap via 4-point homography

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** 求解单应矩阵（Task 1）✓；逆映射重采样（Task 2 Step 1）✓；标定 UI「图上点 4 点+逐点填经纬度」（Task 2 Step 5）✓；底图工具栏入口（Step 9/10）✓；校正后替换底图（Step 5 `bg = {...}`）✓；复用现有管线（不 `onChange` 之外的额外 3D 改动）✓；局限提示（点退化 alert）✓。
- **Type consistency:** `solveHomography`/`invertHomography`/`transformPoint`/`applyHomography` 签名在 Task 1 与 Task 2 一致；`geoPointsToWorld` 返回 `{world:[[x,z],...], bbox}`，`polyBBox` 接受 `[[x,z],...]`，均与 viewport.js 实际实现匹配。
- **偏离 spec 一处（有意修正）:** spec 写「输出分辨率=源图分辨率 outH=img.height」，实现改为 `outW=img.width`、`outH` 由世界包围盒长宽比推出 —— 保证校正图长宽比真实、无拉伸，且直接以 `worldX/worldZ/mpp` 轴对齐落位。已在 Step 1 注释说明。
