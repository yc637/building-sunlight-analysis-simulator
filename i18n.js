// 极简 i18n：中英词典 + t(key) + setLang + 订阅重渲染，语言存 localStorage。
const DICT = {
  zh: {
    title: '采光模拟',
    'mode.building': '画楼', 'mode.wall': '画围墙', 'mode.drag': '拖拽',
    'bg.load': '底图', 'bg.rectify': '校正', 'bg.lock': '🔒 锁底图', 'bg.unlock': '🔓 解锁底图', 'bg.del': '删除底图',
    'view.reset': '复位视图', help: '📖 说明', save: '保存', export: '导出', import: '导入',
    'plan.title': '2D 编辑器', 'plan.hint': '点击加点 · 回车/右键完成 · 长按右键拖拽 · 退格撤销',
    'plan.fullscreen': '全屏', 'plan.restore': '还原',
    'sec.bounds': '场景范围', 'geo.ph': '每行一个点：纬度,经度\n39.9100, 116.3900\n39.9100, 116.4050\n39.9200, 116.4050',
    'geo.draw': '画范围（并设纬度）',
    'sec.sun': '太阳', 'sec.analysis': '日照分析', 'sec.buildings': '楼栋',
    'analysis.hint1': '按「太阳」面板所选日期，统计真太阳时 8:00–16:00 各立面日照时数（达标线 2h）。',
    'analysis.hint2': '3D 点击楼立面可增减分析面（默认南面）。',
    'analysis.run': '日照分析', 'analysis.clear': '清除热力图', 'analysis.computing': '日照分析计算中…',
    'analysis.needBuilding': '请先画楼', 'analysis.noFace': '无选中立面（3D 点击楼立面选择）',
    'analysis.pass': (p, t) => `达标 ${p}/${t} 层`,
    // 太阳控件
    'ctl.lat': '纬度', 'ctl.lon': '经度', 'ctl.date': '日期', 'ctl.time': '时间',
    'ctl.winter': '冬至', 'ctl.equinox': '春/秋分', 'ctl.summer': '夏至',
    'ctl.play': '▶ 播放', 'ctl.pause': '⏸ 暂停', 'ctl.speed': '播放速度',
    // 列表
    'list.buildings': '楼', 'list.walls': '围墙', 'list.fh': '层高', 'list.fc': '层数',
    'list.h': '高', 'list.t': '厚', 'list.del': '删',
    // 楼/墙设置
    'bld.title': '楼设置', 'bld.name': '名称', 'bld.fh': '层高', 'bld.fc': '层数',
    'bld.perFloor': '逐层层高', 'bld.floorN': (n) => `第${n}层`, 'bld.del': '删除', 'bld.close': '取消选中',
    'wall.title': '围墙设置', 'wall.h': '墙高', 'wall.t': '墙厚',
    // 弹窗
    'dlg.newBld': '新建楼', 'dlg.newRect': '新建矩形楼', 'dlg.newWall': '新建围墙',
    'dlg.fhM': '层高(米)', 'dlg.fc': '层数', 'dlg.whM': '墙高(米)', 'dlg.wtM': '墙厚(米)',
    'dlg.cancel': '取消', 'dlg.ok': '确定', 'dlg.delete': '删除',
    'dlg.delBld': '删除楼栋', 'dlg.delBldMsg': (n) => `确定删除「${n}」？`,
    'dlg.delWall': '删除围墙', 'dlg.delWallMsg': '确定删除该围墙？',
    'dlg.calibN': (k) => `标定点 ${k}/4`, 'dlg.lat': '纬度', 'dlg.lon': '经度',
    'dlg.coordsTitle': '输入 4 点经纬度（按点序 1-4，每行：纬度,经度）',
    'dlg.calibFail': '校正失败', 'dlg.calibFailMsg': '4 点退化（多点共线），请重新标定',
    'dlg.coordsBad': '输入不完整', 'dlg.coordsBadMsg': '需 4 行，每行：纬度,经度',
    'msg.noBg': '当前没有底图', 'msg.unlockFirst': '请先解锁底图，才能删除', 'msg.loadBgFirst': '请先载入底图',
    'msg.saved': '已保存到本地', 'msg.imported': '已导入', 'msg.saveFail': '保存失败', 'msg.importFail': '导入失败',
    'geo.tooFew': '至少 3 个点（每行：纬度,经度）才能围成面',
    label: (s, step) => `比例 ${s.toFixed(1)} px/m · 网格 ${step}m`,
    floorTag: (n, cnt, h) => `${n} ${cnt}层×${h}m`.trim(),
    nameFallback: (id) => id.slice(-4) + '号',
    nameDefault: (i) => i + '号',
    langBtn: 'EN',
  },
  en: {
    title: 'Sunlight Sim',
    'mode.building': 'Building', 'mode.wall': 'Wall', 'mode.drag': 'Drag',
    'bg.load': 'Basemap', 'bg.rectify': 'Rectify', 'bg.lock': '🔒 Lock', 'bg.unlock': '🔓 Unlock', 'bg.del': 'Delete basemap',
    'view.reset': 'Reset view', help: '📖 Help', save: 'Save', export: 'Export', import: 'Import',
    'plan.title': '2D Editor', 'plan.hint': 'Click to add · Enter/right-click to finish · hold right-drag to pan · Backspace to undo',
    'plan.fullscreen': 'Fullscreen', 'plan.restore': 'Restore',
    'sec.bounds': 'Scene bounds', 'geo.ph': 'One point per line: lat,lon\n39.9100, 116.3900\n39.9100, 116.4050\n39.9200, 116.4050',
    'geo.draw': 'Draw bounds (set latitude)',
    'sec.sun': 'Sun', 'sec.analysis': 'Sunlight analysis', 'sec.buildings': 'Buildings',
    'analysis.hint1': 'Uses the date in the Sun panel; accumulates facade sunlight hours in true solar time 08:00–16:00 (2h threshold).',
    'analysis.hint2': 'Click a building facade in 3D to add/remove analysis faces (south by default).',
    'analysis.run': 'Analyze', 'analysis.clear': 'Clear heatmap', 'analysis.computing': 'Computing sunlight…',
    'analysis.needBuilding': 'Draw a building first', 'analysis.noFace': 'No facade selected (click a building facade in 3D)',
    'analysis.pass': (p, t) => `${p}/${t} floors pass`,
    'ctl.lat': 'Lat', 'ctl.lon': 'Lon', 'ctl.date': 'Date', 'ctl.time': 'Time',
    'ctl.winter': 'Winter sol.', 'ctl.equinox': 'Equinox', 'ctl.summer': 'Summer sol.',
    'ctl.play': '▶ Play', 'ctl.pause': '⏸ Pause', 'ctl.speed': 'Playback speed',
    'list.buildings': 'Buildings', 'list.walls': 'Walls', 'list.fh': 'Fl.H', 'list.fc': 'Floors',
    'list.h': 'H', 'list.t': 'T', 'list.del': 'Del',
    'bld.title': 'Building', 'bld.name': 'Name', 'bld.fh': 'Fl. height', 'bld.fc': 'Floors',
    'bld.perFloor': 'Per-floor height', 'bld.floorN': (n) => `Floor ${n}`, 'bld.del': 'Delete', 'bld.close': 'Deselect',
    'wall.title': 'Wall', 'wall.h': 'Height', 'wall.t': 'Thickness',
    'dlg.newBld': 'New building', 'dlg.newRect': 'New rectangular building', 'dlg.newWall': 'New wall',
    'dlg.fhM': 'Floor height (m)', 'dlg.fc': 'Floors', 'dlg.whM': 'Wall height (m)', 'dlg.wtM': 'Wall thickness (m)',
    'dlg.cancel': 'Cancel', 'dlg.ok': 'OK', 'dlg.delete': 'Delete',
    'dlg.delBld': 'Delete building', 'dlg.delBldMsg': (n) => `Delete "${n}"?`,
    'dlg.delWall': 'Delete wall', 'dlg.delWallMsg': 'Delete this wall?',
    'dlg.calibN': (k) => `Control point ${k}/4`, 'dlg.lat': 'Latitude', 'dlg.lon': 'Longitude',
    'dlg.coordsTitle': 'Enter lat/lon for 4 points (order 1–4, one per line: lat,lon)',
    'dlg.calibFail': 'Rectification failed', 'dlg.calibFailMsg': '4 points are degenerate (collinear); please re-mark',
    'dlg.coordsBad': 'Incomplete input', 'dlg.coordsBadMsg': 'Need 4 lines, each: lat,lon',
    'msg.noBg': 'No basemap loaded', 'msg.unlockFirst': 'Unlock the basemap before deleting', 'msg.loadBgFirst': 'Load a basemap first',
    'msg.saved': 'Saved locally', 'msg.imported': 'Imported', 'msg.saveFail': 'Save failed', 'msg.importFail': 'Import failed',
    'geo.tooFew': 'At least 3 points (each line: lat,lon) are needed',
    label: (s, step) => `Scale ${s.toFixed(1)} px/m · Grid ${step}m`,
    floorTag: (n, cnt, h) => `${n} ${cnt}F×${h}m`.trim(),
    nameFallback: (id) => 'No.' + id.slice(-4),
    nameDefault: (i) => 'No.' + i,
    langBtn: '中',
  },
};

let lang = 'zh';
try { const s = localStorage.getItem('daylight-lang'); if (s === 'zh' || s === 'en') lang = s; } catch (e) {}
const subs = [];

export function t(key, ...args) {
  const v = (DICT[lang] && DICT[lang][key]) ?? (DICT.zh[key]);
  return typeof v === 'function' ? v(...args) : (v ?? key);
}
export function getLang() { return lang; }
export function setLang(l) {
  if (l !== 'zh' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem('daylight-lang', l); } catch (e) {}
  document.documentElement.lang = l === 'zh' ? 'zh' : 'en';
  applyStatic();
  subs.forEach((fn) => { try { fn(); } catch (e) {} });
}
export function toggleLang() { setLang(lang === 'zh' ? 'en' : 'zh'); }
export function onLangChange(fn) { subs.push(fn); }

// 应用静态 HTML：data-i18n=文本，data-i18n-ph=placeholder
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
}
