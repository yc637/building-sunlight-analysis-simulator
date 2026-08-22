import { floorHeights } from './geometry.js';
import { rotateFootprint, pointSegDist } from './viewport.js';
import { sunDirAtSolarTime } from './solar.js';

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

// 渐进式（异步分块）分析：逐太阳时刻推进，每 chunk 步让出主线程 + 回调进度，
// 供 UI 显示进度条、避免长时间卡死。返回同 analyzeSunlight。
export async function analyzeSunlightProgressive({
  buildings, occluderMeshes, THREE,
  latDeg, dayOfYear, threshold,
  startH = 8, endH = 16, stepMin = 5, step = 1.5, offset = 0.3,
  onProgress = () => {}, chunk = 1,
}) {
  const faces = [];
  const allNodes = [];
  for (const b of buildings) {
    const sel = b.selectedFaces ?? [southFaceIndex(b)];
    for (const edgeIndex of sel) {
      const g = facadeGrid(b, edgeIndex, { step, offset });
      for (const n of g.nodes) { n.hours = 0; allNodes.push(n); }
      faces.push({ buildingId: b.id, edgeIndex, nu: g.nu, nv: g.nv, L: g.L, Htotal: g.Htotal, edge: g.edge, nodes: g.nodes });
    }
  }
  const sunDirs = solarTimeSteps(startH, endH, stepMin)
    .map((st) => sunDirAtSolarTime(latDeg, dayOfYear, st))
    .filter((s) => s.altitude > 0)
    .map((s) => s.dir);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const inc = stepMin / 60;
  const isLit = (pos, dir) => {
    origin.set(pos[0], pos[1], pos[2]);
    rayDir.set(dir.x, dir.y, dir.z).normalize();
    raycaster.set(origin, rayDir);
    return raycaster.intersectObjects(occluderMeshes, true).length === 0;
  };
  // 让出主线程 + 触发重绘：requestAnimationFrame 绑定绘制帧，进度条宽度每帧真正重绘；
  // 无 rAF 环境（如测试）退回 setTimeout。
  const yieldFrame = () => new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });
  const total = Math.max(1, sunDirs.length);
  for (let i = 0; i < sunDirs.length; i++) {
    const dir = sunDirs[i];
    for (const n of allNodes) if (isLit(n.pos, dir)) n.hours += inc;  // 原地累计（faces.nodes 同引用）
    if (i % chunk === chunk - 1 || i === sunDirs.length - 1) {
      onProgress((i + 1) / total);
      await yieldFrame();
    }
  }
  const nameById = Object.fromEntries(
    buildings.map((b) => [b.id, b.name || (String(b.id).slice(-4) + '号')])
  );
  const report = buildReport(allNodes, threshold, nameById);
  return { faces, report, threshold };
}
