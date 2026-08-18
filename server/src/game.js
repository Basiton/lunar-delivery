import { db } from './db.js';
import { ZONES } from './zones.js';

export const TICK_MS = 3000;        // 3 секунды реального времени
export const HOURS_PER_DAY = 24;    // 24 игровых часа = лунные сутки
export const WIN_DAYS = 7;
export const WIN_CREDITS = 5000;

export const CHARGE_PER_HOUR = 10;
export const ORDER_EVERY_HOURS = 6;
export const PENALTY_EXPIRED = 10;
export const PENALTY_DECLINED = 5;

// ---------------------------------------------------------------- формулы
// Реализованы дословно по ТЗ.

export function batteryCost({ distance, risk_factor }, weight_kg, capacity_kg) {
  return distance * (1 + weight_kg / capacity_kg) * (1 + risk_factor);
}

/** Время в одну сторону. Доставка считается туда-обратно, поэтому ×2. */
export function travelHours({ distance, speed_factor }, weight_kg, capacity_kg) {
  return (distance / (10 * speed_factor)) * (1 + 0.5 * weight_kg / capacity_kg);
}

export const roundTripHours = (zone, weight_kg, capacity_kg) =>
  travelHours(zone, weight_kg, capacity_kg) * 2;

// ---------------------------------------------------------------- helpers
export const totalHours = (s) => (s.day - 1) * HOURS_PER_DAY + s.hour;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const getState = () => db.prepare('SELECT * FROM game_state WHERE id = 1').get();

export function logEvent(type, message, rover_id = null, order_id = null) {
  const s = getState();
  db.prepare(
    `INSERT INTO events (type, message, rover_id, order_id, day, hour)
     VALUES (?, ?, ?, ?, ?, ?)`).run(type, message, rover_id, order_id, s.day, s.hour);
}

function addRating(delta) {
  db.prepare(
    `UPDATE game_state SET rating = max(0, min(100, rating + ?)), updated_at = datetime('now') WHERE id = 1`)
    .run(delta);
}

function addCredits(delta) {
  db.prepare(
    `UPDATE game_state SET credits = max(0, credits + ?), updated_at = datetime('now') WHERE id = 1`)
    .run(delta);
}

// ---------------------------------------------------------------- риск
const CARGO = [
  'Партия гидропоники', 'Реголитовый бур', 'Литиевые ячейки', 'Ремкомплект шлюза',
  'Ящик с электроникой', 'Запас воды', 'Скафандры', 'Пробы грунта',
  'Термоизоляция', 'Антенный модуль', 'Продовольствие', 'Фильтры CO₂',
];

const HEAVY_CARGO = [
  'Секция жилого купола', 'Реактор РИТЭГ', 'Буровая платформа',
  'Резервуар для воды', 'Посадочная опора',
];

/**
 * Бросок при старте доставки. При risk_factor > 0.3 в пул добавляется поломка.
 * Возвращает описание происшествия либо null.
 */
export function rollRisk(zone, rover, order, delivery_id) {
  if (Math.random() >= zone.risk_factor) return null;

  const outcomes = ['battery', 'delay'];
  if (zone.risk_factor > 0.3) outcomes.push('breakdown');
  const outcome = pick(outcomes);

  if (outcome === 'battery') {
    db.prepare(
      `UPDATE rovers SET battery = max(0, battery - 20), updated_at = datetime('now') WHERE id = ?`)
      .run(rover.id);
    logEvent('risk_battery',
      `«${rover.name}» повредил солнечную панель в зоне «${zone.name}»: −20 батареи`,
      rover.id, order.id);
    return { outcome, message: 'Потеря 20 батареи' };
  }

  if (outcome === 'delay') {
    db.prepare('UPDATE deliveries SET delay_hours = delay_hours + 3 WHERE id = ?').run(delivery_id);
    logEvent('risk_delay',
      `«${rover.name}» застрял в реголите по пути в «${zone.name}»: +3 часа`,
      rover.id, order.id);
    return { outcome, message: 'Задержка +3 часа' };
  }

  // поломка
  db.prepare(`UPDATE rovers SET status = 'damaged', updated_at = datetime('now') WHERE id = ?`).run(rover.id);
  db.prepare(`UPDATE deliveries SET status = 'failed' WHERE id = ?`).run(delivery_id);
  db.prepare(`UPDATE orders SET status = 'open' WHERE id = ?`).run(order.id);
  logEvent('risk_breakdown',
    `«${rover.name}» вышел из строя в зоне «${zone.name}». Заказ «${order.title}» вернулся в работу`,
    rover.id, order.id);
  return { outcome, message: 'Поломка ровера, доставка провалена' };
}

