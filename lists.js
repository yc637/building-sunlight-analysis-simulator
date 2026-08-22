import { confirmModal } from './modal.js';
import { t, onLangChange } from './i18n.js';

export function initLists({ container, state, onChange, onHover, pushUndo = () => {} }) {
  function render() {
    const b = state.buildings.map((x) => `
      <div class="row" data-hover-b="${x.id}">
        <input data-id="${x.id}" data-name type="text" value="${x.name || t('nameFallback', x.id)}" style="width:70px">
        ${t('list.fh')}<input data-id="${x.id}" data-k="floorHeight" type="number" step="any" value="${x.floorHeight}" style="width:46px">
        ${t('list.fc')}<input data-id="${x.id}" data-k="floorCount" type="number" value="${x.floorCount}" style="width:40px">
        <button data-del-b="${x.id}">${t('list.del')}</button>
      </div>`).join('');
    const w = state.walls.map((x) => `
      <div class="row">
        ${t('list.walls')} ${x.id.slice(-4)}
        ${t('list.h')}<input data-id="${x.id}" data-wk="height" type="number" step="0.1" value="${x.height}" style="width:50px">
        ${t('list.t')}<input data-id="${x.id}" data-wk="thickness" type="number" step="0.1" value="${x.thickness}" style="width:50px">
        <button data-del-w="${x.id}">${t('list.del')}</button>
      </div>`).join('');
    container.innerHTML = `<h4>${t('list.buildings')}</h4>${b}<h4>${t('list.walls')}</h4>${w}`;

    container.querySelectorAll('input[data-k]').forEach((el) => {
      el.oninput = () => {
        const t = state.buildings.find((z) => z.id === el.dataset.id);
        t[el.dataset.k] = +el.value;
        onChange();
      };
    });
    container.querySelectorAll('input[data-name]').forEach((el) => {
      el.oninput = () => {
        const t = state.buildings.find((z) => z.id === el.dataset.id);
        t.name = el.value;
        onChange();
      };
    });
    container.querySelectorAll('input[data-wk]').forEach((el) => {
      el.oninput = () => {
        const t = state.walls.find((z) => z.id === el.dataset.id);
        t[el.dataset.wk] = +el.value;
        onChange();
      };
    });
    // 悬停楼行 → 地图高亮
    container.querySelectorAll('[data-hover-b]').forEach((el) => {
      el.addEventListener('mouseenter', () => onHover && onHover(el.dataset.hoverB));
      el.addEventListener('mouseleave', () => onHover && onHover(null));
    });
    container.querySelectorAll('button[data-del-b]').forEach((el) => {
      el.onclick = async () => {
        const b = state.buildings.find((z) => z.id === el.dataset.delB);
        if (!await confirmModal({ title: t('dlg.delBld'), message: t('dlg.delBldMsg', b?.name || t('nameFallback', el.dataset.delB)), okText: t('dlg.delete'), cancelText: t('dlg.cancel') })) return;
        pushUndo();
        state.buildings = state.buildings.filter((z) => z.id !== el.dataset.delB);
        onChange(); render();
      };
    });
    container.querySelectorAll('button[data-del-w]').forEach((el) => {
      el.onclick = async () => {
        if (!await confirmModal({ title: t('dlg.delWall'), message: t('dlg.delWallMsg'), okText: t('dlg.delete'), cancelText: t('dlg.cancel') })) return;
        pushUndo();
        state.walls = state.walls.filter((z) => z.id !== el.dataset.delW);
        onChange(); render();
      };
    });
  }
  render();
  onLangChange(render);
  return { render };
}
