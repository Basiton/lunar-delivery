import { db } from './db.js';
import { ZONES, ZONE_BY_ID } from './zones.js';

// Балансовые константы. Значения по умолчанию — рабочие, подобранные
// симулятором; переменные окружения позволяют пробовать другие, не трогая код.
const num = (name, def) => Number(process.env[name] ?? def);

export const TICK_MS = 3000;        // 3 секунды реального времени
export const HOURS_PER_DAY = 24;    // 24 игровых часа = лунные сутки
export const WIN_DAYS = 7;
export const WIN_CREDITS = num('WIN_CREDITS', 28000);

export const CHARGE_PER_HOUR = num('CHARGE_PER_HOUR', 10);
export const ORDER_EVERY_HOURS = num('ORDER_EVERY_HOURS', 6);
export const PENALTY_EXPIRED = num('PENALTY_EXPIRED', 10);
export const PENALTY_DECLINED = num('PENALTY_DECLINED', 5);
export const BONUS_ON_TIME = num('BONUS_ON_TIME', 10);

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

// ---------------------------------------------------------------- отправка
/**
 * Единая точка старта рейса: её вызывают и HTTP-маршрут, и симулятор баланса.
 * Возвращает { ok } либо { ok: false, code, error } с причиной для пользователя.
 */
export function startDelivery(rover_id, order_id) {
  const rover = db.prepare('SELECT * FROM rovers WHERE id = ?').get(rover_id);
  if (!rover) return { ok: false, code: 404, error: `ровер ${rover_id} не найден` };

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
  if (!order) return { ok: false, code: 404, error: `заказ ${order_id} не найден` };

  const zone = ZONE_BY_ID.get(order.zone_id);
  if (!zone) return { ok: false, code: 500, error: `неизвестная зона ${order.zone_id}` };

  if (order.status !== 'open') return { ok: false, code: 422, error: 'Заказ уже не в работе' };

  // Порядок проверок — как в ТЗ: вес, батарея, занятость.
  if (order.weight_kg > rover.capacity_kg) {
    return { ok: false, code: 422, error: 'Груз тяжелее грузоподъёмности' };
  }

  const cost = batteryCost(zone, order.weight_kg, rover.capacity_kg);
  if (cost > rover.battery) return { ok: false, code: 422, error: 'Не хватит батареи' };

  if (rover.status !== 'idle') return { ok: false, code: 422, error: 'Ровер занят' };

  const eta = roundTripHours(zone, order.weight_kg, rover.capacity_kg);

  return db.transaction(() => {
    // На паузе рейс тоже можно завести: он стартует с текущего игрового часа,
    // а часы стоят — значит движение начнётся после снятия паузы.
    const started_hour = totalHours(getState());
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO deliveries (rover_id, order_id, started_hour, eta_hours, battery_cost, status)
       VALUES (?, ?, ?, ?, ?, 'in_progress')`)
      .run(rover_id, order_id, started_hour, eta, Math.round(cost));

    const id = Number(lastInsertRowid);
    db.prepare(`UPDATE orders SET status = 'assigned' WHERE id = ?`).run(order_id);
    db.prepare(`UPDATE rovers SET status = 'delivering', updated_at = datetime('now') WHERE id = ?`)
      .run(rover_id);
    logEvent('delivery_created',
      `«${rover.name}» вышел в «${zone.name}» с заказом «${order.title}»: ${eta.toFixed(1)} ч, −${Math.round(cost)} батареи`,
      rover_id, order_id);

    const risk = rollRisk(zone, rover, order, id);
    return {
      ok: true,
      delivery: db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id),
      risk,
      cost,
      eta,
    };
  })();
}

// ---------------------------------------------------------------- тик
/** Один тик = один игровой час. Всё внутри одной транзакции. */
export const tick = db.transaction(() => {
  const before = getState();
  if (before.status !== 'running') return { skipped: true, state: before };
  if (before.paused) return { skipped: true, paused: true, state: before };

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
    `SELECT d.*, o.reward, o.title AS order_title, o.created_hour, o.deadline_hours,
            r.name AS rover_name, r.battery
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

    // В срок — если рейс закончился не позже дедлайна заказа.
    const onTime = nextTotal <= d.created_hour + d.deadline_hours;
    logEvent('delivered',
      `«${d.rover_name}» доставил «${d.order_title}»: +${d.reward} ₡, −${cost} батареи`,
      d.rover_id, d.order_id);

    if (onTime) {
      addRating(BONUS_ON_TIME);
      logEvent('rating_up',
        `Доставка «${d.order_title}» в срок: рейтинг +${BONUS_ON_TIME}`, d.rover_id, d.order_id);
    } else {
      logEvent('delivered_late',
        `Доставка «${d.order_title}» с опозданием: без прибавки к рейтингу`, d.rover_id, d.order_id);
    }
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
