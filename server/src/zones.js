// Зоны — статичные константы, в базе не хранятся: они не меняются по ходу игры,
// а заказы ссылаются на них по zone_id.
//
//   distance     — условные километры от базы, влияет на время доставки
//   risk_factor  — вероятность происшествия в пути, 0..0.5
//   speed_factor — множитель скорости ровера в зоне (рельеф, освещённость)

export const ZONES = [
  { id: 'tranquillitatis', name: 'Море Спокойствия', distance: 12, risk_factor: 0.05, speed_factor: 1.2 },
  { id: 'copernicus', name: 'Кратер Коперник', distance: 28, risk_factor: 0.15, speed_factor: 1.0 },
  { id: 'procellarum', name: 'Океан Бурь', distance: 60, risk_factor: 0.22, speed_factor: 1.1 },
  { id: 'shackleton', name: 'Кратер Шеклтон', distance: 45, risk_factor: 0.3, speed_factor: 0.85 },
  { id: 'farside', name: 'Обратная сторона', distance: 95, risk_factor: 0.45, speed_factor: 0.7 },
];

export const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
