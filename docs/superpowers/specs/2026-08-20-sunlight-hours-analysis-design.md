# 日照时数累计 + 立面网格采样 + 达标报告 设计

日期：2026-08-20
状态：待评审

## 目标

把现有"单点单时刻 lit/unlit 染色"升级为工程可用的日照分析：对每栋楼各层立面铺网格采样点，累计一天（真太阳时 8:00–16:00）的日照时数，按国标（GB 50180 大寒日 ≥2h / 冬至日 ≥1h）判定达标，并以 3D 立面热力图 + 侧栏报告表呈现。

## 范围与约定

- 采样对象：楼栋立面（每层外墙铺网格点，窗位代理）。不含地面开敞空间。
- 标准：大寒日累计 ≥2h（默认）/ 冬至日累计 ≥1h，界面单选切换。
- 时间：真太阳时 8:00–16:00，步长 5 分钟（含端点，97 个时刻）。
- 计算方法：逐点光线追踪（方案 A），点击触发一次算完，非每帧。
- 世界坐标沿用：北=−Z，东=+X，y 上；单位米。

## 模块结构

```
solar.js       新增 sunDirAtSolarTime(latDeg, dayOfYear, solarHour) → {dir, altitude, azimuth}
sunlight.js    新增（核心；纯函数 + 可注入 isLit 的分析器）
  ├ facadeSamplePoints(building, opts)             纯
  ├ solarTimeSteps(startH, endH, stepMin)          纯
  ├ accumulateHours(points, sunDirs, isLit, stepMin) 纯（核心循环，可测）
  ├ buildReport(pointsWithHours, threshold)        纯
  └ analyzeSunlight({...})                          接线 THREE.Raycaster 作 isLit
sunlight.test.js  新增
scene.js       接线按钮 + analysisGroup 热力图 + 报告表渲染
index.html     面板加「日照分析」区
```

关键分离：核心循环把遮挡判定抽成注入的 `isLit(pos, dir) → bool`，纯函数可单测；生产 `isLit` 由 `THREE.Raycaster` 提供。

## solar.js：sunDirAtSolarTime

绕过时钟/经度修正/均时差，直接按真太阳时求太阳方向（分析用真太阳时窗口）。

```js
// 真太阳时 solarHour 的太阳方向（世界向量，北=−Z 东=+X y上）+ 高度角。
export function sunDirAtSolarTime(latDeg, dayOfYear, solarHour) {
  const decl = solarDeclination(dayOfYear);
  const H = hourAngle(solarHour);                 // 15*(solarHour-12)
  const { altitude, azimuth } = altitudeAzimuth(latDeg, decl, H);
  const altR = deg2rad(altitude), azR = deg2rad(azimuth); // 方位从正南、向西为正
  const dir = {
    x: -Math.cos(altR) * Math.sin(azR),   // 东=+X
    y: Math.sin(altR),
    z: Math.cos(altR) * Math.cos(azR),    // 南=+Z
  };
  return { dir, altitude, azimuth };
}
```

复用现有 `solarDeclination`、`hourAngle`、`altitudeAzimuth`、`deg2rad`。方向公式与 `sunPosition` 一致。

## sunlight.js

### facadeSamplePoints(building, { spacing = 3, offset = 0.3 })

依赖 `floorHeights`（geometry.js）、`rotateFootprint`（viewport.js）。

- 旋转后楼底轮廓 `rot = rotateFootprint(building.footprint, building.rotation||0)`（[[x,z],...]）。
- 逐层 i：层底 `base_i` = 前 i 层高之和；采样高度 `y = base_i + heights[i]/2`。
- 逐边 (a→b)：边长 L，点数 `n = max(1, floor(L/spacing))`，在边上均匀取 n 个点（含首、跨度 L/n 的中点式：t=(k+0.5)/n，k=0..n-1）。
- 朝外偏移：边方向 `(dx,dz)`，外法向取 `(dz,-dx)` 归一（轮廓按屏幕顺序，外侧朝向由 reverse 决定——实现时以"远离楼质心"为准：法向点乘 (质心→点) 为正即朝外，否则取反），点 = 边上点 + 法向×offset。
- 返回 `[{ pos:[x,y,z], buildingId, floor:i, edgeIndex:j }]`。

