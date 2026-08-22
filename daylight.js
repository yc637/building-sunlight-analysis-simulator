// 多边形质心（顶点均值，纯函数，无 THREE 依赖）
export function polygonCentroid(footprint) {
  let x = 0, z = 0;
  for (const [px, pz] of footprint) { x += px; z += pz; }
  return { x: x / footprint.length, z: z / footprint.length };
}

const DAY = 0xfff3c4;    // 白天：暖亮楼色（albedo），实际明暗交给真实太阳光+阴影贴图
const NIGHT = 0x0a0a0a;  // 太阳落山后：黑色底色

// 楼面着色：太阳落山（altitude<=0）→ 黑；白天 → 暖亮楼色。
// 不再逐层平色覆盖——由场景的平行光 + 阴影贴图自然分明暗（朝阳面亮、背阴/被挡处暗）。
export function refreshFloorColors({ THREE, worldGroup, sunDir, altitude }) {
  const night = altitude <= 0;
  for (const mesh of worldGroup.children) {
    if (mesh.userData?.kind !== 'floor') continue;
    mesh.material.color.setHex(night ? NIGHT : DAY);
    mesh.userData.lit = !night;
  }
}
