import { rotateFootprint } from './viewport.js';

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

// 楼名文字 → 朝向相机的 Sprite（canvas 贴图）
function makeLabelSprite(text, THREE) {
  const pad = 12, font = 44;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `bold ${font}px sans-serif`;
  const tw = Math.ceil(measure.measureText(text).width);
  const cv = document.createElement('canvas');
  cv.width = tw + pad * 2; cv.height = font + pad * 2;
  const g = cv.getContext('2d');
  // 圆角底 + 白字，保证任意背景可读
  g.fillStyle = 'rgba(43,95,138,0.92)';
  const r = 10, w = cv.width, h = cv.height;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r);
  g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.font = `bold ${font}px sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 20;
  const scale = 6; // 世界高度（米）
  sp.scale.set(scale * (w / h), scale, 1);
  return sp;
}

// 多边形楼底 [[x,z],...] → 每层一个 Mesh（沿 Y 堆叠）
export function buildFloorMeshes(building, THREE) {
  const rot = rotateFootprint(building.footprint, building.rotation || 0);
  const shape = new THREE.Shape();
  const pts = rot.map(([x, z]) => [x, -z]).reverse();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
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

    // 楼层分隔线：每层顶面沿楼底轮廓的浅灰实线
    const topY = base + h;
    const linePts = rot.map(([x, z]) => [x, topY, z]).flat();
    linePts.push(linePts[0], linePts[1], linePts[2]); // 闭合
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xcdd2d6, transparent: true, opacity: 0.9 })
    );
    line.userData = { kind: 'floor-line', buildingId: building.id, floor: i };
    meshes.push(line);

    base += h;
  }

  // 楼名标签：楼中心正上方，随相机朝向
  const name = building.name || (String(building.id).slice(-4) + '号');
  const cx = rot.reduce((a, p) => a + p[0], 0) / rot.length;
  const cz = rot.reduce((a, p) => a + p[1], 0) / rot.length;
  const label = makeLabelSprite(name, THREE);
  label.position.set(cx, base + 4, cz);
  label.userData = { kind: 'label', buildingId: building.id };
  meshes.push(label);

  return meshes;
}

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
