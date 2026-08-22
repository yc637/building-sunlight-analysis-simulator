import {
  worldToPx, pxToWorld, zoomAt, gridStepMeters, fitView, polyBBox, pointSegDist,
  pointInPolygon, buildingCenter, resizeImageMpp, imageBounds, translateImage, rotateFootprint,
  geoPointsToWorld,
} from './viewport.js';
import { solveHomography, applyHomography } from './homography.js';
import { promptModal, alertModal, confirmModal } from './modal.js';
import { t, onLangChange } from './i18n.js';

export function initEditor2d({ canvas, state, onChange, onModeChange = () => {} }) {
  const ctx = canvas.getContext('2d');
  // 撤销/重做：快照楼/墙/范围的 JSON（新建/删除/移动/旋转前 pushUndo）
  let undoStack = [], redoStack = [];
  function snapshot() { return JSON.stringify({ b: state.buildings, w: state.walls, p: state.boundaryPoly }); }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; }
  function restore(s) { const o = JSON.parse(s); state.buildings = o.b; state.walls = o.w; state.boundaryPoly = o.p; }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot()); restore(undoStack.pop());
    clearSel(); onChange(); draw();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot()); restore(redoStack.pop());
    clearSel(); onChange(); draw();
  }
  let gestureSnap = null; // 拖拽/旋转手势开始时的快照，mouseup 时若发生变动则入栈
  let mode = 'building';                 // 'building' | 'wall' | 'drag' | 'calibrate'
  let pts = [];                          // 正在绘制的点 [{x,z}]（世界米）
  let view = { scale: 3, offX: canvas.width / 2, offY: canvas.height / 2 };
  let bg = null;                         // { img, worldX, worldZ, mpp }
  // 底图写回 state.bg，供 3D 场景同步显示
  function syncBg() { state.bg = bg; }
  let hover = null;                      // 悬停的 building id
  let selected = null;                   // 选中的 building id（null=无）
  let selWall = null;                    // 选中的 wall id（null=无）
  let calibPts = [];                    // [{px, py, lat, lon}] 透视校正标定点，跨模式保留
  function resetCalib() { calibPts = []; }
  const cursorFor = (m) => (m === 'drag' ? 'default' : 'crosshair');

  // 切模式不清标定点：'calibrate' 下加点，切到 'drag' 可拖拽，标定点保留直到够 4 个
  function setMode(m) { mode = m; pts = []; clearSel(); canvas.style.cursor = cursorFor(m); draw(); onModeChange(m); }
  function clearSel() {
    selected = null; selWall = null;
    if (selPanel) selPanel.style.display = 'none';
    if (wallPanel) wallPanel.style.display = 'none';
  }
  function resetView() {
    view = { scale: 3, offX: canvas.width / 2, offY: canvas.height / 2 };
    draw();
  }
  function fitToBoundary() {
    if (!state.boundaryPoly?.length) return;
    view = fitView(canvas.width, canvas.height, polyBBox(state.boundaryPoly), 0.15);
    draw();
  }

  // 选中的楼设置面板
  const selPanel = document.createElement('div');
  selPanel.id = 'bld-settings';
  selPanel.style.cssText =
    'position:absolute;top:8px;right:8px;background:#fff;border:1px solid #e6e4de;' +
    'padding:10px;font:12px sans-serif;display:none;z-index:5;border-radius:8px;width:200px;' +
    'box-shadow:0 6px 24px rgba(42,45,51,.18);color:#2a2d33;';
  selPanel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px" data-i18n="bld.title">楼设置</div>
    <div style="display:flex;gap:4px;align-items:center;margin:6px 0">
      <label style="flex:0 0 40px;color:#8a909b" data-i18n="bld.name">名称</label>
      <input id="bld-name" type="text" style="flex:1;padding:4px 6px;border:1px solid #e6e4de;border-radius:4px;font-size:12px">
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin:6px 0">
      <label style="flex:0 0 40px;color:#8a909b" data-i18n="bld.fh">层高</label>
      <input id="bld-h" type="number" step="any" style="flex:1;padding:4px 6px;border:1px solid #e6e4de;border-radius:4px;font-size:12px;min-width:0">
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin:6px 0">
      <label style="flex:0 0 40px;color:#8a909b" data-i18n="bld.fc">层数</label>
      <input id="bld-n" type="number" style="flex:1;padding:4px 6px;border:1px solid #e6e4de;border-radius:4px;font-size:12px;min-width:0">
    </div>
    <div style="margin:8px 0 4px">
      <div id="bld-floors-toggle" style="cursor:pointer;color:#2b5f8a;user-select:none">▸ ${t('bld.perFloor')}</div>
      <div id="bld-floors" style="display:none;max-height:150px;overflow:auto;margin-top:4px"></div>
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
      <button id="bld-del" style="padding:5px 12px;border:1px solid #e6e4de;border-radius:4px;background:#fff;color:#b3261e;cursor:pointer;font-size:12px" data-i18n="bld.del">删除</button>
      <button id="bld-close" style="padding:5px 12px;border:1px solid #2b5f8a;border-radius:4px;background:#2b5f8a;color:#fff;cursor:pointer;font-size:12px" data-i18n="bld.close">取消选中</button>
    </div>`;
  // 逐层层高展开切换
  selPanel.querySelector('#bld-floors-toggle').onclick = () => {
    const d = selPanel.querySelector('#bld-floors');
    const open = d.style.display === 'none';
    d.style.display = open ? 'block' : 'none';
    selPanel.querySelector('#bld-floors-toggle').textContent = (open ? '▾ ' : '▸ ') + t('bld.perFloor');
  };
  selPanel.querySelector('#bld-close').onclick = () => clearSel();
  selPanel.querySelector('#bld-del').onclick = async () => {
    if (!selected) return;
    const b = state.buildings.find((x) => x.id === selected);
    const nm = b?.name || t('nameFallback', selected);
    if (!await confirmModal({ title: t('dlg.delBld'), message: t('dlg.delBldMsg', nm) })) return;
    pushUndo();
    state.buildings = state.buildings.filter((x) => x.id !== selected);
    clearSel();
    onChange();   // 重建 3D + 刷新列表
    draw();
  };
  canvas.parentElement.appendChild(selPanel);

  // 选中的围墙设置面板
  const wallPanel = document.createElement('div');
  wallPanel.id = 'wall-settings';
  wallPanel.style.cssText = selPanel.style.cssText; // 同款样式
  wallPanel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px" data-i18n="wall.title">围墙设置</div>
    <div style="display:flex;gap:4px;align-items:center;margin:6px 0">
      <label style="flex:0 0 40px;color:#8a909b" data-i18n="wall.h">墙高</label>
      <input id="wall-h" type="number" step="any" style="flex:1;padding:4px 6px;border:1px solid #e6e4de;border-radius:4px;font-size:12px;min-width:0">
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin:6px 0">
      <label style="flex:0 0 40px;color:#8a909b" data-i18n="wall.t">墙厚</label>
      <input id="wall-t" type="number" step="any" style="flex:1;padding:4px 6px;border:1px solid #e6e4de;border-radius:4px;font-size:12px;min-width:0">
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
      <button id="wall-del" style="padding:5px 12px;border:1px solid #e6e4de;border-radius:4px;background:#fff;color:#b3261e;cursor:pointer;font-size:12px" data-i18n="bld.del">删除</button>
      <button id="wall-close" style="padding:5px 12px;border:1px solid #2b5f8a;border-radius:4px;background:#2b5f8a;color:#fff;cursor:pointer;font-size:12px" data-i18n="bld.close">取消选中</button>
    </div>`;
  wallPanel.querySelector('#wall-close').onclick = () => clearSel();
  wallPanel.querySelector('#wall-del').onclick = async () => {
    if (!selWall) return;
    if (!await confirmModal({ title: t('dlg.delWall'), message: t('dlg.delWallMsg') })) return;
    pushUndo();
    state.walls = state.walls.filter((x) => x.id !== selWall);
    clearSel();
    onChange();
    draw();
  };
  canvas.parentElement.appendChild(wallPanel);

  function showWall(w) {
    selected = null; selPanel.style.display = 'none';   // 互斥：隐藏楼面板
    wallPanel.querySelector('#wall-h').value = w.height;
    wallPanel.querySelector('#wall-t').value = w.thickness;
    wallPanel.style.display = 'block';
    wallPanel.querySelector('#wall-h').oninput = () => {
      const h = parseFloat(wallPanel.querySelector('#wall-h').value);
      if (h > 0) { w.height = h; onChange(); }
    };
    wallPanel.querySelector('#wall-t').oninput = () => {
      const t = parseFloat(wallPanel.querySelector('#wall-t').value);
      if (t > 0) { w.thickness = t; onChange(); }
    };
  }

  // 命中围墙：真正压在墙体上（距离 ≤ 半墙厚，无额外余量）→ wall；否则 null。
  // 光标与点选共用，保证「变手」与「可点选」范围一致。
  function pickWall(wx, wz) {
    for (let i = state.walls.length - 1; i >= 0; i--) {
      const wl = state.walls[i];
      const half = (wl.thickness || 0.4) / 2;
      for (let j = 0; j < wl.path.length - 1; j++) {
        if (pointSegDist(wx, wz, wl.path[j][0], wl.path[j][1], wl.path[j + 1][0], wl.path[j + 1][1]) <= half) return wl;
      }
    }
    return null;
  }

  function showSel(b) {
    selWall = null; wallPanel.style.display = 'none';   // 互斥：隐藏墙面板
    selPanel.querySelector('#bld-name').value = b.name || '';
    selPanel.querySelector('#bld-h').value = b.floorHeight;
    selPanel.querySelector('#bld-n').value = b.floorCount;
    selPanel.style.display = 'block';
    selPanel.querySelector('#bld-name').oninput = () => {
      b.name = selPanel.querySelector('#bld-name').value;
      onChange(); draw();
    };
    selPanel.querySelector('#bld-h').oninput = () => {
      const h = parseFloat(selPanel.querySelector('#bld-h').value);
      if (h > 0) { b.floorHeight = h; onChange(); }
    };
    selPanel.querySelector('#bld-n').oninput = () => {
      const n = parseInt(selPanel.querySelector('#bld-n').value);
      if (n >= 1) { b.floorCount = n; onChange(); renderFloorRows(b); }
    };
    renderFloorRows(b);
  }

  // 逐层层高行：每层一个输入，改 b.overrides[i]（与统一层高相同则清除该项）
  function renderFloorRows(b) {
    const box = selPanel.querySelector('#bld-floors');
    if (!box) return;
    b.overrides = b.overrides || {};
    let html = '';
    for (let i = 0; i < b.floorCount; i++) {
      const v = b.overrides[i] ?? b.floorHeight;
      html += `<div style="display:flex;gap:4px;align-items:center;margin:3px 0">` +
        `<label style="flex:0 0 44px;color:#8a909b;font-size:11px">${t('bld.floorN', i + 1)}</label>` +
        `<input data-fi="${i}" type="number" step="any" value="${v}" ` +
        `style="flex:1;padding:3px 5px;border:1px solid #e6e4de;border-radius:4px;font-size:11px;min-width:0"></div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('input[data-fi]').forEach((el) => {
      el.oninput = () => {
        const i = +el.dataset.fi, h = parseFloat(el.value);
        if (!(h > 0)) return;
        if (Math.abs(h - b.floorHeight) < 1e-9) delete b.overrides[i];
        else b.overrides[i] = h;
        onChange();
      };
    });
  }

  // 旋转后的楼底（世界坐标）
  function rotatedFootprint(b) { return rotateFootprint(b.footprint, b.rotation || 0); }

  // 画布点 → 世界；命中楼判定（自底向上反向遍历让上层楼优先）
  function pickBuilding(wx, wz) {
    for (let i = state.buildings.length - 1; i >= 0; i--) {
      if (pointInPolygon(rotatedFootprint(state.buildings[i]), wx, wz)) return state.buildings[i];
    }
    return null;
  }

  // 拖拽模式下命中检测：返回 {type:'building'|'wall'|'boundary', obj}
  const HIT_R = 8 / view.scale;  // 命中半径（约 8px 换算成世界米）
  function pickDragTarget(wx, wz) {
    // 楼（顶点/边/内部都算）
    const b = pickBuilding(wx, wz);
    if (b) return { type: 'building', obj: b };
    // 墙：点到任一线段距离 < 半径
    for (let i = state.walls.length - 1; i >= 0; i--) {
      const wl = state.walls[i];
      for (let j = 0; j < wl.path.length - 1; j++) {
        const d = pointSegDist(wx, wz, wl.path[j][0], wl.path[j][1], wl.path[j + 1][0], wl.path[j + 1][1]);
        if (d < HIT_R) return { type: 'wall', obj: wl };
      }
    }
    // 范围不支持拖拽（避免误拖动场景边界）
    return null;
  }

  function drawGrid() {
    const step = gridStepMeters(view.scale);
    const tl = pxToWorld(view, 0, 0);
    const br = pxToWorld(view, canvas.width, canvas.height);
    ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1;
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      const px = worldToPx(view, x, 0).px;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
    }
    for (let z = Math.ceil(tl.z / step) * step; z <= br.z; z += step) {
      const py = worldToPx(view, 0, z).py;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
    }
    return step;
  }

  function drawBg() {
    if (!bg) return;
    const tl = worldToPx(view, bg.worldX, bg.worldZ);
    const w = bg.img.width * bg.mpp * view.scale;
    const h = bg.img.height * bg.mpp * view.scale;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(bg.img, tl.px, tl.py, w, h);
    ctx.globalAlpha = 1;
  }

  function drawBoundary() {
    if (!state.boundaryPoly?.length) return;
    ctx.save();
    ctx.strokeStyle = '#d32f2f'; ctx.fillStyle = 'rgba(211,47,47,0.06)';
    ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    state.boundaryPoly.forEach(([x, z], i) => {
      const p = worldToPx(view, x, z);
      i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py);
    });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawPolys() {
    ctx.lineWidth = 1.5;
    for (const b of state.buildings) {
      const isHover = b.id === hover, isSel = b.id === selected;
      ctx.strokeStyle = isSel ? '#c62828' : (isHover ? '#ef6c00' : '#607d8b');
      ctx.fillStyle = isSel ? 'rgba(198,40,40,0.25)' : (isHover ? 'rgba(239,108,0,0.15)' : 'rgba(96,125,139,0.2)');
      ctx.beginPath();
      rotatedFootprint(b).forEach(([x, z], i) => {
        const p = worldToPx(view, x, z);
        i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py);
      });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // 悬停/选中时标出层高·层数 + 旋转把手
      if (isHover || isSel) {
        const c = buildingCenter(b);
        const q = worldToPx(view, c.x, c.z);
        ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(t('floorTag', b.name || '', b.floorCount, b.floorHeight), q.px, q.py - 14);
        // 旋转把手（楼上方圆形白底 + 旋转箭头图标，Material "rotate_right" 风格）
        const rp = worldToPx(view, c.x, c.z);
        const hx = rp.px, hy = rp.py - 30;
        // 白底圆
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ef6c00'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hy, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 圆弧（约 290°，顶部开口），线帽圆头
        ctx.strokeStyle = '#ef6c00'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        const R = 6, start = -Math.PI / 2 - 1.15, end = -Math.PI / 2 + 3.05;
        ctx.beginPath(); ctx.arc(hx, hy, R, start, end); ctx.stroke();
        // 箭头（位于弧尾，指向切线方向）
        const a = end;
        const tip = { x: hx + R * Math.cos(a), y: hy + R * Math.sin(a) };
        const tan = { x: -Math.sin(a), y: Math.cos(a) }; // 切向（顺时针）
        const nrm = { x: Math.cos(a), y: Math.sin(a) };  // 径向外
        ctx.fillStyle = '#ef6c00';
        ctx.beginPath();
        ctx.moveTo(tip.x + tan.x * 4.2, tip.y + tan.y * 4.2);
        ctx.lineTo(tip.x + nrm.x * 2.6 - tan.x * 1.6, tip.y + nrm.y * 2.6 - tan.y * 1.6);
        ctx.lineTo(tip.x - nrm.x * 2.6 - tan.x * 1.6, tip.y - nrm.y * 2.6 - tan.y * 1.6);
        ctx.closePath(); ctx.fill();
      }
    }
    for (const wl of state.walls) {
      const isSel = wl.id === selWall;
      ctx.strokeStyle = isSel ? '#c62828' : '#8d6e63';
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.beginPath();
      wl.path.forEach(([x, z], i) => {
        const p = worldToPx(view, x, z);
        i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py);
      });
      ctx.stroke();
    }
  }

  // 橡皮筋：上一个已点 → 当前鼠标实时画线并标长度
  let mouse = null;
  function drawRubber() {
    if (mode !== 'building' && mode !== 'wall') return;
    if (!mouse || !pts.length) return;
    const last = pts[pts.length - 1];
    const cur = worldToPx(view, mouse.x, mouse.z);
    const lastPx = worldToPx(view, last.x, last.z);
    const len = Math.hypot(mouse.x - last.x, mouse.z - last.z);
    ctx.save();
    ctx.strokeStyle = '#fb8c00'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(lastPx.px, lastPx.py); ctx.lineTo(cur.px, cur.py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e65100'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(len.toFixed(1) + 'm', (lastPx.px + cur.px) / 2, (lastPx.py + cur.py) / 2 - 6);
    ctx.restore();
  }

  function drawInProgress() {
    if (!pts.length) return;
    ctx.strokeStyle = '#e53935'; ctx.fillStyle = '#e53935'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = worldToPx(view, p.x, p.z);
      i ? ctx.lineTo(q.px, q.py) : ctx.moveTo(q.px, q.py);
    });
    ctx.stroke();
    for (const p of pts) {
      const q = worldToPx(view, p.x, p.z);
      ctx.beginPath(); ctx.arc(q.px, q.py, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 屏幕固定东南西北罗盘
  function drawCompass() {
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.fillStyle = '#c62828'; ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('dir.n'), w / 2, 18);
    ctx.fillText(t('dir.s'), w / 2, h - 28);
    ctx.fillText(t('dir.e'), w - 16, h / 2);
    ctx.fillText(t('dir.w'), 16, h / 2);
    ctx.restore();
  }

  function drawLabel(step) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t('label', view.scale, step), 6, 6);
  }

  // 标定点存图像像素，绘制时按当前底图变换换算 → 锁在底图特征上（拖底图/平移/缩放都跟随）
  function calibToCanvas(p) {
    const tl = worldToPx(view, bg.worldX, bg.worldZ);
    const s = bg.mpp * view.scale;
    return { px: tl.px + p.imgX * s, py: tl.py + p.imgY * s };
  }
  // 标定点 + 序号：只要有标定点就画（跨模式可见，拖拽模式下也显示）
  function drawCalibPts() {
    if (!calibPts.length || !bg) return;
    calibPts.forEach((p, i) => {
      const { px, py } = calibToCanvas(p);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ef6c00';
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py);
    });
  }

  function drawRectPreview() {
    if (!rectStart || !rectCur) return;
    const a = worldToPx(view, rectStart.x, rectStart.z);
    const b = worldToPx(view, rectCur.x, rectCur.z);
    const x = Math.min(a.px, b.px), y = Math.min(a.py, b.py);
    const w = Math.abs(a.px - b.px), h = Math.abs(a.py - b.py);
    ctx.save();
    ctx.strokeStyle = '#e53935'; ctx.fillStyle = 'rgba(229,57,53,0.08)';
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function draw() {
    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBg();
    drawCalibPts();
    const step = drawGrid();
    drawBoundary();
    drawPolys();
    drawInProgress();
    drawRubber();
    drawRectPreview();
    drawCompass();
    drawLabel(step);
  }

  function relPx(e) {
    const r = canvas.getBoundingClientRect();
    // CSS 尺寸(rect) 与像素尺寸(attr) 可能因面板缩放失配，按比例映射到 attr 像素，杜绝漂移
    return {
      px: (e.clientX - r.left) * (canvas.width / r.width),
      py: (e.clientY - r.top) * (canvas.height / r.height),
    };
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = relPx(e);
    const w = pxToWorld(view, p.px, p.py);
    mouse = w;
    if (mode === 'drag') {
      // 拖拽模式：悬停对象 → grab 光标
      const t = pickDragTarget(w.x, w.z);
      canvas.style.cursor = t ? 'grab' : 'default';
      draw();
      return;
    }
    // 悬停检测（仅未在连点画时）：悬到楼/墙（可点选，不可画点）→ 手形光标
    if (!pts.length) {
      const hit = pickBuilding(w.x, w.z);
      const h = hit ? hit.id : null;
      if (h !== hover) { hover = h; draw(); }
      if (mode !== 'calibrate') {
        const over = hit || pickWall(w.x, w.z);   // 楼内部或压在墙体上才变手形（与点选一致）
        canvas.style.cursor = over ? 'pointer' : cursorFor(mode);
      }
    }
    draw();
  });
  canvas.addEventListener('mouseleave', () => { mouse = null; hover = null; canvas.style.cursor = 'crosshair'; draw(); });

  // 左键：单击不拖 → 楼上=选中、空白=加点；按住拖 → 底图(在图上)或画布(其他)平移
  let lDown = null;               // {px,py} 画布像素
  let moved = false;
  let draggingImage = false;      // 本次按下是否拖底图
  let dragTarget = null;          // {type, obj} 拖拽模式下的目标
  let dragStartWorld = null;      // 拖拽起点世界坐标
  let rectStart = null;           // 画楼模式按住拖矩形：起点世界点
  let rectCur = null;             // 当前对角点（世界）
  let rotating = null;            // 旋转中的楼对象 + 起始角度
  const DRAG_THRESH = 4;          // 像素，超过视为拖动
  function wAt(px, py) { return pxToWorld(view, px, py); }
  function rotateHandleScreen(b) {
    const c = buildingCenter(b);
    const q = worldToPx(view, c.x, c.z);
    return { x: q.px, y: q.py - 30 };
  }
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const p = relPx(e);
    lDown = p; moved = false; dragTarget = null; rotating = null; gestureSnap = null;
    if (mode === 'calibrate') { lDown = p; draggingImage = false; rectStart = null; rectCur = null; return; }
    const w = wAt(p.px, p.py);
    // 旋转把手：选中楼时，点击楼上方旋转图标 → 进入旋转（任何模式下，含拖拽）
    if (selected) {
      const b = state.buildings.find((x) => x.id === selected);
      if (b) {
        const h = rotateHandleScreen(b);
        if (Math.hypot(p.px - h.x, p.py - h.y) <= 12) {
          rotating = { b, startAngle: Math.atan2(p.px - h.x, -(p.py - h.y)) };
          gestureSnap = snapshot();   // 旋转前快照
          return;
        }
      }
    }
    if (mode === 'drag') {
      // 拖拽模式：命中楼/墙 → 拖该对象；否则落到底图/画布拖拽
      dragTarget = pickDragTarget(w.x, w.z);
      dragStartWorld = w;
      if (dragTarget) { gestureSnap = snapshot(); return; }   // 拖对象前快照
      // 未命中对象：按底图/画布逻辑处理（范围不拦截）
    }
    if (mode === 'building' && pts.length === 0) {
      // 画楼（未开始连线）：按住拖 = 画矩形
      rectStart = { x: Math.round(w.x), z: Math.round(w.z) };
      rectCur = rectStart;
      return;
    }
    // 若按下点在底图矩形内且未锁定 → 本次拖底图（而非画布）
    if (bg && !state.bgLocked) {
      const ib = imageBounds(bg);
      draggingImage = (w.x >= ib.minX && w.x <= ib.maxX && w.z >= ib.minZ && w.z <= ib.maxZ);
    } else {
      draggingImage = false;
    }
  });
  function translateObj(target, dx, dz) {
    if (target.type === 'building') {
      target.obj.footprint = target.obj.footprint.map(([x, z]) => [x + dx, z + dz]);
    } else if (target.type === 'wall') {
      target.obj.path = target.obj.path.map(([x, z]) => [x + dx, z + dz]);
    } else if (target.type === 'boundary') {
      state.boundaryPoly = state.boundaryPoly.map(([x, z]) => [x + dx, z + dz]);
    }
  }
  window.addEventListener('mousemove', (e) => {
    if (!lDown) return;
    const cur = relPx(e);
    if (!moved && Math.hypot(cur.px - lDown.px, cur.py - lDown.py) >= DRAG_THRESH) {
      moved = true;
    }
    if (!moved) return;
    if (rotating) {
      // 旋转：鼠标绕把手的角度变化 → 楼 rotation
      const h = rotateHandleScreen(rotating.b);
      const ang = Math.atan2(cur.px - h.x, -(cur.py - h.y));
      let deg = (ang - rotating.startAngle) * (180 / Math.PI) * 0.5; // 旋转灵敏度：0.5 = 半速
      rotating.b.rotation = Math.round(((rotating.b.rotation || 0) + deg) * 10) / 10;
      rotating.startAngle = ang;
      onChange();
      draw();
      return;
    }
    const dW = wAt(cur.px, cur.py);
    if (mode === 'building' && rectStart) {
      // 矩形预览
      rectCur = { x: Math.round(dW.x), z: Math.round(dW.z) };
      draw();
      return;
    }
    if (dragTarget) {
      // 拖拽对象：整体平移
      const dx = dW.x - dragStartWorld.x, dz = dW.z - dragStartWorld.z;
      translateObj(dragTarget, dx, dz);
      dragStartWorld = dW;
      onChange();
      draw();
      return;
    }
    const w0 = wAt(lDown.px, lDown.py);
    if (draggingImage) {
      bg = translateImage(bg, dW.x - w0.x, dW.z - w0.z);
      syncBg();
      lDown = cur; draw();
    } else {
      view = { ...view, offX: view.offX + (cur.px - lDown.px), offY: view.offY + (cur.py - lDown.py) };
      lDown = cur; draw();
    }
  });
  window.addEventListener('mouseup', () => {
    if (lDown && mode === 'building' && rectStart && moved) {
      // 矩形拖拽结束：生成矩形楼（保留 rect 预览直到弹窗关闭）
      const x1 = rectStart.x, z1 = rectStart.z;
      const x2 = rectCur.x, z2 = rectCur.z;
      lDown = null; moved = false;
      if (Math.abs(x2 - x1) > 0 && Math.abs(z2 - z1) > 0) {
        finishRect(x1, z1, x2, z2);
      } else {
        rectStart = null; rectCur = null; draw();
      }
      return;
    }
    if (lDown && !moved) {
      if (mode === 'calibrate') {
        // 只落点（不弹窗），存图像像素（拖动底图/画布时点跟随），够 4 个后统一填经纬度
        if (calibPts.length < 4 && bg) {
          const tl = worldToPx(view, bg.worldX, bg.worldZ);
          const s = bg.mpp * view.scale;
          calibPts.push({ imgX: (lDown.px - tl.px) / s, imgY: (lDown.py - tl.py) / s });
          draw();
          if (calibPts.length === 4) promptCalibCoords();
        }
        lDown = null; moved = false; dragTarget = null; dragStartWorld = null; rectStart = null; rectCur = null; rotating = null;
        return;
      }
      // 单击：命中楼 → 选中；命中围墙（未在连点画）→ 选中；否则画点/清除选中
      const w = pxToWorld(view, lDown.px, lDown.py);
      const hit = pickBuilding(w.x, w.z);
      if (hit) { selected = hit.id; hover = hit.id; showSel(hit); draw(); }
      else {
        const wl = pts.length ? null : pickWall(w.x, w.z);
        if (wl) { clearSel(); selWall = wl.id; showWall(wl); draw(); }
        else { clearSel(); if (mode !== 'drag') { pts.push({ x: Math.round(w.x), z: Math.round(w.z) }); draw(); } }
      }
    }
    // 拖对象/旋转手势结束且确实移动过 → 提交撤销快照（手势前状态）
    if (gestureSnap && moved && (dragTarget || rotating)) {
      undoStack.push(gestureSnap); if (undoStack.length > 100) undoStack.shift(); redoStack = [];
    }
    gestureSnap = null;
    lDown = null; moved = false; dragTarget = null; dragStartWorld = null; rectStart = null; rectCur = null; rotating = null;
  });

  // 滚轮缩放（以光标为中心）
  canvas.addEventListener('wheel', (e) => {
    // 忽略极小滚动（触控板单击/抖动误触发），避免画布被误缩放
    if (Math.abs(e.deltaY) < 5) return;
    e.preventDefault();
    const { px, py } = relPx(e);
    view = zoomAt(view, px, py, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    draw();
  }, { passive: false });

  // 右键：拖拽平移视图；单击不拖（画点中）→ 完成当前楼/墙
  let panning = false, panStart = null, panMoved = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { panning = true; panMoved = false; panStart = relPx(e); }
  });
  window.addEventListener('mousemove', (e) => {
    if (panning) {
      const cur = relPx(e);
      if (Math.hypot(cur.px - panStart.px, cur.py - panStart.py) >= DRAG_THRESH) panMoved = true;
      view = { ...view, offX: view.offX + (cur.px - panStart.px), offY: view.offY + (cur.py - panStart.py) };
      panStart = cur; draw();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      // 右键单击（无拖动）且正在连点画楼/墙 → 完成
      if (panning && !panMoved && pts.length && (mode === 'building' || mode === 'wall')) finish();
      panning = false;
    }
  });

  // 键盘：退格撤销点；Ctrl+Z 撤销点/操作；Ctrl+Shift+Z / Ctrl+Y 重做；Esc 取消；回车完成
  window.addEventListener('keydown', (e) => {
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && e.shiftKey) {   // 重做
      e.preventDefault(); redo(); return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Backspace' || (ctrl && e.key.toLowerCase() === 'z')) {
      e.preventDefault();
      // 正在画点/标定 → 撤最后一点；否则 Ctrl+Z 撤销一次几何操作
      if (mode === 'calibrate') { if (calibPts.length) calibPts.pop(); draw(); return; }
      if (pts.length) { pts.pop(); draw(); return; }
      if (ctrl) { undo(); return; }
      clearSel(); draw();
    } else if (e.key === 'Escape') {
      if (mode === 'calibrate') { resetCalib(); setMode('drag'); }  // 弃标定点，切拖拽
      else if (selected) clearSel(); else pts = [];
      draw();
    } else if (e.key === 'Enter') {
      finish();
    }
  });

  async function finishRect(x1, z1, x2, z2) {
    const r = await promptModal({
      title: t('dlg.newRect'),
      fields: [
        { key: 'h', label: t('dlg.fhM'), type: 'number', value: 3, step: 'any' },
        { key: 'n', label: t('dlg.fc'), type: 'number', value: 6 },
      ],
    });
    if (!r) { rectStart = null; rectCur = null; draw(); return; }
    pushUndo();
    const h = r.h || 3, n = Math.round(r.n) || 6;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    state.buildings.push({
      id: 'b' + Date.now(),
      name: t('nameDefault', state.buildings.length + 1),
      footprint: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]],
      floorHeight: h, floorCount: n, overrides: {},
    });
    rectStart = null; rectCur = null;
    draw();
    onChange();
  }

  async function finish() {
    const clean = pts.filter((p, i) =>
      i === 0 || p.x !== pts[i - 1].x || p.z !== pts[i - 1].z);
    let added = false;
    if (mode === 'building') {
      if (clean.length >= 3) {
        const r = await promptModal({
          title: t('dlg.newBld'),
          fields: [
            { key: 'h', label: t('dlg.fhM'), type: 'number', value: 3, step: 'any' },
            { key: 'n', label: t('dlg.fc'), type: 'number', value: 6 },
          ],
        });
        if (!r) { pts = []; draw(); return; }
        pushUndo();
        const h = r.h || 3, n = Math.round(r.n) || 6;
        state.buildings.push({
          id: 'b' + Date.now(),
          name: t('nameDefault', state.buildings.length + 1),
          footprint: clean.map((p) => [p.x, p.z]),
          floorHeight: h, floorCount: n, overrides: {},
        });
        added = true;
      }
    } else {
      if (clean.length >= 2) {
        const r = await promptModal({
          title: t('dlg.newWall'),
          fields: [
            { key: 'h', label: t('dlg.whM'), type: 'number', value: 2.5, step: '0.1' },
            { key: 't', label: t('dlg.wtM'), type: 'number', value: 0.4, step: '0.1' },
          ],
        });
        if (!r) { pts = []; draw(); return; }
        pushUndo();
        const h = r.h || 2.5, t = r.t || 0.4;
        state.walls.push({
          id: 'w' + Date.now(),
          path: clean.map((p) => [p.x, p.z]),
          height: h, thickness: t,
        });
        added = true;
      }
    }
    pts = []; draw();
    if (added) onChange();
  }

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      const mpp = 0.5;
      bg = { img, worldX: -(img.width * mpp) / 2, worldZ: -(img.height * mpp) / 2, mpp };
      syncBg();
      draw();
    };
    img.src = URL.createObjectURL(file);
  }

  // 进入透视校正标定：需先载入底图。已有标定点则续标（不清空），够 4 个后统一填经纬度
  function startCalibrate() {
    if (!bg) return;
    if (calibPts.length >= 4) { promptCalibCoords(); return; }  // 已选满 → 重填经纬度
    setMode('calibrate');
  }

  // 4 点选齐后，一次性填 4 组经纬度：单个 textarea，每行「纬度,经度」（与范围框一致）
  async function promptCalibCoords() {
    const preset = calibPts
      .map((p) => (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${p.lat}, ${p.lon}` : ''))
      .join('\n');
    const r = await promptModal({
      title: t('dlg.coordsTitle'),
      fields: [{
        key: 'coords', type: 'textarea', rows: 4, value: preset,
        placeholder: '39.9100, 116.3900\n39.9100, 116.4050\n39.9200, 116.4050\n39.9200, 116.3900',
      }],
    });
    if (!r) { draw(); return; }  // 取消：保留点，可再点「校正」重填
    const rows = r.coords.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => l.split(/[,\s]+/).map(Number));
    if (rows.length !== 4 || rows.some((a) => a.length < 2 || a.slice(0, 2).some(Number.isNaN))) {
      await alertModal({ title: t('dlg.coordsBad'), message: t('dlg.coordsBadMsg') });
      promptCalibCoords();
      return;
    }
    calibPts.forEach((p, i) => { p.lat = rows[i][0]; p.lon = rows[i][1]; });
    finishCalibrate();
  }

  async function finishCalibrate() {
    if (!bg) { resetCalib(); setMode('drag'); return; } // 底图被删：中止标定
    // 标定点已是图像像素，直接作 srcPts（solveHomography/applyHomography 都以图像像素为准）
    const srcPts = calibPts.map((p) => [p.imgX, p.imgY]);
    const geo = geoPointsToWorld(calibPts.map((p) => ({ lat: p.lat, lon: p.lon })));
    const H = solveHomography(srcPts, geo.world);
    if (!H) {
      await alertModal({ title: t('dlg.calibFail'), message: t('dlg.calibFailMsg') });
      resetCalib(); setMode('drag');
      return;
    }
    const bbox = polyBBox(geo.world);
    const res = applyHomography(bg.img, H, bbox, bg.img.width);
    bg = { img: res.canvas, worldX: res.worldX, worldZ: res.worldZ, mpp: res.mpp };
    syncBg();
    resetCalib();
    setMode('drag');   // 校正完成：退出标定，切回拖拽
    onChange();        // 同步 3D 底图 + 列表
    draw();
  }

  // 画布尺寸变化（拖动调大小/全屏）：同步像素属性并重算视图原点，保持世界中心不动
  function resizeCanvas(w, h) {
    canvas.width = w; canvas.height = h;
    // 重置为画布中心：保持世界原点居中，不继承旧中心漂移
    view = { ...view, offX: w / 2, offY: h / 2 };
    draw();
  }
  // 同步画布 attr 像素与 CSS 尺寸：面板缩放/展开后避免坐标漂移
  function syncCanvasSize() {
    const r = canvas.getBoundingClientRect();
    // 比较取整后的尺寸：getBoundingClientRect 可能返回小数（全屏 100vw / HiDPI），
    // 若拿小数直接和整数 canvas.width 比，会每帧判定“变化”并重置 view 中心 → 拖拽被瞬间还原
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w > 0 && (w !== canvas.width || h !== canvas.height)) {
      canvas.width = w;
      canvas.height = h;
      view = { ...view, offX: w / 2, offY: h / 2 };
    }
  }
  syncCanvasSize();

  // 底图大小调整（围绕中心，需先载入底图）
  function resizeBg(factor) {
    if (!bg || state.bgLocked) return;
    bg = resizeImageMpp(bg, factor);
    syncBg();
    draw();
  }
  function hasBg() { return !!bg; }
  // 绝对底图尺度（米/像素），围绕中心
  function setBgMpp(mpp) {
    if (!bg || state.bgLocked) return;
    bg = resizeImageMpp(bg, mpp / bg.mpp);
    syncBg();
    draw();
  }
  function clearBg() {
    resetCalib();
    if (mode === 'calibrate') setMode('drag');
    bg = null;
    state.bg = null;
    draw();
  }

  // 外部（侧栏列表）悬停某楼 → 地图高亮
  function setHover(id) { hover = id; draw(); }

  draw();
  // 语言切换：重绘（标签/楼名标注）+ 刷新已展开的逐层层高行（第N层）
  onLangChange(() => {
    if (selected) { const b = state.buildings.find((x) => x.id === selected); if (b) renderFloorRows(b); }
    draw();
  });

  return { setMode, redraw: draw, loadImage, resetView, fitToBoundary, undo, redo, pushUndo, resizeCanvas, resizeBg, setBgMpp, clearBg, setHover, hasBg, startCalibrate };
}