法向朝外判据：计算楼质心 c，对候选法向 nrm，若 `dot(nrm, pt−c) < 0` 取反 nrm，保证朝外。

### solarTimeSteps(startH, endH, stepMin)

```
返回真太阳时数组：从 startH 到 endH（含端点），步长 stepMin/60 小时。
solarTimeSteps(8, 16, 5) → [8, 8.0833..., ..., 16]（97 个）
```
浮点累加用整数步计数避免漂移：`n = round((endH-startH)*60/stepMin)`，`t_k = startH + k*stepMin/60`，k=0..n。

### accumulateHours(points, sunDirs, isLit, stepMin)

```
每点 hours=0
for dir of sunDirs:            // sunDirs 已过滤 altitude>0
  for p of points:
    if isLit(p.pos, dir): p_hours += stepMin/60
返回 points 的浅拷贝，各加 hours 字段
```

（`sunDirs` 为 `analyzeSunlight` 预先算好并过滤掉 altitude≤0 的方向数组。）

### buildReport(pointsWithHours, threshold, nameById)

`nameById` = `{ [buildingId]: 显示名 }`，由 analyzeSunlight 传入（building.name 或兜底 id.slice(-4)+'号'）。按 buildingId 分组，再按 floor 分组：
```
report: [{
  buildingId, name,                  // name = nameById[buildingId]
  floors: [{ floor, hours, pass }]   // hours = 该层各点 hours 的最大值；pass = hours >= threshold
}]
```
floors 按 floor 升序；report 按 buildingId 出现顺序。

### analyzeSunlight({ buildings, walls, occluderMeshes, THREE, latDeg, dayOfYear, threshold, startH=8, endH=16, stepMin=5, spacing=3, offset=0.3 })

1. `points = buildings.flatMap(b => facadeSamplePoints(b, {spacing, offset}))`（带 name 映射便于报告）。
2. `steps = solarTimeSteps(startH, endH, stepMin)`；`sunDirs = steps.map(st => sunDirAtSolarTime(latDeg, dayOfYear, st)).filter(s => s.altitude > 0).map(s => s.dir)`。
3. `raycaster = new THREE.Raycaster()`；`isLit(pos, dir)`：
   ```
   raycaster.set(new Vector3(...pos), new Vector3(dir.x,dir.y,dir.z).normalize());
   return raycaster.intersectObjects(occluderMeshes, true).length === 0;
   ```
4. `withHours = accumulateHours(points, sunDirs, isLit, stepMin)`。
5. `nameById = Object.fromEntries(buildings.map(b => [b.id, b.name || (String(b.id).slice(-4)+'号')]))`。
6. `report = buildReport(withHours, threshold, nameById)`。
7. 返回 `{ points: withHours, report, threshold }`。

`occluderMeshes`：worldGroup 中 `kind==='floor'` 或 `kind==='wall'` 的 mesh（排除 label、floor-line、地面、底图）。由 scene.js 收集传入，保持 sunlight.js 不直接依赖 worldGroup 结构。

## 3D 热力图（scene.js）

- 独立 `analysisGroup`（THREE.Group），加入 scene。
- 每采样点一个小球（`SphereGeometry(0.6)` 复用一个 geometry，逐点 Mesh 或 InstancedMesh；首版用普通 Mesh + 共享 geometry，材质按色）。
- 着色（阈值 T）：
  ```
  h≤0    红 #d32f2f
  h=T    黄 #fbc02d
  h≥1.5T 绿 #43a047
  段内线性插值（0..T 红→黄，T..1.5T 黄→绿，>1.5T 绿）
  ```
- `depthTest` 开：被楼挡住的点不穿透显示。
- `clearAnalysis()`：清空 analysisGroup（dispose geometry/material）+ 清报告表。任何几何编辑（现有 `onChange` 链）触发清空——结果失效不误导。

## 报告表（scene.js + index.html）

