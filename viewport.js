// 2D 编辑器视口：世界坐标(米) <-> canvas 像素，支持缩放+平移。
// view = { scale, offX, offY }：scale = 像素/米；(offX,offY) = 世界原点在画布上的像素位置。

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 30;

export function worldToPx(view, x, z) {
  return { px: view.offX + x * view.scale, py: view.offY + z * view.scale };
}

export function pxToWorld(view, px, py) {
  return { x: (px - view.offX) / view.scale, z: (py - view.offY) / view.scale };
}

const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

// 以光标(cx,cy)为中心缩放：缩放后光标下的世界点不变。
export function zoomAt(view, cx, cy, factor) {
  const world = pxToWorld(view, cx, cy);
  const scale = clampScale(view.scale * factor);
  return {
    scale,
    offX: cx - world.x * scale,
    offY: cy - world.z * scale,
  };
}

// 标定：底图上两点像素距对应的真实米数 → 每像素多少米。重合点返回 null。
export function metersPerPixel(p1, p2, realMeters) {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (dist === 0) return null;
  return realMeters / dist;
}

const M_PER_DEG = 111320; // 每纬度约 111.32 km

// 经纬度包围盒 → 米制边界（以中心为世界原点；北=−Z，南=+Z，东=+X，西=−X）。
export function geoBoxToWorld({ north, south, west, east }) {
  const midLat = (north + south) / 2;
  const height = (north - south) * M_PER_DEG;
  const width = (east - west) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  return {
    midLat, width, height,
    boundary: {
      minX: -width / 2, maxX: width / 2,
      minZ: -height / 2, maxZ: height / 2,
    },
  };
}

// 一组经纬度点 → 米制 XZ 多边形（以质心为原点；北=−Z，东=+X）。
export function geoPointsToWorld(points) {
  const lat0 = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lon0 = points.reduce((a, p) => a + p.lon, 0) / points.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const world = points.map((p) => [
    (p.lon - lon0) * M_PER_DEG * cosLat,   // 东=+X
    -(p.lat - lat0) * M_PER_DEG,           // 北=−Z
  ]);
  return { midLat: lat0, midLon: lon0, world, bbox: polyBBox(world) };
}

// 序列化 state：底图图片转 base64（导出/保存需内嵌，blob: URL 不能持久化）
function imgToData(bg) {
  if (!bg?.img) return bg?.imgSrc || null;
  if (typeof bg.img.toDataURL === 'function') return bg.img.toDataURL(); // 校正后的 Canvas
  // 普通 Image：src 是 blob: 临时 URL，画到 canvas 转 base64 才能随导出持久化
  try {
    const c = document.createElement('canvas');
    c.width = bg.img.naturalWidth || bg.img.width;
    c.height = bg.img.naturalHeight || bg.img.height;
    c.getContext('2d').drawImage(bg.img, 0, 0);
    return c.toDataURL();
  } catch (e) {
    return bg.img.src || bg.imgSrc || null;
  }
}
export function serializeState(s) {
  return JSON.stringify({
    ...s,
    bg: s.bg ? { ...s.bg, imgSrc: imgToData(s.bg) } : null,
  });
}

// 反序列化：解析 JSON。底图 img 由调用方（浏览器侧）用 imgSrc 重建。
export function deserializeState(json) {
  const s = JSON.parse(json);
  delete s.bg?.img;   // img 不可序列化，只保留 imgSrc
  return s;
}

// 底图世界包围盒。
export function imageBounds(bg) {
  return {
    minX: bg.worldX, maxX: bg.worldX + bg.img.width * bg.mpp,
    minZ: bg.worldZ, maxZ: bg.worldZ + bg.img.height * bg.mpp,
  };
}

// 底图平移（世界米），改锚点。
export function translateImage(bg, dWorldX, dWorldZ) {
  return { ...bg, worldX: bg.worldX + dWorldX, worldZ: bg.worldZ + dWorldZ };
}

// 底图缩放：改 mpp（米/像素），围绕图片中心，保持中心世界点不变。
export function resizeImageMpp(bg, factor) {
  const cx = bg.worldX + (bg.img.width * bg.mpp) / 2;
  const cz = bg.worldZ + (bg.img.height * bg.mpp) / 2;
  const mpp = bg.mpp * factor;
  return { ...bg, mpp, worldX: cx - (bg.img.width * mpp) / 2, worldZ: cz - (bg.img.height * mpp) / 2 };
}

// 点 (x,z) 到线段 (ax,az)-(bx,bz) 的距离（世界米）。
export function pointSegDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 === 0) return Math.hypot(x - ax, z - az);
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

// 射线法判断点(x,z)是否在多边形内。
export function pointInPolygon(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// 绕多边形质心旋转点集（度）。返回旋转后的新点集。
export function rotateFootprint(points, deg) {
  if (!deg) return points;
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cz = points.reduce((a, p) => a + p[1], 0) / points.length;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return points.map(([x, z]) => [
    cx + (x - cx) * cos - (z - cz) * sin,
    cz + (x - cx) * sin + (z - cz) * cos,
  ]);
}

// 楼底多边形质心（世界米）。
export function buildingCenter({ footprint }) {
  let x = 0, z = 0;
  for (const [px, pz] of footprint) { x += px; z += pz; }
  return { x: x / footprint.length, z: z / footprint.length };
}

// 多边形点集 [[x,z],...] 的包围盒。
export function polyBBox(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

// 计算让 boundary 在画布内居中显示的视图（margin 为四周留白比例 0..1）。
export function fitView(canvasW, canvasH, boundary, margin = 0.1) {
  const bw = boundary.maxX - boundary.minX;
  const bh = boundary.maxZ - boundary.minZ;
  const scale = Math.min((canvasW * (1 - margin)) / bw, (canvasH * (1 - margin)) / bh);
  const cx = (boundary.minX + boundary.maxX) / 2;
  const cz = (boundary.minZ + boundary.maxZ) / 2;
  return { scale, offX: canvasW / 2 - cx * scale, offY: canvasH / 2 - cz * scale };
}

// 自适应网格步长(米)：使网格线间距至少 20px，从 {1,2,5,...} 里选最小满足者。
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
export function gridStepMeters(scale) {
  for (const step of STEPS) {
    if (step * scale >= 20) return step;
  }
  return STEPS[STEPS.length - 1];
}
