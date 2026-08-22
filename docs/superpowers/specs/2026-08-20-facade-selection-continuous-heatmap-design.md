# 立面选择 + 整面连片渐变热力图 设计

日期：2026-08-20
状态：待评审

## 目标

改造已建的日照分析子系统两点：
1. 热力图默认只分析每栋楼**最朝南的一个立面**，支持在 3D 视图**点面手动增减**其它立面。
2. 热力图从点云小球改为**整面一张贴图**——立面上密集网格采样，写 canvas 纹理贴到立面 quad，GPU 线性过滤出连片渐变（交界自然过渡）。

## 现状（被改造对象）

- `sunlight.js`：`facadeSamplePoints`（每层每边铺点）、`solarTimeSteps`、`accumulateHours`、`buildReport`、`analyzeSunlight`。
- `scene.js`：`analysisGroup` + 点云小球 `renderAnalysis`、`hoursColor`、`clearAnalysis`、`#run-sunlight` 按钮。
- 采样点结构 `{pos:[x,y,z], buildingId, floor, edgeIndex}`；报告 `{buildingId,name,floors:[{floor,hours,pass}]}`。
- `accumulateHours`/`buildReport` 与节点结构解耦，可直接复用（新网格节点带同样 buildingId/floor/hours 字段）。

## 立面数据模型

- 每栋楼加 `selectedFaces: number[]`（选中的边索引，随 `serializeState` 持久化——building 对象整体序列化，无需改 viewport.js）。
- 新建楼时默认 `selectedFaces = [southFaceIndex(building)]`（editor2d.js 建楼两处 + geometry 兜底）。
- 已有楼 `selectedFaces` 缺失（旧存档/未设）→ 使用时惰性视为 `[southFaceIndex(building)]`（读取处 `b.selectedFaces ?? [southFaceIndex(b)]`，不静默改数据）。

## sunlight.js 新增纯函数

### southFaceIndex(building)
旋转后楼底轮廓各边，取外法向 `.z` 最大（最接近正南 +Z）的边索引。外法向判据同 `facadeSamplePoints`（`(dz,-dx)/L`，指向质心则取反）。
```
返回：number（边索引 0..n-1）
```

### nearestEdge(footprintRot, x, z)
点 (x,z) 到旋转轮廓各边线段距离最小的边索引（3D 拾取用）。复用 `pointSegDist`（viewport.js 已导出）。
```
nearestEdge(rot, x, z) → number
```

### facadeGrid(building, edgeIndex, { step = 1.5, offset = 0.3 })
一个立面（边 a→b，跨全楼高 Htotal = 各层高之和）铺密集网格。
```
返回 {
  nodes: [{ pos:[x,y,z], buildingId, floor, iu, iv, edgeIndex }],  // nu×nv 个
  nu, nv, L, Htotal,
  edge: { ax, az, bx, bz, nx, nz }   // 边端点 + 朝外单位法向（渲染 quad 用）
}
```
- `nu = max(2, ceil(L/step)+1)`，`nv = max(2, ceil(Htotal/step)+1)`（含端点，保证 quad 满铺）。
- 横向 `t = iu/(nu-1)`（0..1），纵向 `v = iv/(nv-1)*Htotal`（0..Htotal）。
- 节点 pos = 边上点(t) + 外法向×offset，y = v。
- `floor`：v 落在累计层高第几层（`floorHeights` 累加，`v` ≥ base_i 且 < base_{i+1} → floor i；v==Htotal 归最后一层）。
- `iu,iv` 供纹理寻址。

## 采样 / 分析改造

`analyzeSunlight` 改为按选中面网格采样（替换 `facadeSamplePoints` 全立面铺点）：
```
analyzeSunlight({ buildings, occluderMeshes, THREE, latDeg, dayOfYear, threshold,
                  startH=8, endH=16, stepMin=5, step=1.5, offset=0.3 })
→ { faces:[{ buildingId, edgeIndex, nu, nv, L, Htotal, edge, nodes:[{...,hours}] }],
    report, threshold }
```
流程：
1. 每栋楼取 `faces = (b.selectedFaces ?? [southFaceIndex(b)])`；对每个 edgeIndex 调 `facadeGrid` → 一个 face 对象（含 nodes、nu/nv/L/Htotal/edge）。
2. 拼平所有 face 的 nodes 成 `allNodes`（记录每 face 的 nodes 数量/起始偏移）。
3. sunDirs 同现状（真太阳时窗口、altitude>0）。
4. `withHours = accumulateHours(allNodes, sunDirs, isLit, stepMin)`（isLit=raycast，不变）。`accumulateHours` 返回**新对象数组**（同序），故按偏移把 `withHours` 切回各 face：`face.nodes = withHours.slice(offset, offset+count)`。
5. `report = buildReport(withHours, threshold, nameById)`（仅含选中面节点 → 仅统计选中面）。
6. 返回 `{ faces, report, threshold }`（faces.nodes 已带 hours，供整面贴图）。

`facadeSamplePoints` 保留（其单测不动），但 analyze 不再用它；若最终无引用可留作向后兼容（YAGNI：不删测试）。