// ---------------------------------------------------------------- генератор
function spawnOrder({ oversized = false } = {}) {
  const s = getState();
  const zone = pick(ZONES);
  const weight = oversized ? randInt(150, 200) : randInt(20, 110);
  const deadline = oversized ? 24 : randInt(8, 36);
  const reward = oversized
    ? randInt(6000, 9000)
    : Math.round((weight * 10 + zone.distance * 30) * (1 + zone.risk_factor));

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO orders (title, weight_kg, reward, deadline_hours, zone_id, status, created_hour, kind)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
    .run(pick(oversized ? HEAVY_CARGO : CARGO), weight, reward, deadline, zone.id,
      totalHours(s), oversized ? 'oversized' : 'normal');

  logEvent(oversized ? 'order_oversized' : 'order_new',
    oversized
      ? `Заявка на негабарит: ${weight} кг в «${zone.name}», награда ${reward} ₡. Ни один ровер столько не поднимет`
      : `Новый заказ: ${weight} кг в «${zone.name}», награда ${reward} ₡`,
    null, Number(lastInsertRowid));

  return Number(lastInsertRowid);
}

// ---------------------------------------------------------------- тик
/** Один тик = один игровой час. Всё внутри одной транзакции. */
export const tick = db.transaction(() => {
  const before = getState();
  if (before.status !== 'running') return { skipped: true, state: before };

  // 1. часы
  const nextTotal = totalHours(before) + 1;
  const day = Math.floor(nextTotal / HOURS_PER_DAY) + 1;
  const hour = nextTotal % HOURS_PER_DAY;
  db.prepare(`UPDATE game_state SET day = ?, hour = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(day, hour);

  const dayRolled = day > before.day;

  // 2. зарядка
  for (const r of db.prepare(`SELECT * FROM rovers WHERE status = 'charging'`).all()) {
    const battery = clamp(r.battery + CHARGE_PER_HOUR, 0, 100);
    const done = battery >= 100;
    db.prepare(`UPDATE rovers SET battery = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(battery, done ? 'idle' : 'charging', r.id);
    if (done) logEvent('charged', `«${r.name}» заряжен до 100% и готов к работе`, r.id);
  }

  // 3. доставки
  const running = db.prepare(
    `SELECT d.*, o.reward, o.title AS order_title, r.name AS rover_name, r.battery
     FROM deliveries d
     JOIN orders o ON o.id = d.order_id
     JOIN rovers r ON r.id = d.rover_id
     WHERE d.status = 'in_progress' AND d.started_hour IS NOT NULL`).all();

  for (const d of running) {
    if (nextTotal < d.started_hour + d.eta_hours + d.delay_hours) continue;

    const cost = d.battery_cost ?? 0;
    db.prepare(`UPDATE deliveries SET status = 'done' WHERE id = ?`).run(d.id);
    db.prepare(`UPDATE orders SET status = 'delivered' WHERE id = ?`).run(d.order_id);
    db.prepare(
      `UPDATE rovers SET battery = max(0, battery - ?), status = 'idle', updated_at = datetime('now')
       WHERE id = ?`).run(cost, d.rover_id);
    addCredits(d.reward);
    logEvent('delivered',
      `«${d.rover_name}» доставил «${d.order_title}»: +${d.reward} ₡, −${cost} батареи`,
      d.rover_id, d.order_id);
  }

  // 4. просрочка (только открытые: назначенные уже в пути)
  const expired = db.prepare(
    `SELECT * FROM orders WHERE status = 'open' AND created_hour + deadline_hours < ?`).all(nextTotal);

  for (const o of expired) {
    db.prepare(`UPDATE orders SET status = 'expired' WHERE id = ?`).run(o.id);
    addRating(-PENALTY_EXPIRED);
    logEvent('order_expired',
      `Заказ «${o.title}» просрочен: рейтинг −${PENALTY_EXPIRED}`, null, o.id);
  }

  // 5. генерация заказов
  if (nextTotal % ORDER_EVERY_HOURS === 0) {
    const n = randInt(1, 2);
    for (let i = 0; i < n; i++) spawnOrder();
  }
  if (dayRolled) spawnOrder({ oversized: true });

  // 6. победа и поражение
  const after = getState();
  if (after.rating <= 0) {
    db.prepare(`UPDATE game_state SET status = 'lost', updated_at = datetime('now') WHERE id = 1`).run();
    logEvent('game_lost', `Рейтинг базы упал до нуля на ${after.day}-й день. Контракт расторгнут`);
  } else if (nextTotal >= WIN_DAYS * HOURS_PER_DAY && after.credits >= WIN_CREDITS) {
    db.prepare(`UPDATE game_state SET status = 'won', updated_at = datetime('now') WHERE id = 1`).run();
    logEvent('game_won',
      `База продержалась ${WIN_DAYS} дней и накопила ${after.credits} ₡. Победа`);
  }

  return { skipped: false, state: getState() };
});

let timer = null;

export function startClock() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error('[tick]', e);
    }
  }, TICK_MS);
  timer.unref?.();
}
