// Геометрия карты. Всё детерминировано: одинаковый /api/state -> одинаковая
// картинка, иначе маркеры прыгали бы на каждом опросе.

export const VIEW = 800;
export const CENTER = { x: VIEW / 2, y: VIEW / 2 };
export const MOON_R = 340;

// Углы зон подобраны вручную, чтобы области не наезжали друг на друга.
const ZONE_ANGLE = {
  tranquillitatis: -68,
  copernicus: 8,
  procellarum: 78,
  shackleton: 158,
  farside: 232,
};

// Радиус области: чем дальше зона, тем ближе к краю диска.
const radiusFor = (distance) => 105 + distance * 2.1;

export const ZONE_R = 74;

export function zonePos(zone) {
  const a = ((ZONE_ANGLE[zone.id] ?? 0) * Math.PI) / 180;
  const r = Math.min(radiusFor(zone.distance), MOON_R - ZONE_R - 12);
  return { x: CENTER.x + r * Math.cos(a), y: CENTER.y + r * Math.sin(a) };
}

/** Заказы раскладываются по кругу внутри своей зоны — по индексу, без рандома. */
export function orderPos(zone, index, total) {
  const c = zonePos(zone);
  if (total === 1) return c;
  const a = (index / total) * Math.PI * 2 - Math.PI / 2;
  const r = ZONE_R * 0.52;
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

export function riskColor(risk) {
  if (risk < 0.15) return '#4ade80';
  if (risk < 0.3) return '#facc15';
  return '#f87171';
}

export function batteryColor(battery) {
  if (battery > 60) return '#4ade80';
  if (battery > 25) return '#facc15';
  return '#f87171';
}

// Кратеры — чистая декорация, поэтому просто фиксированный список.
export const CRATERS = [
  { cx: 300, cy: 250, r: 46 }, { cx: 520, cy: 300, r: 30 }, { cx: 430, cy: 520, r: 54 },
  { cx: 250, cy: 470, r: 26 }, { cx: 600, cy: 470, r: 38 }, { cx: 360, cy: 360, r: 18 },
  { cx: 560, cy: 590, r: 22 }, { cx: 210, cy: 360, r: 15 }, { cx: 470, cy: 200, r: 20 },
  { cx: 640, cy: 380, r: 14 }, { cx: 330, cy: 610, r: 17 }, { cx: 500, cy: 420, r: 12 },
];

/** Сутки для показа: пока партия идёт — текущие, после финала — прожитые.
 *  Победа наступает ровно в 00:00 восьмых суток, и «8 / 7» в шапке читалось бы
 *  как ошибка счётчика, хотя прожито ровно семь. */
export function daysLived({ day, hour, status }) {
  if (status === 'running') return day;
  return hour === 0 ? day - 1 : day;
}
