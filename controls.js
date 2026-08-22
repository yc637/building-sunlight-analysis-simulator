import { t, onLangChange } from './i18n.js';

export function dateToDayOfYear(year, month, day) {
  const start = Date.UTC(year, 0, 1);
  const cur = Date.UTC(year, month - 1, day);
  return Math.floor((cur - start) / 86400000) + 1;
}

export function initControls({ container, state, onChange }) {
  let curDate = '2026-12-21';
  let season = null;
  const $ = (id) => container.querySelector(id);

  const fmt = (v) => String(Math.round(v * 100) / 100); // 去浮点噪声，最多 2 位小数
  function render() {
    container.innerHTML = `
      <div class="row"><label id="c-lat-l">${t('ctl.lat')} ${fmt(state.lat)}°</label>
        <button class="nudge" data-t="c-lat" data-d="-0.1" style="padding:2px 6px">−</button>
        <input id="c-lat" type="range" min="-66" max="66" step="0.1" value="${state.lat}">
        <button class="nudge" data-t="c-lat" data-d="0.1" style="padding:2px 6px">＋</button></div>
      <div class="row"><label id="c-lon-l">${t('ctl.lon')} ${fmt(state.lon)}°</label>
        <button class="nudge" data-t="c-lon" data-d="-0.1" style="padding:2px 6px">−</button>
        <input id="c-lon" type="range" min="-180" max="180" step="0.1" value="${state.lon}">
        <button class="nudge" data-t="c-lon" data-d="0.1" style="padding:2px 6px">＋</button></div>
      <div class="row"><label>${t('ctl.date')}</label>
        <input id="c-date" type="date" value="${curDate}"></div>
      <div class="row" style="gap:4px;align-items:stretch">
        <button id="c-winter" style="flex:1;min-width:0;padding:4px 2px;font-size:11px;white-space:nowrap;height:26px">${t('ctl.winter')}</button>
        <button id="c-equinox" style="flex:1;min-width:0;padding:4px 2px;font-size:11px;white-space:nowrap;height:26px">${t('ctl.equinox')}</button>
        <button id="c-summer" style="flex:1;min-width:0;padding:4px 2px;font-size:11px;white-space:nowrap;height:26px">${t('ctl.summer')}</button>
      </div>
      <div class="row"><label id="c-time-l">${t('ctl.time')} ${state.time}h</label>
        <button class="nudge" data-t="c-time" data-d="-0.1" style="padding:2px 6px">−</button>
        <input id="c-time" type="range" min="0" max="24" step="0.1" value="${state.time}">
        <button class="nudge" data-t="c-time" data-d="0.1" style="padding:2px 6px">＋</button></div>
      <div class="row" style="gap:4px;align-items:stretch">
        <select id="c-speed" style="flex:1;min-width:0;padding:3px 4px;height:26px" title="${t('ctl.speed')}">
          <option value="0.1">0.1×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
          <option value="8">8×</option>
        </select>
        <button id="c-play" style="flex:1;min-width:0;padding:4px 8px;white-space:nowrap;height:26px">${state.playing ? t('ctl.pause') : t('ctl.play')}</button>
      </div>
    `;
    $('#c-speed').value = String(state.playSpeed || 1);
    wire();
  }

  function syncDate() {
    const [y, m, d] = $('#c-date').value.split('-').map(Number);
    state.dayOfYear = dateToDayOfYear(y, m, d);
  }

  function setSeason(active) {
    season = active;
    for (const k of ['c-winter', 'c-equinox', 'c-summer']) $('#' + k).classList.toggle('active', k === active);
  }
  function clearSeason() { setSeason(null); }
  const setDate = (v) => { curDate = v; $('#c-date').value = v; syncDate(); onChange(); };

  function wire() {
    state.tzMeridian = Math.round(state.lon / 15) * 15;
    syncDate();
    $('#c-lat').oninput = (e) => { state.lat = +e.target.value; $('#c-lat-l').textContent = t('ctl.lat') + ' ' + e.target.value + '°'; onChange(); };
    $('#c-lon').oninput = (e) => { state.lon = +e.target.value; state.tzMeridian = Math.round(state.lon / 15) * 15; $('#c-lon-l').textContent = t('ctl.lon') + ' ' + e.target.value + '°'; onChange(); };
    $('#c-date').oninput = () => { curDate = $('#c-date').value; syncDate(); clearSeason(); onChange(); };
    $('#c-time').oninput = (e) => { state.time = +e.target.value; $('#c-time-l').textContent = t('ctl.time') + ' ' + e.target.value + 'h'; onChange(); };
    $('#c-winter').onclick = () => { setDate('2026-12-21'); setSeason('c-winter'); };
    $('#c-equinox').onclick = () => { setDate('2026-03-21'); setSeason('c-equinox'); };
    $('#c-summer').onclick = () => { setDate('2026-06-21'); setSeason('c-summer'); };
    $('#c-play').onclick = () => {
      state.playing = !state.playing;
      $('#c-play').textContent = state.playing ? t('ctl.pause') : t('ctl.play');
    };
    $('#c-speed').onchange = (e) => { state.playSpeed = parseFloat(e.target.value) || 1; };
    container.querySelectorAll('.nudge').forEach((btn) => {
      btn.onclick = () => {
        const slider = $('#' + btn.dataset.t);
        const d = parseFloat(btn.dataset.d);
        slider.value = Math.max(+slider.min, Math.min(+slider.max, (+slider.value + d)));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      };
    });
  }

  render();
  onLangChange(() => { render(); if (season) setSeason(season); });
}
