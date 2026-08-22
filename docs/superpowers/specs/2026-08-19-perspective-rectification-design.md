# 透视校正底图（Homography Rectification）设计

日期：2026-08-19
状态：待评审

## 目标

用户导入的底图常为斜拍视角（非 90° 垂直俯视）。本功能让用户用 4 组「图像像素点 ↔ 真实经纬度」对应点，将斜拍图校正为正射平面图，并作为底图接入现有 2D 编辑器与 3D 场景。

## 前提与局限（如实告知用户）

- 假设地面是平面。地面特征（道路、楼底、墙基）校正正确；楼顶因高度差会残余偏移，但楼底在地面、底面可校正对。
- Homography 只校正透视，不校正镜头桶形/枕形畸变。广角/鱼眼图会有残差。
- 4 点必须不共线（三点共线导致矩阵退化，无解或病态解）。

## 新增模块：`homography.js`（纯函数，可单测）

### `solveHomography(srcPts, dstPts)`
- 输入：`srcPts` 图像像素 `[[px,py]×4]`，`dstPts` 世界米 `[[x,z]×4]`
- 输出：3x3 单应矩阵 `H`（或 null 若点退化）
- 算法：DLT 直接线性变换，8 未知数。4 点各给 2 方程，8×9 齐次方程组，SVD 取最小奇异值对应向量，reshape 3x3，归一化 `H[2][2]=1`。

### `applyHomography(img, H, outW, outH)`
- 输入：源 `img`（Image/Canvas）、`H`、输出尺寸 `outW×outH`
- 输出：校正后的 `HTMLCanvasElement`
- 算法：对每个输出像素 `(x,y)`，用 `H⁻¹` 逆映射回源图采样（`drawImage` 源裁剪 + 逐像素或网格透视）。为保细节，输出分辨率 = 源图分辨率（`outW=img.width, outH=img.height`）。采样用源图像素邻域双线性（`drawImage` 对 sub-pixel 自动双线性）。

### 输出定位
校正后底图的世界定位由目标 4 点的世界包围盒决定：
- `mpp` = 世界包围盒宽度 ÷ 输出像素宽度（= 高度方向同理，若长宽比略不一致以 X 方向为准，因 Homography 已保证真实比例，两方向应接近；取均值并留注释）
- `worldX/worldZ` = 目标 4 点最小 x/z

## 新增 UI（`index.html` + `editor2d.js`）

### 入口
底图工具栏加「校正」按钮（`load-bg` 旁）。仅当已载入底图时可点。

### 标定流程（点一下填一下）
1. 点「校正」→ 进入 `calibrate` 模式，`pts` 清空，界面提示「点 4 个点，每点填经纬度」
2. 在图上点第 1 点（记录像素坐标）→ 弹 `promptModal` 填该点纬度、经度 → 存 `{px, py, lat, lon}`
3. 重复到 4 点
4. 4 点齐 → 校验（4 点不共线）→ 转世界米（复用 `geoPointsToWorld`）→ `solveHomography` → `applyHomography` → 替换 `bg`（`img`=校正图，`worldX/worldZ/mpp` 见上）→ 退出标定模式
5. 任一步取消（Esc / 弹窗取消）→ 清空标定点，退出，保留原底图不变

### 标定视觉反馈
- 已标定点画十字标记 + 序号（1..4）
- 已填经纬度的点实心，未填空心
- 第 4 点完成后立即校正

## 数据流

```
斜拍图 loadImage → 「校正」→ 点4点+逐点填经纬度
→ geoPointsToWorld（复用 viewport.js）
→ solveHomography → applyHomography
→ 新 img 替换 bg（世界定位由目标4点包围盒决定）
→ 复用 drawBg + 3D 贴图 + 拖拽/缩放/锁定（全部不变）
```

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `homography.js` | 新增：solveHomography、applyHomography |
| `homography.test.js` | 新增：单测（单位矩阵/已知透视/退化点） |
| `editor2d.js` | 加 calibrate 模式、标定点绘制、校正流程、导出入口 |
| `index.html` | 底图工具栏加「校正」按钮 |
| `scene.js` | 可能暴露 calibrate 入口（与 editor.setMode 并列） |
| `bundle.js` | 重新打包 |

## 测试

- `homography.test.js`：
  1. 已知 4 点构成正方形，解 H 应为单位矩阵（或保形）
  2. 已知透视变换（手工构造源/目标），解 H 反推目标误差 < 1e-6
  3. 三点共线 → 返回 null
  4. `geoPointsToWorld` 逆变换一致性（用 viewport 现有测试覆盖）
- 手动：载入斜拍图，标 4 角，目测校正图横平竖直

## 非目标（YAGNI）

- 不做镜头畸变校正（需标定板/内参，超出范围）
- 不做多点最小二乘（>4 点配准、RANSAC 去噪）
- 不做自动特征匹配（无 OpenCV）
- 不做校正图另存/切换（直接替换底图）
