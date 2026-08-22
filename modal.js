// 自定义弹窗（替换原生 prompt/alert），风格与整体 UI 一致
// 用法：
//   const v = await modal.prompt({ title, fields: [{label, key, type, value, placeholder}] });
//   // 返回 {key: value, ...}，取消返回 null
//   await modal.alert({ title, message });

import { t } from './i18n.js';

const STYLE = `
  position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center;
  background: rgba(42,45,51,0.35); font-family: inherit;`;

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

export function promptModal({ title, fields }) {
  return new Promise((resolve) => {
    const overlay = el('div', STYLE);
    const box = el('div',
      'background:#fff;border:1px solid #e6e4de;border-radius:8px;box-shadow:0 8px 30px rgba(42,45,51,.2);' +
      'width:300px;padding:16px;font-size:13px;color:#2a2d33;');
    box.appendChild(el('div', 'font-weight:600;font-size:14px;margin-bottom:12px;', title));

    const inputs = {};
    for (const f of fields) {
      if (f.type === 'textarea') {
        // 多行文本：标签在上，textarea 在下（用于批量粘贴 每行"纬度,经度"）
        const wrap = el('div', 'margin:8px 0;');
        if (f.label) wrap.appendChild(el('label', 'display:block;color:#8a909b;font-size:12px;margin-bottom:4px;', f.label));
        const ta = el('textarea', 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #e6e4de;' +
          'border-radius:4px;font:12px/1.4 ui-monospace,Menlo,monospace;background:#fff;color:#2a2d33;resize:vertical;');
        ta.rows = f.rows || 4;
        if (f.value != null) ta.value = f.value;
        if (f.placeholder) ta.placeholder = f.placeholder;
        wrap.appendChild(ta);
        box.appendChild(wrap);
        inputs[f.key] = ta;
        continue;
      }
      const row = el('div', 'display:flex;align-items:center;gap:8px;margin:8px 0;');
      row.appendChild(el('label', 'flex:0 0 64px;color:#8a909b;font-size:12px;', f.label));
      const inp = el('input', 'flex:1;padding:6px 8px;border:1px solid #e6e4de;border-radius:4px;' +
        'font-size:13px;background:#fff;color:#2a2d33;', '');
      inp.type = f.type || 'text';
      if (f.value != null) inp.value = f.value;
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.type === 'number') { inp.step = f.step || '1'; }
      row.appendChild(inp);
      box.appendChild(row);
      inputs[f.key] = inp;
    }

    const btns = el('div', 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;');
    const cancel = el('button', 'padding:6px 12px;border:1px solid #e6e4de;border-radius:4px;background:#fff;color:#2a2d33;cursor:pointer;font-size:12px;', t('dlg.cancel'));
    const ok = el('button', 'padding:6px 12px;border:1px solid #2b5f8a;border-radius:4px;background:#2b5f8a;color:#fff;cursor:pointer;font-size:12px;', t('dlg.ok'));
    btns.appendChild(cancel); btns.appendChild(ok);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    const collect = () => {
      const out = {};
      for (const f of fields) {
        let v = inputs[f.key].value;
        if (f.type === 'number') v = parseFloat(v);
        out[f.key] = v;
      }
      return out;
    };
    cancel.onclick = () => { close(); resolve(null); };
    ok.onclick = () => { const v = collect(); close(); resolve(v); };
    // Esc 取消（捕获阶段 + stopPropagation，避免触发编辑器全局 Esc）
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancel.onclick(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { close(); resolve(null); } });
    const first = inputs[fields[0] && fields[0].key];
    if (first) setTimeout(() => first.focus(), 0);
  });
}

export function alertModal({ title, message }) {
  return new Promise((resolve) => {
    const overlay = el('div', STYLE);
    const box = el('div',
      'background:#fff;border:1px solid #e6e4de;border-radius:8px;box-shadow:0 8px 30px rgba(42,45,51,.2);' +
      'width:300px;padding:16px;font-size:13px;color:#2a2d33;');
    if (title) box.appendChild(el('div', 'font-weight:600;font-size:14px;margin-bottom:8px;', title));
    box.appendChild(el('div', 'color:#2a2d33;', message));
    const btns = el('div', 'display:flex;justify-content:flex-end;margin-top:14px;');
    const ok = el('button', 'padding:6px 16px;border:1px solid #2b5f8a;border-radius:4px;background:#2b5f8a;color:#fff;cursor:pointer;font-size:12px;', t('dlg.ok'));
    btns.appendChild(ok);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(); };
    ok.onclick = done;
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(); });
  });
}

// 确认框：确定→true，取消/点外→false
export function confirmModal({ title, message, okText, cancelText, danger = true }) {
  return new Promise((resolve) => {
    const overlay = el('div', STYLE);
    const box = el('div',
      'background:#fff;border:1px solid #e6e4de;border-radius:8px;box-shadow:0 8px 30px rgba(42,45,51,.2);' +
      'width:300px;padding:16px;font-size:13px;color:#2a2d33;');
    if (title) box.appendChild(el('div', 'font-weight:600;font-size:14px;margin-bottom:8px;', title));
    if (message) box.appendChild(el('div', 'color:#2a2d33;', message));
    const btns = el('div', 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;');
    const cancel = el('button', 'padding:6px 12px;border:1px solid #e6e4de;border-radius:4px;background:#fff;color:#2a2d33;cursor:pointer;font-size:12px;', cancelText || t('dlg.cancel'));
    const okBg = danger ? '#b3261e' : '#2b5f8a';
    const ok = el('button', `padding:6px 12px;border:1px solid ${okBg};border-radius:4px;background:${okBg};color:#fff;cursor:pointer;font-size:12px;`, okText || t('dlg.delete'));
    btns.appendChild(cancel); btns.appendChild(ok);
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(false); });
  });
}
