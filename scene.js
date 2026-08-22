import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { sunPosition } from './solar.js';
import { buildFloorMeshes, buildWallMeshes, floorHeights } from './geometry.js';
import { initEditor2d } from './editor2d.js';
import { initControls } from './controls.js';
import { refreshFloorColors } from './daylight.js';
import { initLists } from './lists.js';
import { geoPointsToWorld, serializeState, deserializeState, rotateFootprint } from './viewport.js';
import { alertModal } from './modal.js';
import { t, getLang, setLang, toggleLang, onLangChange, applyStatic } from './i18n.js';
import { analyzeSunlightProgressive, southFaceIndex, nearestEdge } from './sunlight.js';

export const state = {
  buildings: [],
  walls: [],
  lat: 40, lon: 116, tzMeridian: 120,
  dayOfYear: 355, time: 12, playing: false, playSpeed: 1,
  boundaryPoly: null,   // 地理范围多边形（世界米）[[x,z],...]
  bg: null,             // 底图 { img, worldX, worldZ, mpp }，2D/3D 共享
  bgLocked: false,      // 底图锁定：锁后拖拽/缩放不动底图
};

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
camera.position.set(80, 80, 120);
const controls = new OrbitControls(camera, canvas);
controls.minPolarAngle = 0.05;          // 不转到正上顶
controls.maxPolarAngle = Math.PI / 2 - 0.05;  // 相机不低于地面，不底朝天

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshStandardMaterial({ color: 0x9ccc65 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// 消除立面自阴影摩尔纹（shadow acne）竖条纹
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
const sc = sun.shadow.camera;
sc.left = -200; sc.right = 200; sc.top = 200; sc.bottom = -200;
sc.near = 1; sc.far = 1000;
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// 3D 场景地理范围多边形（红虚线，地面之上）
const boundaryGroup = new THREE.Group();
boundaryGroup.renderOrder = 10;
scene.add(boundaryGroup);
export function updateBoundary3d(THREE) {
  while (boundaryGroup.children.length) {
    const c = boundaryGroup.children.pop();
    c.geometry?.dispose?.(); boundaryGroup.remove(c);
  }
  if (!state.boundaryPoly?.length) return;
  const poly = state.boundaryPoly;
  // 填充：三角扇，世界坐标 [x, 0.05, z]，与线框完全对齐
  const verts = [];
  for (let i = 1; i < poly.length - 1; i++) {
    verts.push(poly[0][0], 0.05, poly[0][1], poly[i][0], 0.05, poly[i][1], poly[i + 1][0], 0.05, poly[i + 1][1]);
  }
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const fill = new THREE.Mesh(
    fillGeo,
    new THREE.MeshBasicMaterial({ color: 0xd32f2f, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })
  );
  boundaryGroup.add(fill);
  const lineGeo = new THREE.BufferGeometry();
  const pts = poly.map(([x, z]) => [x, 0.1, z]).flat();
  pts.push(pts[0], pts[1], pts[2]); // 闭合
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: 0xd32f2f, transparent: true, opacity: 0.9 })
  );
  boundaryGroup.add(line);
}

const SUN_DIST = 400;
// 太阳方位指示线：从太阳位置指向原点（显示光从哪来）
let sunRay = null;
function makeSunRay(THREE) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,0,0,0], 3));
  sunRay = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.9 }));
  scene.add(sunRay);
}
export function updateSun() {
  const { dir, altitude } = sunPosition(state);
  sun.visible = altitude > 0;
  sun.position.set(dir.x * SUN_DIST, dir.y * SUN_DIST, dir.z * SUN_DIST);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
  // 指示线：太阳位置 → 原点（地面），显示光照方向
  if (sunRay) {
    const tip = new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(60);
    const attr = sunRay.geometry.attributes.position;
    attr.setXYZ(0, sun.position.x, 20, sun.position.z);
    attr.setXYZ(1, tip.x, 0.2, tip.z);
    attr.needsUpdate = true;
    sunRay.visible = altitude > 0;
  }
}
makeSunRay(THREE);

// 供后续 Task 挂载楼/墙的容器
export const worldGroup = new THREE.Group();
scene.add(worldGroup);

// 日照分析热力图容器
const analysisGroup = new THREE.Group();
scene.add(analysisGroup);
function clearAnalysis() {
  while (analysisGroup.children.length) {
    const c = analysisGroup.children.pop();
    c.geometry?.dispose?.();
    c.material?.map?.dispose?.();
    c.material?.dispose?.();
    analysisGroup.remove(c);
  }
  const rep = document.getElementById('sun-report');
  if (rep) rep.innerHTML = '';
}