## scene.js 渲染改造

### 选中面高亮（selectionGroup，始终显示）
- `selectionGroup`（THREE.Group）。`refreshSelection()`：遍历各楼 `selectedFaces`，每面画立面矩形蓝色描边（LineLoop：边 a→b 在 y=0 与 y=Htotal 的四角，朝外偏移 0.3m）。
- 选择变化 / 几何编辑 → `refreshSelection()` + `clearAnalysis()`。

### 3D 点面选择
- renderer 画布 `pointerdown`/`pointerup`：位移 < 4px 视为单击（拖拽照常 OrbitControls 旋转）。
- 单击 → `THREE.Raycaster.setFromCamera(ndc, camera)` → `intersectObjects(worldGroup floor meshes,true)` → 命中取 `userData.buildingId` + `point`（世界）。
- `nearestEdge(rotFootprint, point.x, point.z)` → edgeIndex；在该楼 `selectedFaces` 里 toggle（有则删、无则加；删到空允许——空 = 该楼不分析）。
- `refreshSelection()` + `clearAnalysis()`。

### 整面贴图热力图（renderAnalysis 重写）
- `clearAnalysis()` 清 analysisGroup（dispose 每 quad 的 geometry/material/material.map）+ 清报告表。
- 每个 face：
  - canvas `nu×nv`，texel(iu,iv) = `hoursColor(node.hours, T)`；`iv` 从下往上（v=0 底 → canvas 底行）。
  - `THREE.CanvasTexture`，`magFilter=THREE.LinearFilter`、`minFilter=THREE.LinearFilter`，`generateMipmaps=false` → 双线性插值连片渐变。
  - `PlaneGeometry(L, Htotal)`：默认在 XY 面，需摆到边 a→b 的竖直立面：中心 = 边中点 + 外法向×(offset)，y=Htotal/2；朝向 = 法向 (nx,nz)。用 `plane.lookAt(center + normal)` 或按边方位角设 `rotation.y`，使 quad 平面法线 = 外法向、竖直边沿 +Y。`side=DoubleSide`，`depthTest` 开。
- 点云小球逻辑删除。

### 报告表
不变（`report[].name/floors[].{floor,hours,pass}`），仅统计选中面。汇总"达标 X/Y 层"。

## 数据流

```
新建楼 → selectedFaces=[southFaceIndex]
3D 单击立面 → nearestEdge → toggle selectedFaces → refreshSelection + clearAnalysis
点「日照分析」→ 各楼选中面 facadeGrid 密网格 → accumulateHours → 每面 canvas 贴图 quad + report
几何/纬度/选择变化 → clearAnalysis（+ refreshSelection）
```

## 文件改动清单

| 文件 | 改动 |
|---|---|
| sunlight.js | 新增 southFaceIndex、nearestEdge、facadeGrid；analyzeSunlight 改按选中面网格采样，返回 faces |
| sunlight.test.js | 新增 southFaceIndex / nearestEdge / facadeGrid 测试；analyzeSunlight 测试改按 faces 断言 |
| editor2d.js | 建楼两处 footprint 后设 selectedFaces=[southFaceIndex] |
| scene.js | selectionGroup 高亮、3D 点面 raycast 选择、renderAnalysis 整面贴图重写、clearAnalysis dispose map |
| index.html | 「日照分析」区加一行提示"3D 点击立面增减分析面（默认南面）" |
| bundle.js | 重新打包 |

## 测试（node --test）

1. **southFaceIndex**
   - 正方形楼 footprint `[[-5,-5],[5,-5],[5,5],[-5,5]]`（未旋转）：南=+Z 那条边（z 较大侧，边 [5,5]→[-5,5]，外法向 +Z）返回其索引。
   - 旋转 90°：返回旋转后朝南的新边索引（外法向 .z 最大）。
2. **nearestEdge**
   - 正方形 rot，点 (0, 6)（南外侧）→ 南边索引；点 (6,0) → 东边索引。
3. **facadeGrid**
   - 正方形楼一条边、Htotal=3（单层3m）、step=1.5：nu = ceil(10/1.5)+1=8，nv = ceil(3/1.5)+1=3；节点 48 个；四角 pos 正确、朝外偏移；floor 全 0。
   - 两层（各3m，Htotal=6）：nv = ceil(6/1.5)+1=5；上排 v≈6 → floor=1，下排 floor=0（按累计层高落层）。
4. **analyzeSunlight（注入 THREE 桩）**
   - 单楼默认南面（selectedFaces 未设 → 惰性南面）：返回 faces 长度=1，face.nodes 全带 hours；无遮挡→report 各层 pass（大寒 T=2）。
   - selectedFaces=[] → faces 空、report 空。
5. **accumulateHours / buildReport**：已有测试复用（节点结构兼容，无需改）。

## 非目标（YAGNI）

- 立面窗洞级建模（仍整面网格）。
- 2D 编辑器里选面（只做 3D 点面 + 默认南面）。
- 热力图图例/色标 UI（用固定红黄绿）。
- 网格步长/时间步的 UI 调节（固定默认常量）。
- 地面开敞空间热力图。
