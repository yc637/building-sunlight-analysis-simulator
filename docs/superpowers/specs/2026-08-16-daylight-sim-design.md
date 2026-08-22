# 楼房采光模拟软件 — 设计文档

日期：2026-08-16
状态：待评审

## 1. 目标

一个简单的网页版楼房采光模拟工具，通过 3D 场景 + 实时阴影动画，直观演示不同经纬度、不同日期/时间下，楼房之间的日照遮挡关系。核心用途：观察冬至（影最长）时某栋楼是否被邻楼遮挡，辅助判断采光。

不追求国标日照时数合规统计与窗级采光数值，只做可信的可视化演示。

## 2. 技术选型

**单个 `index.html` + Three.js，无构建步骤。**

- 纯 vanilla JavaScript，ES modules。
- Three.js 本地 vendored（`three.module.js` + `OrbitControls.js` + `BufferGeometryUtils` 按需），不依赖 CDN，双击打开即用、离线可跑、便于分享。
- 放弃 Vite / react-three-fiber：对本项目属过度设计。

## 3. 架构

两个职责清晰、可独立测试的模块。

### 3.1 太阳几何模块 `solar.js`（纯函数，可单测）

输入：纬度 φ、经度 lon、时区中央经线经度、年内第几天 N、当地时钟时间 t（小时，含小数）。

**精确档**计算（含经度修正 + 均时差）：

```
赤纬:   δ = 23.45° × sin( 360° × (284 + N) / 365 )
均时差: B = 360° × (N − 81) / 365
        EoT = 9.87·sin(2B) − 7.53·cos(B) − 1.5·sin(B)   [分钟]
太阳时: t_solar = t + (lon − lon_tz) × 4分钟/度 / 60 + EoT/60
时角:   H = 15° × (t_solar − 12)
高度角: sin(α) = sin(φ)·sin(δ) + cos(φ)·cos(δ)·cos(H)
方位角: A = atan2( sin(H), cos(H)·sin(φ) − tan(δ)·cos(φ) )   // 从正南量，向西为正
```

输出：`{ altitude, azimuth }`，以及供渲染用的单位方向向量（Three.js 坐标，y 朝上、北=−Z、东=+X）：

```
x =  cos(α) · sin(A_fromNorth)
y =  sin(α)
z = −cos(α) · cos(A_fromNorth)
```

（`A_fromNorth` 由「从正南量」的 A 转换而来。）

夜间（α < 0）：太阳在地平线下，关闭平行光或标记为无日照。

### 3.2 场景与 UI 模块 `scene.js` / `index.html`

**3D 渲染（Three.js）**
- `PerspectiveCamera` + `OrbitControls`（旋转/缩放/平移看场景）。
- `DirectionalLight` 作太阳：`castShadow = true`，`PCFSoftShadowMap`，阴影相机正交范围覆盖场景。
- 地面 `PlaneGeometry`，`receiveShadow = true`。
- 每栋楼：多边形楼底 → `THREE.Shape` → `ExtrudeGeometry`（depth = 层高），**每层一段独立几何**，沿高度堆叠，使每层可单独上色。`castShadow` + `receiveShadow`。几何在 XY 面拉伸后旋转平躺到 XZ 地面；注意顶点绕序保证法线朝外、阴影正常。
- 围墙：折线路径 + 厚度 → 沿路径拉出薄墙条（`ExtrudeGeometry` 或分段 box），`castShadow` + `receiveShadow`，与楼一同参与遮挡。
- 环境光 `AmbientLight` 弱光，避免背光面纯黑。

**逐层采光高亮（核心功能）**
- 对每栋楼每一层，取代表点（楼底质心，抬到该层中点高度）作采光判定。
- 用 `THREE.Raycaster` 从代表点沿太阳方向向量发射，检测是否被**其他楼或围墙**几何遮挡（排除自身）。围墙虽矮，但对低层判定影响大。
- 结果：晒到 = 亮/暖色，遮挡 = 暗/冷色。太阳在地平线下（α<0）时全部记为遮挡。
- 每次 state 变化（时间/日期/纬度/楼体改动）重算各层日照状态并刷新层颜色。
- 说明：此为单点简化判定（非窗级、非时段累计），用于直观演示而非国标合规统计。