// 选中立面高亮容器
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);
function facadeOf(b) { return b.selectedFaces ?? [southFaceIndex(b)]; }
function refreshSelection() {
  while (selectionGroup.children.length) {
    const c = selectionGroup.children.pop();
    c.geometry?.dispose?.(); c.material?.dispose?.(); selectionGroup.remove(c);
  }
  for (const b of state.buildings) {
    const rot = rotateFootprint(b.footprint, b.rotation || 0);
    const heights = (b.overrides ? Object.assign([], Array.from({length:b.floorCount}, (_,i)=> b.overrides[i] ?? b.floorHeight)) : Array.from({length:b.floorCount}, ()=> b.floorHeight));
    const Htotal = heights.reduce((a, h) => a + h, 0);
    for (const j of facadeOf(b)) {
      const a = rot[j], c2 = rot[(j + 1) % rot.length];
      const off = 0.3;
      const dx = c2[0]-a[0], dz = c2[1]-a[1], L = Math.hypot(dx,dz)||1;
      let nx = dz/L, nz = -dx/L;
      const cx = rot.reduce((s,p)=>s+p[0],0)/rot.length, cz = rot.reduce((s,p)=>s+p[1],0)/rot.length;
      const mx=(a[0]+c2[0])/2, mz=(a[1]+c2[1])/2;
      if (nx*(mx-cx)+nz*(mz-cz)<0){ nx=-nx; nz=-nz; }
      const ax=a[0]+nx*off, az=a[1]+nz*off, bx=c2[0]+nx*off, bz=c2[1]+nz*off;
      const pts = [ax,0,az, bx,0,bz, bx,Htotal,bz, ax,Htotal,az, ax,0,az];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2b5f8a, transparent:true, opacity:0.9 }));
      line.renderOrder = 15;
      selectionGroup.add(line);
    }
  }
}
// 日照时数(绝对小时 0..8) → 颜色，多档渐变：
// 0深红 · 0.5红 · 1橙 · 2浅黄 · 越高越深绿 · 8深绿。段内线性插值 → 平滑过渡。
const SUN_STOPS = [
  [0.0, [183, 28, 28]],   // 深红
  [0.5, [229, 57, 53]],   // 红
  [1.0, [251, 140, 0]],   // 橙
  [2.0, [255, 238, 140]], // 浅黄
  [3.5, [220, 231, 117]], // 黄绿
  [5.0, [156, 204, 101]], // 浅绿
  [6.5, [102, 187, 106]], // 绿
  [8.0, [46, 125, 50]],   // 深绿
];
function hoursColorRGB(h) {
  const lerp = (a, b, t) => a + (b - a) * t;
  if (h <= SUN_STOPS[0][0]) return SUN_STOPS[0][1];
  if (h >= SUN_STOPS[SUN_STOPS.length - 1][0]) return SUN_STOPS[SUN_STOPS.length - 1][1];
  for (let i = 1; i < SUN_STOPS.length; i++) {
    if (h <= SUN_STOPS[i][0]) {
      const [h0, c0] = SUN_STOPS[i - 1], [h1, c1] = SUN_STOPS[i];
      const t = (h - h0) / (h1 - h0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return SUN_STOPS[SUN_STOPS.length - 1][1];
}
function hoursColor(h) {
  const [r, g, b] = hoursColorRGB(h);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// 3D 底图：把 state.bg 的图片平铺到地面，与 2D 编辑器共享位置/尺寸
let underlay = null;
export function updateUnderlay3d(THREE) {
  if (underlay) { scene.remove(underlay); underlay.geometry?.dispose?.(); underlay.material?.map?.dispose?.(); underlay.material?.dispose?.(); underlay = null; }
  if (!state.bg) return;
  if (!state.bg.img) return;   // img 异步加载中（启动恢复），等就绪再建
  const { img, worldX, worldZ, mpp } = state.bg;
  const tex = new THREE.CanvasTexture(img);
  const w = img.width * mpp;
  const h = img.height * mpp;
  underlay = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // Lambert 受光 + 接收阴影：阳光阴影能落在底图上
    new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.9 })
  );
  underlay.rotation.x = -Math.PI / 2;
  underlay.position.set(worldX + w / 2, 0.02, worldZ + h / 2);
  underlay.receiveShadow = true;
  underlay.renderOrder = 5;
  scene.add(underlay);
}

export function rebuildWorld(THREE) {
  for (const c of [...worldGroup.children]) {
    worldGroup.remove(c);
    c.geometry?.dispose?.();
    c.material?.map?.dispose?.();   // Sprite 标签贴图
    c.material?.dispose?.();
  }
  for (const b of state.buildings) {
    for (const m of buildFloorMeshes(b, THREE)) worldGroup.add(m);
  }
  for (const w of state.walls) {
    for (const m of buildWallMeshes(w, THREE)) worldGroup.add(m);
  }
}

export function refreshDaylight(THREE) {
  const { dir, altitude } = sunPosition(state);
  refreshFloorColors({ THREE, worldGroup, sunDir: dir, altitude });
}

export let onFloorsDirty = () => {};
export function setOnFloorsDirty(fn) { onFloorsDirty = fn; }

// 把占位 onFloorsDirty 换成真实刷新
setOnFloorsDirty(() => refreshDaylight(THREE));

export function render() {
  renderer.render(scene, camera);
}

function resize() {
  const el = document.getElementById('view3d');
  const w = el.clientWidth, h = el.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// 3D 视图指南针：把世界北(−Z)/东(+X)投影到屏幕，随视角旋转
const compass = document.getElementById('compass3d');
const cctx = compass.getContext('2d');
const _o = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3();
function drawCompass3d() {
  const w = compass.width, h = compass.height, cx = w / 2, cy = h / 2, r = w / 2 - 12;
  _o.set(0, 0, 0).project(camera);
  _n.set(0, 0, -100).project(camera);   // 北
  _e.set(100, 0, 0).project(camera);    // 东
  const dir = (v) => {
    let dx = v.x - _o.x, dy = -(v.y - _o.y), l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const [nx, ny] = dir(_n), [ex, ey] = dir(_e);
  cctx.clearRect(0, 0, w, h);
  cctx.strokeStyle = 'rgba(0,0,0,0.3)';
  cctx.lineWidth = 1; cctx.beginPath(); cctx.arc(cx, cy, r, 0, Math.PI * 2); cctx.stroke();
  cctx.lineWidth = 2;
  cctx.strokeStyle = '#c62828';
  cctx.beginPath(); cctx.moveTo(cx, cy); cctx.lineTo(cx + nx * r, cy + ny * r); cctx.stroke();
  cctx.strokeStyle = '#888';
  cctx.beginPath(); cctx.moveTo(cx, cy); cctx.lineTo(cx - nx * r, cy - ny * r); cctx.stroke();
  cctx.font = 'bold 12px sans-serif'; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  cctx.fillStyle = '#c62828'; cctx.fillText(t('dir.n'), cx + nx * r * 0.8, cy + ny * r * 0.8);
  cctx.fillStyle = '#555';
  cctx.fillText(t('dir.s'), cx - nx * r * 0.8, cy - ny * r * 0.8);
  cctx.fillText(t('dir.e'), cx + ex * r * 0.8, cy + ey * r * 0.8);
  cctx.fillText(t('dir.w'), cx - ex * r * 0.8, cy - ey * r * 0.8);
}

let lastBgRef = null;
function loop() {
  controls.update();
  // 每帧校验 3D canvas 尺寸匹配 view3d，布局变化不露白
  const v3 = document.getElementById('view3d');
  if (v3 && (v3.clientWidth !== renderer.domElement.width || v3.clientHeight !== renderer.domElement.height)) {
    resize();
  }
  drawCompass3d();
  // 底图变化（拖拽/缩放/载入）→ 同步 3D 地面贴图
  if (state.bg !== lastBgRef) { lastBgRef = state.bg; updateUnderlay3d(THREE); }
  if (state.playing) {
    state.time += 0.01 * (state.playSpeed || 1);
    if (state.time > 21) state.time = 5;
    const slider = document.getElementById('c-time');
    if (slider) { slider.value = state.time; }
    const label = document.getElementById('c-time-l');
    if (label) label.textContent = t('ctl.time') + ' ' + state.time.toFixed(1) + 'h';
    updateSun();
    onFloorsDirty();
  }
  render();
  requestAnimationFrame(loop);
}
resize();

const lists = initLists({
  container: document.getElementById('lists'),
  state,
  onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); editor.redraw(); clearAnalysis(); refreshSelection(); scheduleSave(); },
  onHover: (id) => editor.setHover(id),
  pushUndo: () => editor.pushUndo(),
});

const modeBtns = ['building', 'wall', 'drag'];
function setActiveMode(m) {
  for (const k of modeBtns) {
    document.getElementById('mode-' + k).classList.toggle('active', k === m);
  }
  // 校正模式：校正按钮高亮，拖拽不高亮
  document.getElementById('calibrate-bg').classList.toggle('active', m === 'calibrate');
  // 拖拽模式：3D 左键变平移；其他模式：左键旋转
  controls.mouseButtons = m === 'drag'
    ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
}
const editor = initEditor2d({
  canvas: document.getElementById('plan2d'),
  state,
  onChange: () => { rebuildWorld(THREE); refreshDaylight(THREE); lists.render(); clearAnalysis(); refreshSelection(); scheduleSave(); },
  onModeChange: setActiveMode,   // 编辑器切模式（含校正完成自动切拖拽）→ 同步工具栏高亮
});
document.getElementById('mode-building').onclick = () => editor.setMode('building');
document.getElementById('mode-wall').onclick = () => editor.setMode('wall');
document.getElementById('mode-drag').onclick = () => editor.setMode('drag');
document.getElementById('reset-view').onclick = () => editor.resetView();
document.getElementById('load-bg').onclick = () => document.getElementById('bg-file').click();
document.getElementById('calibrate-bg').onclick = () => {
  if (!state.bg) { alertModal({ message: t('msg.loadBgFirst') }); return; }
  editor.startCalibrate();   // → mode 'calibrate' → onModeChange 高亮校正按钮
};
// 底图无极缩放：滑块 0..200 对数映射到 mpp 0.05..2（米/像素）
const bgScale = document.getElementById('bg-scale');
bgScale.oninput = () => {
  const t = +bgScale.value / 200;                    // 0..1
  const mpp = 0.05 * Math.pow(40, t);                // 0.05 .. 2.0 对数
  editor.setBgMpp(mpp);
};
const bgLockBtn = document.getElementById('bg-lock');
bgLockBtn.onclick = () => {
  state.bgLocked = !state.bgLocked;
  bgLockBtn.textContent = state.bgLocked ? t('bg.unlock') : t('bg.lock');
};
// ± 微调：滑块步进 0.1
function nudgeBg(delta) {
  bgScale.value = Math.max(0, Math.min(200, +bgScale.value + delta));
  bgScale.oninput();
}
document.getElementById('bg-inc').onclick = () => nudgeBg(0.1);
document.getElementById('bg-dec').onclick = () => nudgeBg(-0.1);
// 删除底图：仅解锁后可删
document.getElementById('bg-del').onclick = () => {
  if (!state.bg) { alertModal({ message: t('msg.noBg') }); return; }
  if (state.bgLocked) { alertModal({ message: t('msg.unlockFirst') }); return; }
  editor.clearBg();
  updateUnderlay3d(THREE);
};

// 2D 画布面板：拖动移动 + 右下角调大小 + 全屏
const planWrap = document.getElementById('plan2d-wrap');
const planHead = document.getElementById('plan2d-head');
const planResize = document.getElementById('plan2d-resize');
const planCanvas = document.getElementById('plan2d');
const topbar = document.getElementById('topbar');
const app = document.getElementById('app');
(function () {
  let dragging = false, offX, offY;
  planHead.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, select')) return;
    const r = planWrap.getBoundingClientRect();
    // fixed 定位：left/top 直接是视口像素，不受父容器/类规则影响
    planWrap.classList.remove('minimized');
    planWrap.style.position = 'fixed';
    planWrap.style.left = r.left + 'px';
    planWrap.style.top = r.top + 'px';
    planWrap.style.right = 'auto';
    planWrap.style.bottom = 'auto';
    planWrap.style.width = r.width + 'px';
    planWrap.style.height = r.height + 'px';
    dragging = true;
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = planWrap.offsetWidth, h = planWrap.offsetHeight;
    const left = Math.max(0, Math.min(window.innerWidth - w, e.clientX - offX));
    const top = Math.max(0, Math.min(window.innerHeight - h, e.clientY - offY));
    planWrap.style.left = left + 'px';
    planWrap.style.top = top + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // 四边 + 右下角把手缩放
  const edgeEls = {
    t: document.getElementById('plan2d-edge-t'),
    b: document.getElementById('plan2d-edge-b'),
    l: document.getElementById('plan2d-edge-l'),
    r: document.getElementById('plan2d-edge-r'),
  };
  let resizing = false, rsX, rsY, rw, rh, rLeft, rTop, rEdge;
  function startResize(e, edge) {
    e.stopPropagation(); e.preventDefault();
    resizing = true; rEdge = edge;
    rsX = e.clientX; rsY = e.clientY;
    // 转 fixed 定位，left/top 直接是视口像素，避免 absolute 相对 view3d 的坐标漂移
    const r = planWrap.getBoundingClientRect();
    planWrap.classList.remove('minimized');
    planWrap.style.position = 'fixed';
    planWrap.style.left = r.left + 'px';
    planWrap.style.top = r.top + 'px';
    planWrap.style.right = 'auto';
    planWrap.style.bottom = 'auto';
    planWrap.style.width = r.width + 'px';
    planWrap.style.height = r.height + 'px';
    rw = planWrap.offsetWidth; rh = planWrap.offsetHeight;
    rLeft = r.left; rTop = r.top;
  }
  planResize.addEventListener('mousedown', (e) => startResize(e, 'se'));
  for (const [k, el] of Object.entries(edgeEls)) {
    el.addEventListener('mousedown', (e) => startResize(e, k));
  }
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const MINW = 320, MINH = 240;
    let w = rw, h = rh, left = rLeft, top = rTop;
    if (rEdge === 'r' || rEdge === 'se') w = Math.max(MINW, Math.min(window.innerWidth - rLeft, rw + (e.clientX - rsX)));
    if (rEdge === 'l') { w = Math.max(MINW, rw - (e.clientX - rsX)); left = Math.max(0, Math.min(rLeft + rw - MINW, rLeft + (e.clientX - rsX))); }
    if (rEdge === 'b' || rEdge === 'se') h = Math.max(MINH, Math.min(window.innerHeight - rTop, rh + (e.clientY - rsY)));
    if (rEdge === 't') { h = Math.max(MINH, rh - (e.clientY - rsY)); top = Math.max(0, Math.min(rTop + rh - MINH, rTop + (e.clientY - rsY))); }
    planWrap.style.width = w + 'px';
    planWrap.style.height = h + 'px';
    planWrap.style.left = left + 'px';
    planWrap.style.top = top + 'px';
    if (!planWrap.classList.contains('fullscreen')) applyPlanResize();
  });
  window.addEventListener('mouseup', () => { resizing = false; });

  function applyPlanResize() {
    const w = planWrap.clientWidth;
    const topExtra = topbar.parentElement === planWrap ? topbar.offsetHeight : 0;
    const h = planWrap.clientHeight - planHead.offsetHeight - topExtra;
    planCanvas.width = w; planCanvas.height = h;
    editor.resizeCanvas(w, h);
  }

  const minBtn = document.getElementById('minimize-plan');
  // 首次进入默认展开（不是最小化）
  if (planWrap.classList.contains('minimized')) minBtn.textContent = t('plan.title');
  minBtn.onclick = () => {
    const min = planWrap.classList.toggle('minimized');
    minBtn.textContent = min ? t('plan.title') : '—';
    if (min) {
      planWrap.classList.remove('fullscreen');
      // 清掉拖动/缩放/全屏的 inline 残留，让 CSS .minimized 的 top/right 定位生效
      planWrap.style.removeProperty('width');
      planWrap.style.removeProperty('height');
      planWrap.style.removeProperty('left');
      planWrap.style.removeProperty('top');
      planWrap.style.removeProperty('right');
      planWrap.style.removeProperty('bottom');
      planWrap.style.position = '';
    }
  };

  const fsBtn = document.getElementById('fullscreen-plan');
  fsBtn.onclick = () => {
    planWrap.classList.remove('minimized');
    minBtn.textContent = '—';
    const fs = planWrap.classList.toggle('fullscreen');
    fsBtn.textContent = fs ? t('plan.restore') : t('plan.fullscreen');
    // 全屏：JS 直接钉死 fixed 定位 + 视口尺寸，不依赖 CSS 类被覆盖
    planWrap.style.position = 'fixed';
    if (fs) {
      planWrap.style.left = '0'; planWrap.style.top = '0';
      planWrap.style.right = '0'; planWrap.style.bottom = '0';
      planWrap.style.width = '100vw'; planWrap.style.height = '100vh';
      // 顶部工具栏移入 2D 编辑器面板顶部（全屏盖住了原工具栏）
      planWrap.insertBefore(topbar, planHead);
    } else {
      // 还原：清所有 inline 定位/尺寸，回 CSS absolute 默认（3D 视图右上角）
      planWrap.style.removeProperty('left'); planWrap.style.removeProperty('top');
      planWrap.style.removeProperty('right'); planWrap.style.removeProperty('bottom');
      planWrap.style.removeProperty('width'); planWrap.style.removeProperty('height');
      planWrap.style.position = '';
      // 工具栏移回原处
      app.insertBefore(topbar, app.firstChild);
    }
    applyPlanResize();
  };
  window.addEventListener('resize', () => { if (planWrap.classList.contains('fullscreen')) applyPlanResize(); });
})();
document.getElementById('bg-file').onchange = (e) => {
  const f = e.target.files[0];
  if (f) {
    editor.loadImage(f);
    // 底图默认 mpp=0.5，同步滑块
    setTimeout(() => { bgScale.value = Math.round(Math.log(0.5 / 0.05) / Math.log(40) * 200); }, 100);
  }
  e.target.value = '';
};
document.getElementById('draw-geo').onclick = () => {
  const pts = document.getElementById('geo-points').value
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,\s]+/).map(Number))
    .filter((a) => a.length >= 2 && !a.slice(0, 2).some(Number.isNaN))
    .map(([lat, lon]) => ({ lat, lon }));
  if (pts.length < 3) {
    alertModal({ message: t('geo.tooFew') });
    return;
  }
  const g = geoPointsToWorld(pts);
  state.boundaryPoly = g.world;
  updateBoundary3d(THREE);
  // 用范围中心经纬度更新太阳模型 + 控件
  state.lat = g.midLat;
  state.lon = g.midLon;
  state.tzMeridian = Math.round(g.midLon / 15) * 15;
  const latSlider = document.getElementById('c-lat');
  const latVal = document.getElementById('c-lat-l');
  const lonSlider = document.getElementById('c-lon');
  const lonVal = document.getElementById('c-lon-l');
  if (latSlider) latSlider.value = g.midLat;
  if (latVal) latVal.textContent = t('ctl.lat') + ' ' + g.midLat.toFixed(1) + '°';
  if (lonSlider) lonSlider.value = g.midLon;
  if (lonVal) lonVal.textContent = t('ctl.lon') + ' ' + g.midLon.toFixed(1) + '°';
  updateSun();
  refreshDaylight(THREE);
  editor.fitToBoundary();
};
rebuildWorld(THREE);
refreshDaylight(THREE);

