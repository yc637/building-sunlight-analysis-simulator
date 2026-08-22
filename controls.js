export function dateToDayOfYear(year, month, day) {
  const start = Date.UTC(year, 0, 1);
  const cur = Date.UTC(year, month - 1, day);
  return Math.floor((cur - start) / 86400000) + 1;
}

export function initControls({ container, state, onChange }) {
  container.innerHTML = `
    <div class="row"><label id="c-lat-l">纬度 ${state.lat}°</label>
      <button class="nudge" data-t="c-lat" data-d="-0.1" style="padding:2px 6px">−</button>
      <input id="c-lat" type="range" min="-66" max="66" step="0.1" value="${state.lat}">
      <button class="nudge" data-t="c-lat" data-d="0.1" style="padding:2px 6px">＋</button></div>
    <div class="row"><label id="c-lon-l">经度 ${state.lon}°</label>
      <button class="nudge" data-t="c-lon" data-d="-0.1" style="padding:2px 6px">−</button>
      <input id="c-lon" type="range" min="-180" max="180" step="0.1" value="${state.lon}">
      <button class="nudge" data-t="c-lon" data-d="0.1" style="padding:2px 6px">＋</button></div>
    <div class="row"><label>日期</label>
      <input id="c-date" type="date" value="2026-12-21"></div>
    <div class="row"><label id="c-time-l">时间 ${state.time}h</label>
      <button class="nudge" data-t="c-time" data-d="-0.1" style="padding:2px 6px">−</button>
      <input id="c-time" type="range" min="0" max="24" step="0.1" value="${state.time}">
      <button class="nudge" data-t="c-time" data-d="0.1" style="padding:2px 6px">＋</button></div>
    <div class="row" style="gap:3px">
      <button id="c-winter" style="padding:4px 6px">冬至</button>
      <button id="c-equinox" style="padding:4px 6px">春/秋分</button>
      <button id="c-summer" style="padding:4px 6px">夏至</button>
      <select id="c-speed" style="margin-left:auto;padding:3px 4px" title="播放速度">
        <option value="0.1">0.1×</option>
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
        <option value="8">8×</option>
      </select>
      <button id="c-play" style="padding:4px 8px">▶ 播放</button>
    </div>
  `;
  const $ = (id) => container.querySelector(id);

  // 时区中央经线按经度自动推断（每 15° 一个时区），无需手动填
  state.tzMeridian = Math.round(state.lon / 15) * 15;

  function syncDate() {
    const [y, m, d] = $('#c-date').value.split('-').map(Number);
    state.dayOfYear = dateToDayOfYear(y, m, d);
  }
  syncDate();

  $('#c-lat').oninput = (e) => { state.lat = +e.target.value; $('#c-lat-l').textContent = '纬度 ' + e.target.value + '°'; onChange(); };
  $('#c-lon').oninput = (e) => { state.lon = +e.target.value; state.tzMeridian = Math.round(state.lon / 15) * 15; $('#c-lon-l').textContent = '经度 ' + e.target.value + '°'; onChange(); };
  $('#c-date').oninput = () => { syncDate(); clearSeason(); onChange(); };
  $('#c-time').oninput = (e) => { state.time = +e.target.value; $('#c-time-l').textContent = '时间 ' + e.target.value + 'h'; onChange(); };

  const seasonBtns = ['c-winter', 'c-equinox', 'c-summer'];
  function setSeason(active) {
    for (const k of seasonBtns) $('#' + k).classList.toggle('active', k === active);
  }
  function clearSeason() { setSeason(null); }
  const setDate = (v) => { $('#c-date').value = v; syncDate(); onChange(); };
  $('#c-winter').onclick = () => { setDate('2026-12-21'); setSeason('c-winter'); };
  $('#c-equinox').onclick = () => { setDate('2026-03-21'); setSeason('c-equinox'); };
  $('#c-summer').onclick = () => { setDate('2026-06-21'); setSeason('c-summer'); };
  $('#c-play').onclick = () => {
    state.playing = !state.playing;
    $('#c-play').textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
  };
  $('#c-speed').onchange = (e) => { state.playSpeed = parseFloat(e.target.value) || 1; };

  // 微调按钮：改滑块值并触发 input 事件（带真实 event，oninput 里能用 e.target）
  container.querySelectorAll('.nudge').forEach((btn) => {
    btn.onclick = () => {
      const slider = $('#' + btn.dataset.t);
      const d = parseFloat(btn.dataset.d);
      slider.value = Math.max(+slider.min, Math.min(+slider.max, (+slider.value + d)));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
  });
}
