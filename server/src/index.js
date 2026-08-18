import express from 'express';
import { closeLegacyDeliveries, db, seedIfEmpty } from './db.js';
import { ZONES, ZONE_BY_ID } from './zones.js';
import {
  CHARGE_PER_HOUR, PENALTY_DECLINED, batteryCost, getState, logEvent,
  rollRisk, roundTripHours, startClock, totalHours,
} from './game.js';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.use(express.json());

const seeded = seedIfEmpty();
const closed = closeLegacyDeliveries();

const q = {
  rovers: db.prepare('SELECT * FROM rovers ORDER BY id'),
  orders: db.prepare('SELECT * FROM orders ORDER BY id'),
  deliveries: db.prepare('SELECT * FROM deliveries ORDER BY id'),
  events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50'),
  rover: db.prepare('SELECT * FROM rovers WHERE id = ?'),
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  delivery: db.prepare('SELECT * FROM deliveries WHERE id = ?'),
};

/** Пока игра окончена, изменять состояние нельзя. */
function gameOver(res) {
  const s = getState();
  if (s.status === 'running') return false;
  res.status(422).json({ error: s.status === 'won' ? 'Игра выиграна' : 'Игра проиграна' });
  return true;
}

app.get('/api/state', (req, res) => {
  res.json({
    now: new Date().toISOString(),
    game_state: getState(),
    zones: ZONES,
    rovers: q.rovers.all(),
    orders: q.orders.all(),
    deliveries: q.deliveries.all(),
    events: q.events.all(),
  });
});

app.post('/api/deliveries', (req, res) => {
  if (gameOver(res)) return;

  const rover_id = Number(req.body?.rover_id);
  const order_id = Number(req.body?.order_id);
  if (!Number.isInteger(rover_id) || !Number.isInteger(order_id)) {
    return res.status(400).json({ error: 'rover_id и order_id обязательны и должны быть целыми числами' });
  }

  const rover = q.rover.get(rover_id);
  if (!rover) return res.status(404).json({ error: `ровер ${rover_id} не найден` });

  const order = q.order.get(order_id);
  if (!order) return res.status(404).json({ error: `заказ ${order_id} не найден` });

  const zone = ZONE_BY_ID.get(order.zone_id);
  if (!zone) return res.status(500).json({ error: `неизвестная зона ${order.zone_id}` });

  if (order.status !== 'open') {
    return res.status(422).json({ error: 'Заказ уже не в работе' });
  }

  // Порядок проверок — как в ТЗ: вес, батарея, занятость.
  if (order.weight_kg > rover.capacity_kg) {
    return res.status(422).json({ error: 'Груз тяжелее грузоподъёмности' });
  }

  const cost = batteryCost(zone, order.weight_kg, rover.capacity_kg);
  if (cost > rover.battery) {
    return res.status(422).json({ error: 'Не хватит батареи' });
  }

  if (rover.status !== 'idle') {
    return res.status(422).json({ error: 'Ровер занят' });
  }

  const eta = roundTripHours(zone, order.weight_kg, rover.capacity_kg);

  const result = db.transaction(() => {
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

    // Бросок риска сразу при старте: он может отменить всё выше.
    const risk = rollRisk(zone, rover, order, id);
    return { delivery: q.delivery.get(id), risk };
  })();

  res.status(201).json({
    ...result.delivery,
    battery_cost_exact: Number(cost.toFixed(2)),
    eta_hours_exact: Number(eta.toFixed(2)),
    risk: result.risk,
  });
});

app.post('/api/rovers/:id/charge', (req, res) => {
  if (gameOver(res)) return;

  const rover = q.rover.get(Number(req.params.id));
  if (!rover) return res.status(404).json({ error: `ровер ${req.params.id} не найден` });

  if (rover.status === 'delivering') return res.status(422).json({ error: 'Ровер занят' });
  if (rover.battery >= 100) return res.status(422).json({ error: 'Батарея уже полная' });

  db.transaction(() => {
    db.prepare(`UPDATE rovers SET status = 'charging', updated_at = datetime('now') WHERE id = ?`)
      .run(rover.id);
    logEvent('charging',
      `«${rover.name}» встал на зарядку (${rover.battery}% → 100%, +${CHARGE_PER_HOUR} в час)`, rover.id);
  })();

  res.json(q.rover.get(rover.id));
});

app.post('/api/orders/:id/decline', (req, res) => {
  if (gameOver(res)) return;

  const order = q.order.get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: `заказ ${req.params.id} не найден` });
  if (order.status !== 'open') return res.status(422).json({ error: 'Заказ уже не в работе' });

  db.transaction(() => {
    // Отдельного статуса 'declined' в схеме нет, поэтому отказ — это failed,
    // а причина видна в журнале.
    db.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`).run(order.id);
    db.prepare(
      `UPDATE game_state SET rating = max(0, rating - ?), updated_at = datetime('now') WHERE id = 1`)
      .run(PENALTY_DECLINED);
    logEvent('order_declined',
      `Заказ «${order.title}» отклонён: рейтинг −${PENALTY_DECLINED}`, null, order.id);
  })();

  res.json({ order: q.order.get(order.id), game_state: getState() });
});

app.use((req, res) => res.status(404).json({ error: `не найдено: ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

startClock();

app.listen(PORT, () => {
  const s = getState();
  console.log(`[server] http://localhost:${PORT}  ${seeded ? '(база засеяна)' : '(база уже существует)'}`);
  if (closed) console.log(`[server] закрыто доставок из каркаса: ${closed}`);
  console.log(`[server] игровые часы пошли: день ${s.day}, ${s.hour}:00, кредиты ${s.credits}, рейтинг ${s.rating}`);
});