initControls({
  container: document.getElementById('controls'),
  state,
  onChange: () => { updateSun(); refreshDaylight(THREE); clearAnalysis(); scheduleSave(); },
});

// 自动保存：改动 800ms 后写 localStorage（防抖，避免频繁序列化）
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { localStorage.setItem('daylight-state', serializeState(state)); } catch (e) {}
  }, 800);
}

// 播放/暂停由底部太阳时间轴驱动；这里不再需要独立 play 按钮
// （若后续加回来，把 state.playing 切换放这里）

// 保存/导出/导入
function applyLoadedState(s) {
  // 覆盖 state（保留引用），重建一切
  Object.assign(state, s, { playing: false });
  if (state.bg?.imgSrc) {          // 重建底图 Image
    const img = new Image();
    img.onload = () => { state.bg.img = img; updateUnderlay3d(THREE); };
    img.src = state.bg.imgSrc;
    delete state.bg.imgSrc;
  }
  updateBoundary3d(THREE);
  updateSun();
  rebuildWorld(THREE);
  refreshDaylight(THREE);
  clearAnalysis();
  refreshSelection();
  editor.redraw();
  lists.render();
  editor.fitToBoundary();
}
document.getElementById('save-local').onclick = () => {
  try { localStorage.setItem('daylight-state', serializeState(state)); alertModal({ message: t('msg.saved') }); }
  catch (e) { alertModal({ message: t('msg.saveFail') + ': ' + e.message }); }
};
document.getElementById('export-file').onclick = () => {
  const blob = new Blob([serializeState(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'daylight-sim.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById('import-file').onclick = () => document.getElementById('import-input').click();
document.getElementById('import-input').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { applyLoadedState(deserializeState(reader.result)); alertModal({ message: t('msg.imported') }); }
    catch (err) { alertModal({ message: t('msg.importFail') + ': ' + err.message }); }
  };
  reader.readAsText(f);
  e.target.value = '';
};
// 启动时恢复本地保存
const saved = localStorage.getItem('daylight-state');
if (saved) { try { applyLoadedState(deserializeState(saved)); } catch (e) {} }

function renderAnalysis(result) {
  clearAnalysis();
  for (const face of result.faces) {
    const { nu, nv, L, Htotal, edge, nodes } = face;
    // canvas 纹理：texel(iu,iv)，iv 从下往上 → canvas 行 (nv-1-iv)
    const cv = document.createElement('canvas');
    cv.width = nu; cv.height = nv;
    const g = cv.getContext('2d');
    const img = g.createImageData(nu, nv);
    for (const n of nodes) {
      const col = hoursColor(n.hours);
      const row = nv - 1 - n.iv;
      const idx = (row * nu + n.iu) * 4;
      img.data[idx] = (col >> 16) & 255;
      img.data[idx + 1] = (col >> 8) & 255;
      img.data[idx + 2] = col & 255;
      img.data[idx + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const geo = new THREE.PlaneGeometry(L, Htotal);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: false });
    const mesh = new THREE.Mesh(geo, mat);
    // 定位：面中心 = 边中点(已含外偏移由 edge 的法向? edge 端点未含偏移) → 加外法向偏移
    const off = 0.3;
    const mx = (edge.ax + edge.bx) / 2 + edge.nx * off;
    const mz = (edge.az + edge.bz) / 2 + edge.nz * off;
    mesh.position.set(mx, Htotal / 2, mz);
    // 朝向：plane 默认法线 +Z、宽沿 +X、高沿 +Y。需宽沿边方向、法线=外法向。
    // 边方位角 → 绕 Y 旋转，使 plane +X 对齐边(ax,az)->(bx,bz)。
    const ex = edge.bx - edge.ax, ez = edge.bz - edge.az;
    mesh.rotation.y = -Math.atan2(ez, ex);
    // 若旋转后法线背对外侧则翻 180°（保证正面朝外，DoubleSide 其实两面都渲，纹理方向靠 iu 一致即可）
    mesh.renderOrder = 12;
    analysisGroup.add(mesh);

    // 楼层分隔线：在热力图上叠画各层顶边（比 quad 略外偏 + 更高 renderOrder，不被遮挡）
    const b = state.buildings.find((x) => x.id === face.buildingId);
    if (b) {
      const lo = off + 0.02; // 比热力图略外
      const hs = floorHeights(b);
      let acc = 0;
      for (let i = 0; i < hs.length - 1; i++) { // 内部分隔线（不含地面/顶）
        acc += hs[i];
        const y = acc;
        const p1x = edge.ax + edge.nx * lo, p1z = edge.az + edge.nz * lo;
        const p2x = edge.bx + edge.nx * lo, p2z = edge.bz + edge.nz * lo;
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute([p1x, y, p1z, p2x, y, p2z], 3));
        const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x455a64, transparent: true, opacity: 0.55 }));
        line.renderOrder = 13;
        analysisGroup.add(line);
      }
    }
  }
  // 报告表（不变）
  const rep = document.getElementById('sun-report');
  let passCount = 0, total = 0, html = '';
  for (const b of result.report) {
    html += `<div style="font-weight:600;margin-top:4px">${b.name}</div>`;
    html += '<table style="width:100%;border-collapse:collapse">';
    for (const f of b.floors) {
      total++; if (f.pass) passCount++;
      const color = f.pass ? '#2e7d32' : '#c62828';
      html += `<tr style="color:${color}"><td>${t('bld.floorN', f.floor + 1)}</td><td style="text-align:right">${f.hours.toFixed(1)}h</td><td style="text-align:right">${f.pass ? '✓' : '✗'}</td></tr>`;
    }
    html += '</table>';
  }
  rep.innerHTML = total ? `<div style="margin-bottom:4px;color:#555">${t('analysis.pass', passCount, total)}</div>` + html
                        : `<div style="color:#8a909b">${t('analysis.noFace')}</div>`;
  renderLegend();
}