**建楼 / 围墙编辑器（2D 俯视 canvas）**
- 建楼模式：逐点点击画多边形楼底，双击或回车闭合；输入默认层高 + 层数，生成 3D 分层拉伸体。
- 围墙模式：逐点点击画折线路径（不闭合），输入墙高 + 厚度，沿路径拉成薄墙条。
- 围墙是独立低矮遮挡物（几米高），投影 + 参与逐层遮挡判定，专门用于压低层采光的场景。
- 楼列表：可改每栋楼的位置、默认层高、层数、单层覆盖高度、删除。
- 围墙列表：可改路径、高度、厚度、删除。
- 顶点级编辑（拖顶点/增删点）本期 YAGNI，后续再加。

**控件面板**
- 纬度滑块、经度输入、时区选择。
- 日期选择（→ 年内第几天 N）。
- 时间滑块（0–24 小时）。
- 播放/暂停：时间自动推进，阴影实时扫过 = 阴影动画。
- 快捷按钮：冬至 / 春秋分 / 夏至 一键跳转。

## 4. 数据流

```
UI 输入 → state { buildings[], lat, lon, tz, dayOfYear, time }
        → solar.js 算太阳方向向量
        → 更新 DirectionalLight.position + 阴影相机
        → 渲染循环重画 → 阴影实时扫过地面与楼体
```

state 为单一数据源；UI 改动写入 state，渲染循环读 state。

## 5. 数据结构

```js
building = {
  id: string,
  footprint: [[x, z], ...],   // 世界坐标多边形顶点（米）
  floorHeight: number,         // 默认层高（米），如 3
  floorCount: number,          // 层数
  overrides: { [floorIndex: number]: number },  // 可选：某层单独层高
  // 派生（运行时算）：每层日照状态 lit: boolean[]
}
// 总高 = Σ 各层层高（未覆盖的层用 floorHeight）

wall = {
  id: string,
  path: [[x, z], ...],   // 折线路径顶点（不闭合），世界坐标（米）
  height: number,         // 墙高（米），如 2.5
  thickness: number       // 墙厚（米）
}

state = {
  buildings: building[],
  walls: wall[],
  lat: number, lon: number, tzMeridian: number,
  dayOfYear: number,   // 1..365
  time: number,        // 0..24，小时含小数
  playing: boolean
}
```

## 6. 错误处理 / 边界

- 多边形顶点 < 3：不生成楼体，提示。
- 自相交多边形：ExtrudeGeometry 可能出错；本期先不校验，画凸/简单多边形即可（记为已知限制）。
- 夜间 α < 0：关灯或提示「无日照」。
- 极端纬度（极昼/极夜）：公式自然给出，界面如实展示。

## 7. 测试

- `solar.js` 单测（纯函数，好测）：
  - 北纬 40° 正午三节气高度角：冬至 ≈ 26.55°、春秋分 ≈ 50°、夏至 ≈ 73.45°。
  - 赤道春秋分正午 ≈ 90°。
  - 方向向量：正午高度角对应 y 分量、正南方位。
  - 均时差在已知日期对照参考值（数量级 −14~+16 分钟）。
- 逐层遮挡判定：构造两楼场景（高楼挡矮楼），验证矮楼低层记为遮挡、高层记为晒到；太阳过顶时全晒到；夜间全遮挡。
- 围墙遮挡：矮墙在低阳角时把邻楼一楼记为遮挡、上层不受影响。
- 场景渲染靠肉眼验证（阴影方向随时间/节气变化合理，层高亮与实际阴影一致）。

## 8. YAGNI（本期不做）

- 国标日照时数统计、窗级采光系数数值。
- 文件存读（后续加 localStorage 或导入导出 JSON）。
- 地形、贴图、精细材质。
- 多边形顶点级编辑、自相交校验。

## 9. 文件结构

```
index.html      // 页面 + UI 面板
solar.js         // 太阳几何纯函数模块
scene.js         // Three.js 场景、编辑器、渲染循环
solar.test.js    // solar.js 单测
vendor/          // three.module.js、OrbitControls.js
```
