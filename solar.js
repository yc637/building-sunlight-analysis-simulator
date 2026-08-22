export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

// 赤纬（度），Cooper 公式
export function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin(deg2rad((360 * (284 + dayOfYear)) / 365));
}

// 均时差（分钟）
export function equationOfTime(dayOfYear) {
  const B = deg2rad((360 * (dayOfYear - 81)) / 365);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

// 真太阳时（小时）：时钟 + 经度修正 + 均时差
export function solarTime(clockHour, lon, tzMeridian, dayOfYear) {
  const longitudeCorrMin = (lon - tzMeridian) * 4; // 每度 4 分钟
  const eotMin = equationOfTime(dayOfYear);
  return clockHour + (longitudeCorrMin + eotMin) / 60;
}

// 时角（度）：每小时 15°，正午为 0
export function hourAngle(solarTimeHours) {
  return 15 * (solarTimeHours - 12);
}

// 高度角 + 方位角（度）。azimuth 从正南量、向西为正、向东为负。
export function altitudeAzimuth(latDeg, declDeg, hourAngleDeg) {
  const lat = deg2rad(latDeg);
  const decl = deg2rad(declDeg);
  const H = deg2rad(hourAngleDeg);
  const sinAlt =
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const altitude = rad2deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
  const azimuth = rad2deg(
    Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)
    )
  );
  return { altitude, azimuth };
}

// 完整太阳位置 + 指向太阳的单位方向向量（Three.js 坐标：y上, 北=-Z, 东=+X）
export function sunPosition({ lat, lon, tzMeridian, dayOfYear, time }) {
  const decl = solarDeclination(dayOfYear);
  const st = solarTime(time, lon, tzMeridian, dayOfYear);
  const H = hourAngle(st);
  const { altitude, azimuth } = altitudeAzimuth(lat, decl, H);
  const altR = deg2rad(altitude);
  const azR = deg2rad(azimuth); // 从正南、向西为正
  const dir = {
    x: -Math.cos(altR) * Math.sin(azR), // 西=-X，故东(负方位)得正x
    y: Math.sin(altR),
    z: Math.cos(altR) * Math.cos(azR),  // 南=+Z
  };
  return { altitude, azimuth, dir };
}

// 一天 24 个整点的高度角（度），供太阳时间轴画曲线。夜间为负值。
export function daylightCurve({ lat, lon, tzMeridian, dayOfYear }) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    out.push(sunPosition({ lat, lon, tzMeridian, dayOfYear, time: h }).altitude);
  }
  return out;
}

// 真太阳时 solarHour 的太阳方向（世界向量，北=−Z 东=+X y上）+ 高度/方位角。
// 绕过时钟/经度修正/均时差，供日照分析按真太阳时窗口采样。
export function sunDirAtSolarTime(latDeg, dayOfYear, solarHour) {
  const decl = solarDeclination(dayOfYear);
  const H = hourAngle(solarHour);
  const { altitude, azimuth } = altitudeAzimuth(latDeg, decl, H);
  const altR = deg2rad(altitude), azR = deg2rad(azimuth);
  const dir = {
    x: -Math.cos(altR) * Math.sin(azR),
    y: Math.sin(altR),
    z: Math.cos(altR) * Math.cos(azR),
  };
  return { dir, altitude, azimuth };
}