// 色标：0..8h 连续渐变条 + 刻度
function renderLegend() {
  const el = document.getElementById('sun-legend');
  if (!el) return;
  const n = 32;
  let stops = [];
  for (let i = 0; i <= n; i++) {
    const h = (i / n) * 8;
    const [r, g, b] = hoursColorRGB(h);
    stops.push(`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)}) ${(i / n * 100).toFixed(0)}%`);
  }
  el.innerHTML =
    `<div style="height:10px;border-radius:3px;background:linear-gradient(to right,${stops.join(',')})"></div>` +
    `<div style="display:flex;justify-content:space-between;font-size:10px;color:#8a909b;margin-top:2px">` +
    `<span>0h</span><span>2h</span><span>4h</span><span>6h</span><span>8h</span></div>`;
}

// 楼栋分区折叠切换（默认折叠，见 index.html class collapsed）
(() => {
  const t = document.getElementById('sec-lists-title');
  if (t) t.onclick = () => document.getElementById('sec-lists').classList.toggle('collapsed');
})();

// 使用说明弹窗（中/英）
const HELP_EN = `
<h2 style="margin:0 0 6px;font-size:18px">Building Sunlight Analysis Simulator · Guide</h2>
<p style="color:#8a909b;margin:0 0 14px">Draw buildings/walls in the 2D editor, see sunlight and shadows in real-time 3D, and run facade sunlight-hours analysis. Data auto-saves to your browser.</p>

<h3>① Scene bounds (right panel)</h3>
<ul>
  <li>Enter one point per line as "lat,lon" (≥3 points), then click "Draw bounds (set latitude)" to outline the site; latitude/longitude are set from the center automatically.</li>
</ul>

<h3>② Sun</h3>
<ul>
  <li>Drag sliders or use ± for <b>latitude/longitude/date/time</b>; "Winter sol. / Equinox / Summer sol." set standard days.</li>
  <li>"▶ Play" loops time (true solar time 5→21h); the dropdown sets <b>speed</b> (0.1×–8×).</li>
  <li>Buildings are warm-lit by day (sun-facing bright, shaded dark) and black after sunset. The compass (top-left) rotates with the view.</li>
</ul>

<h3>③ Building / Wall (top bar)</h3>
<ul>
  <li><b>Click to add points</b>, <b>Enter or right-click to finish</b>, <b>Backspace</b> to undo the last point.</li>
  <li>In Building mode, <b>drag on empty space</b> to quickly draw a rectangular building.</li>
  <li>A dialog asks for floor height / floor count (height accepts decimals).</li>
</ul>

<h3>④ Drag / Rotate / Settings</h3>
<ul>
  <li><b>Drag</b> mode: move buildings, walls, basemap, canvas; left button also pans the 3D view.</li>
  <li>Click a building → "Building" panel: edit name/floor height/floors, expand <b>Per-floor height</b> for individual floors, or <b>Delete</b> (with confirmation).</li>
  <li>With a building selected, drag its orange <b>rotate handle</b> to rotate it.</li>
  <li><b>Undo/Redo</b>: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) for create/delete/move/rotate.</li>
</ul>

<h3>⑤ Basemap & perspective rectification</h3>
<ul>
  <li>"Basemap" loads a satellite/site image; ± or slider to scale; "🔒 Lock" prevents accidental drag; "Delete basemap" removes it.</li>
  <li><b>Rectify</b>: for an obliquely-shot image, click "Rectify", mark 4 points, then enter their lat/lon in order; a homography reprojects it into an orthographic plan.</li>
</ul>

<h3>⑥ Sunlight analysis</h3>
<ul>
  <li>Uses the <b>date in the Sun panel</b>; accumulates facade sunlight hours in true solar time 08:00–16:00 (2h threshold).</li>
  <li>Analyzes each building's <b>south facade</b> by default; <b>click a facade in 3D</b> to add/remove faces (blue outline).</li>
  <li>Click "Analyze" (with overlay + progress bar); facades show a <b>full gradient heatmap</b> (0h red → 8h green, see the legend); the report lists per-floor hours and pass ✓/✗.</li>
  <li>"Clear heatmap" hides results; editing geometry/date clears stale results automatically.</li>
</ul>

<h3>⑦ Save / Export / Import</h3>
<ul>
  <li>Changes <b>auto-save</b> to the browser and restore on reload.</li>
  <li>"Save" stores locally; "Export" downloads JSON (basemap included); "Import" loads JSON.</li>
</ul>

<h3>⑧ 2D editor window</h3>
<ul>
  <li>Drag the title bar to move; drag edges/corner to resize; "Fullscreen" / "—" to minimize.</li>
  <li>Right-drag to pan, scroll to zoom at the cursor, "Reset view" to restore.</li>
</ul>

<p style="color:#8a909b;margin-top:14px;font-size:11px">Note: analysis is a facade-grid estimation (engineering reference). China's GB 50180 uses different time bands per standard day (Great Cold 8–16, Winter Solstice 9–15); this tool uses 8–16 uniformly.</p>
`;
const HELP_ZH = `
<h2 style="margin:0 0 6px;font-size:18px">楼房采光模拟 · 使用说明</h2>
<p style="color:#8a909b;margin:0 0 14px">在 2D 编辑器画楼/围墙，3D 实时看日照与阴影，做立面日照时数分析。数据自动保存到本地浏览器。</p>

<h3>① 场景范围（右侧面板）</h3>
<ul>
  <li>文本框每行填一个点「纬度,经度」，≥3 个点，点「画范围（并设纬度）」围出地块，并按范围中心自动设纬度/经度。</li>
</ul>

<h3>② 太阳</h3>
<ul>
  <li>拖滑块或 ± 调 <b>纬度/经度/日期/时间</b>；「冬至 / 春秋分 / 夏至」一键设标准日。</li>
  <li>「▶ 播放」让时间循环（真太阳时 5→21 点），右侧下拉调 <b>倍速</b>（0.1×–8×）。</li>
  <li>3D 楼体白天暖亮、朝阳面亮背阴面暗；太阳落山变黑。左上罗盘随视角转。</li>
</ul>

<h3>③ 画楼 / 画围墙（顶栏切换）</h3>
<ul>
  <li><b>点击加点</b>，<b>回车或右键完成</b>，<b>退格</b>撤最后一点。</li>
  <li>画楼模式下：空白处<b>按住拖拽</b>=快速画矩形楼。</li>
  <li>完成后弹窗填层高/层数（层高支持小数）。</li>
</ul>

<h3>④ 拖拽 / 旋转 / 楼设置</h3>
<ul>
  <li><b>拖拽</b>模式：拖动楼、围墙、底图、画布；3D 视图左键也变平移。</li>
  <li>单击选中楼 → 出「楼设置」：改名称/层高/层数，展开<b>逐层层高</b>可逐层设不同高度，或<b>删除</b>（弹窗确认）。</li>
  <li>选中楼后拖其顶部橙色<b>旋转把手</b>可旋转楼。</li>
  <li><b>撤销/重做</b>：Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y），覆盖新建/删除/移动/旋转。</li>
</ul>

<h3>⑤ 底图 & 透视校正</h3>
<ul>
  <li>「底图」载入卫星图/总平图，± 或滑块缩放，「🔒 锁底图」防误拖，「删除底图」移除。</li>
  <li><b>校正</b>：斜拍（非正俯视）的图，点「校正」后在图上点 4 个点，再按点序填 4 组经纬度，程序用单应矩阵重投影成正射平面图。</li>
</ul>

<h3>⑥ 日照分析</h3>
<ul>
  <li>按「太阳」面板<b>所选日期</b>，统计真太阳时 8:00–16:00 各立面日照时数（达标线 2h）。</li>
  <li>默认分析每栋楼<b>最朝南立面</b>；<b>3D 点击楼立面</b>可增/减分析面（蓝框高亮）。</li>
  <li>点「日照分析」计算（有蒙版+进度条）；立面出<b>整面渐变热力图</b>（0h 红→8h 绿，见色标条）；下方报告列每层时数与达标 ✓/✗。</li>
  <li>「清除热力图」隐藏结果。改动几何/日期后结果自动失效清空。</li>
</ul>

<h3>⑦ 保存 / 导出 / 导入</h3>
<ul>
  <li>改动<b>自动保存</b>到本地浏览器，下次打开自动恢复。</li>
  <li>「保存」手动存本地；「导出」下载 JSON（含底图）；「导入」载入 JSON。</li>
</ul>

<h3>⑧ 2D 编辑器窗口</h3>
<ul>
  <li>标题栏拖动移动，四边/右下角拖拽调大小，「全屏」「—」最小化。</li>
  <li>右键拖拽平移，滚轮以光标为中心缩放，「复位视图」还原。</li>
</ul>

<p style="color:#8a909b;margin-top:14px;font-size:11px">注：日照分析为立面网格估算（工程参考）；国标不同标准日窗口不同（大寒 8–16、冬至 9–15），本工具统一 8–16。</p>
`;
let _helpOv = null;
function buildHelp() {
  if (!_helpOv) {
    _helpOv = document.createElement('div');
    _helpOv.id = 'help-overlay';
    _helpOv.style.cssText = 'position:fixed;inset:0;z-index:210;background:rgba(42,45,51,.45);display:none;align-items:center;justify-content:center;padding:24px;';
    document.body.appendChild(_helpOv);
    _helpOv.addEventListener('mousedown', (e) => { if (e.target === _helpOv) _helpOv.style.display = 'none'; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _helpOv.style.display !== 'none') { e.stopPropagation(); _helpOv.style.display = 'none'; }
    }, true);
  }
  const okText = getLang() === 'en' ? 'Got it' : '知道了';
  _helpOv.innerHTML =
    '<div style="background:#fff;border-radius:12px;max-width:680px;width:100%;max-height:86vh;overflow:auto;padding:22px 26px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:13px/1.7 -apple-system,sans-serif;color:#2a2d33">' +
    (getLang() === 'en' ? HELP_EN : HELP_ZH) +
    `<div style="text-align:right;margin-top:16px"><button id="help-close" style="padding:7px 18px;border:1px solid #2b5f8a;border-radius:6px;background:#2b5f8a;color:#fff;cursor:pointer;font-size:13px">${okText}</button></div></div>`;
  const box = _helpOv.firstChild;
  box.querySelector('#help-close').onclick = () => { _helpOv.style.display = 'none'; };
  box.querySelectorAll('h3').forEach((h) => { h.style.cssText = 'font-size:13px;margin:14px 0 4px;color:#2b5f8a'; });
  box.querySelectorAll('ul').forEach((u) => { u.style.cssText = 'margin:0 0 4px;padding-left:20px'; });
}
function showHelp() { buildHelp(); _helpOv.style.display = 'flex'; }
document.getElementById('help-btn').onclick = showHelp;
// 语言切换：说明打开时按新语言重建
onLangChange(() => { if (_helpOv && _helpOv.style.display !== 'none') buildHelp(); });
// 语言切换按钮
document.getElementById('lang-btn').onclick = toggleLang;
// 底图锁定按钮文字随语言（其余静态由 applyStatic 处理）
onLangChange(() => { document.getElementById('bg-lock').textContent = state.bgLocked ? t('bg.unlock') : t('bg.lock'); });

