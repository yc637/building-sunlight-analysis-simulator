import { confirmModal } from './modal.js';

export function initLists({ container, state, onChange, onHover, pushUndo = () => {} }) {
  function render() {
    const b = state.buildings.map((x) => `
      <div class="row" data-hover-b="${x.id}">
        <input data-id="${x.id}" data-name type="text" value="${x.name || (x.id.slice(-4) + '号')}" style="width:70px">
        层高<input data-id="${x.id}" data-k="floorHeight" type="number" step="any" value="${x.floorHeight}" style="width:46px">
        层数<input data-id="${x.id}" data-k="floorCount" type="number" value="${x.floorCount}" style="width:40px">
        <button data-del-b="${x.id}">删</button>
      </div>`).join('');
    const w = state.walls.map((x) => `
      <div class="row">
        墙 ${x.id.slice(-4)}
        高<input data-id="${x.id}" data-wk="height" type="number" step="0.1" value="${x.height}" style="width:50px">
        厚<input data-id="${x.id}" data-wk="thickness" type="number" step="0.1" value="${x.thickness}" style="width:50px">
        <button data-del-w="${x.id}">删</button>
      </div>`).join('');
    container.innerHTML = `<h4>楼</h4>${b}<h4>围墙</h4>${w}`;

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
        if (!await confirmModal({ title: '删除楼栋', message: `确定删除「${b?.name || '该楼'}」？` })) return;
        pushUndo();
        state.buildings = state.buildings.filter((z) => z.id !== el.dataset.delB);
        onChange(); render();
      };
    });
    container.querySelectorAll('button[data-del-w]').forEach((el) => {
      el.onclick = async () => {
        if (!await confirmModal({ title: '删除围墙', message: '确定删除该围墙？' })) return;
        pushUndo();
        state.walls = state.walls.filter((z) => z.id !== el.dataset.delW);
        onChange(); render();
      };
    });
  }
  render();
  return { render };
}
