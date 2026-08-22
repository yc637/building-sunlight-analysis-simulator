import test from 'node:test';
import assert from 'node:assert';
import { facadeSamplePoints, solarTimeSteps, accumulateHours, buildReport } from './sunlight.js';
import { analyzeSunlight } from './sunlight.js';
import { southFaceIndex, nearestEdge, facadeGrid } from './sunlight.js';

// 10×10 正方形单层楼，层高3
const sqBuilding = {
  id: 'b1', name: '1号',
  footprint: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
  floorHeight: 3, floorCount: 1, overrides: {},
};

test('facadeSamplePoints: 单层每边3点共12点，y=层中高1.5', () => {
  const pts = facadeSamplePoints(sqBuilding);
  assert.strictEqual(pts.length, 12);  // 每边 floor(10/3)=3
  pts.forEach((p) => assert.ok(Math.abs(p.pos[1] - 1.5) < 1e-9, `y ${p.pos[1]}`));
  pts.forEach((p) => assert.strictEqual(p.floor, 0));
});

test('facadeSamplePoints: 点在墙外（离质心>5，含偏移）', () => {
  const pts = facadeSamplePoints(sqBuilding);
  pts.forEach((p) => {
    const d = Math.hypot(p.pos[0], p.pos[2]); // 质心在原点
    assert.ok(d > 5, `dist ${d}`);            // 边中点到质心5，偏移后>5
  });
});

test('facadeSamplePoints: 两层点数×2，第二层 y=4.5', () => {
  const b = { ...sqBuilding, floorCount: 2 };
  const pts = facadeSamplePoints(b);
  assert.strictEqual(pts.length, 24);
  assert.ok(pts.some((p) => Math.abs(p.pos[1] - 4.5) < 1e-9));
});

test('solarTimeSteps(8,16,5): 长度97，首8末16，步5/60', () => {
  const s = solarTimeSteps(8, 16, 5);
  assert.strictEqual(s.length, 97);
  assert.strictEqual(s[0], 8);
  assert.ok(Math.abs(s[s.length - 1] - 16) < 1e-9);
  assert.ok(Math.abs((s[1] - s[0]) - 5 / 60) < 1e-9);
});

test('accumulateHours: 全亮→满窗口时数', () => {
  const pts = [{ pos: [0, 0, 0], buildingId: 'b1', floor: 0, edgeIndex: 0 }];
  const dirs = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  const out = accumulateHours(pts, dirs, () => true, 5);
  assert.ok(Math.abs(out[0].hours - 3 * 5 / 60) < 1e-9, `h ${out[0].hours}`);
});

test('accumulateHours: 全暗→0；半数亮→半时数', () => {
  const pts = [{ pos: [0, 0, 0], buildingId: 'b1', floor: 0, edgeIndex: 0 }];
  const dirs = [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  assert.strictEqual(accumulateHours(pts, dirs, () => false, 5)[0].hours, 0);
  let i = 0;
  const half = accumulateHours(pts, dirs, () => (i++ % 2 === 0), 5);
  assert.ok(Math.abs(half[0].hours - 2 * 5 / 60) < 1e-9, `h ${half[0].hours}`);
});

test('buildReport: 层 hours 取点最大值，pass 按阈值', () => {
  const pts = [
    { buildingId: 'b1', floor: 0, hours: 1.0 },
    { buildingId: 'b1', floor: 0, hours: 2.3 },
    { buildingId: 'b1', floor: 1, hours: 0.5 },
  ];
  const rep = buildReport(pts, 2, { b1: '1号' });
  assert.strictEqual(rep.length, 1);
  assert.strictEqual(rep[0].name, '1号');
  assert.deepStrictEqual(rep[0].floors[0], { floor: 0, hours: 2.3, pass: true });
  assert.deepStrictEqual(rep[0].floors[1], { floor: 1, hours: 0.5, pass: false });
});

function fakeTHREE(hit) {
  return {
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
      normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; } },
    Raycaster: class { set() {} intersectObjects() { return hit ? [{}] : []; } },
  };
}

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