// 清除热力图（保留立面选择高亮）
document.getElementById('clear-sunlight').onclick = () => { clearAnalysis(); renderLegend(); };

// 计算蒙版 + 进度条：分析期间盖住整页、禁操作
function showProgress() {
  let ov = document.getElementById('sun-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sun-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(42,45,51,.4);display:flex;align-items:center;justify-content:center;';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:10px;padding:20px 24px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:13px sans-serif;color:#2a2d33;text-align:center">' +
      '<div id="sun-progress-title" style="margin-bottom:12px;font-weight:600"></div>' +
      '<div style="height:10px;background:#eee;border-radius:5px;overflow:hidden">' +
      '<div id="sun-progress" style="height:100%;width:0;background:#2b5f8a;transition:width .12s"></div></div>' +
      '<div id="sun-progress-pct" style="margin-top:8px;color:#8a909b">0%</div></div>';
    document.body.appendChild(ov);
  }
  document.getElementById('sun-progress-title').textContent = t('analysis.computing'); // 每次按当前语言
  ov.style.display = 'flex';
  setProgress(0);
}
function setProgress(f) {
  const p = Math.round(f * 100);
  const bar = document.getElementById('sun-progress');
  const pct = document.getElementById('sun-progress-pct');
  if (bar) bar.style.width = p + '%';
  if (pct) pct.textContent = p + '%';
}
function hideProgress() { const ov = document.getElementById('sun-overlay'); if (ov) ov.style.display = 'none'; }