面板「日照分析」区容器渲染：
```
楼      | 层 | 时数(h) | 达标
1号     | 1  | 0.8     | ✗
1号     | 2  | 2.3     | ✓
...
```
- 每栋楼分组小标题，其下逐层行；`hours.toFixed(1)`；`pass` → ✓/✗；不达标行文字标红。
- 顶部汇总：达标层数/总层数。

## UI（index.html）

面板新增 section「日照分析」：
```
标准： (·)大寒日≥2h  ( )冬至日≥1h        // 单选
[ 日照分析 ]  按钮
<div id="sun-report"></div>              // 报告容器
```
- 选标准即设 `state` 的分析日期/阈值：大寒=1月20日(dayOfYear 20)/T=2；冬至=12月21日(dayOfYear 355)/T=1。
- 点「日照分析」：收集 occluderMeshes → analyzeSunlight → 建热力图 + 渲染表。
- 无楼：alertModal 提示"请先画楼"并退出。
- 计算期间按钮禁用、文字"计算中…"，`await` 一帧让 UI 刷新后再算（避免卡顿无反馈）。

## 数据流

```
点「日照分析」
→ 读标准（大寒/冬至）→ dayOfYear + threshold
→ 收集 worldGroup 中 floor/wall mesh 作 occluderMeshes
→ analyzeSunlight（facadeSamplePoints → sunDirs → accumulateHours → buildReport）
→ analysisGroup 建热力图小球（按 hours 着色）
→ 渲染报告表
几何编辑（onChange）→ clearAnalysis（热力图 + 表清空）
```

## 文件改动清单

| 文件 | 改动 |
|---|---|
| solar.js | 新增 sunDirAtSolarTime |
| sunlight.js | 新增：facadeSamplePoints、solarTimeSteps、accumulateHours、buildReport、analyzeSunlight |
| sunlight.test.js | 新增单测 |
| geometry.js | 导出 floorHeights（已导出）供 facadeSamplePoints 复用 |
| index.html | 面板加「日照分析」区（标准单选 + 按钮 + 报告容器） |
| scene.js | 接线：按钮、analysisGroup 热力图、报告渲染、clearAnalysis 挂 onChange |
| bundle.js | 重新打包 |

## 测试（sunlight.test.js，node --test）

1. **facadeSamplePoints**
   - 10×10 单层楼（footprint 正方形，floorHeight 3，floorCount 1）：每边 floor(10/3)=3 点，共 12 点；y 全为 1.5；点在墙外（离质心距离 > 5）。
   - floorCount 2：点数×2，第二层 y=4.5。
   - 旋转 90°：点仍在旋转后轮廓外侧（法向朝外校验）。
2. **solarTimeSteps**：`solarTimeSteps(8,16,5)` 长度 97，首=8、末=16；相邻差 5/60。
3. **sunDirAtSolarTime**
   - 正午（st=12）：H=0，altitude=90−|lat−decl|；dir.x≈0，dir.z>0（朝南）。
   - lat=40, dayOfYear=355（冬至），st=12：altitude≈26.5°（与现有 solar 测试一致）。
   - 上午（st=9）：dir.x>0（东）。
4. **accumulateHours**（注入桩 isLit）
   - `isLit=()=>true`、sunDirs 长度 N、stepMin=5：每点 hours = N*5/60。
   - `isLit=()=>false`：每点 hours=0。
   - `isLit` 对半数方向返回 true：hours = (N/2)*5/60。
5. **buildReport**
   - 两点同楼同层，hours 1.0 与 2.3，threshold 2：该层 hours=2.3、pass=true。
   - 两层一楼：floors 按 floor 升序，各自 max/pass 正确。

## 非目标（YAGNI）

- 地面开敞空间日照（本版只做立面）。
- 逐窗建模（用立面网格点代理）。
- 连续日照时段判定（只做累计小时；GB 50180-2018 已以累计为主）。
- GPU 阴影加速（方案 B）——首版逐点 raycast 够用。
- 导出分析报告到文件（先屏显）。
- 采样密度/时间步的 UI 调节（用固定默认，代码常量可改）。