document.getElementById('run-sunlight').onclick = async () => {
  if (!state.buildings.length) { alertModal({ message: t('analysis.needBuilding') }); return; }
  const dayOfYear = state.dayOfYear;   // 恒按太阳面板所选日期；达标线 2h
  const threshold = 2;
  showProgress();
  await new Promise((r) => setTimeout(r, 30)); // 让蒙版先绘出（setTimeout：后台标签也可靠触发）
  worldGroup.updateMatrixWorld(true);
  const occluderMeshes = worldGroup.children.filter(
    (m) => m.userData?.kind === 'floor' || m.userData?.kind === 'wall'
  );
  try {
    const result = await analyzeSunlightProgressive({
      buildings: state.buildings, occluderMeshes, THREE,
      latDeg: state.lat, dayOfYear, threshold,
      step: 0.8,           // 立面采样步长（米）
      onProgress: setProgress,
    });
    renderAnalysis(result);
  } finally {
    hideProgress();
  }
};

// 3D 单击立面 → toggle 该楼 selectedFaces（拖拽仍旋转视角）
let _pickDown = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) _pickDown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !_pickDown) return;
  const moved = Math.hypot(e.clientX - _pickDown.x, e.clientY - _pickDown.y);
  _pickDown = null;
  if (moved >= 4) return; // 拖拽=旋转，不拾取
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  worldGroup.updateMatrixWorld(true);
  const floors = worldGroup.children.filter((m) => m.userData?.kind === 'floor');
  const hits = rc.intersectObjects(floors, true);
  if (!hits.length) return;
  const bid = hits[0].object.userData.buildingId;
  const b = state.buildings.find((x) => x.id === bid);
  if (!b) return;
  const rot = rotateFootprint(b.footprint, b.rotation || 0);
  const p = hits[0].point;
  const edge = nearestEdge(rot, p.x, p.z);
  const sel = (b.selectedFaces ?? [southFaceIndex(b)]).slice();
  const at = sel.indexOf(edge);
  if (at >= 0) sel.splice(at, 1); else sel.push(edge);
  b.selectedFaces = sel;
  refreshSelection();
  clearAnalysis();
});

refreshSelection();
renderLegend();   // 色标常显（不依赖是否已跑分析）
updateSun();
loop();
// 应用存储的语言（含首次静态翻译 + 通知各模块按语言重渲染）
setLang(getLang());

// 供后续 Task 复用
export { scene, camera, THREE };
