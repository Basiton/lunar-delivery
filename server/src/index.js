import express from 'express';
import { db, seedIfEmpty } from './db.js';
import { ZONES } from './zones.js';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.use(express.json());

const seeded = seedIfEmpty();

const q = {
  rovers: db.prepare('SELECT * FROM rovers ORDER BY id'),
  orders: db.prepare('SELECT * FROM orders ORDER BY id'),
  deliveries: db.prepare('SELECT * FROM deliveries ORDER BY id'),
  events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50'),
  rover: db.prepare('SELECT * FROM rovers WHERE id = ?'),
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  delivery: db.prepare('SELECT * FROM deliveries WHERE id = ?'),
  insertDelivery: db.prepare(
    `INSERT INTO deliveries (rover_id, order_id, eta_hours, battery_cost, status)
     VALUES (@rover_id, @order_id, @eta_hours, @battery_cost, 'in_progress')`),
  insertEvent: db.prepare(
    `INSERT INTO events (type, message, rover_id, order_id) VALUES (?, ?, ?, ?)`),
};

/** Всё состояние игры одним объектом — клиенту хватает одного запроса. */
app.get('/api/state', (req, res) => {
  res.json({
    now: new Date().toISOString(),
    zones: ZONES,
    rovers: q.rovers.all(),
    orders: q.orders.all(),
    deliveries: q.deliveries.all(),
    events: q.events.all(),
  });
});

app.post('/api/deliveries', (req, res) => {
  const rover_id = Number(req.body?.rover_id);
  const order_id = Number(req.body?.order_id);

  if (!Number.isInteger(rover_id) || !Number.isInteger(order_id)) {
    return res.status(400).json({ error: 'rover_id и order_id обязательны и должны быть целыми числами' });
  }

  const rover = q.rover.get(rover_id);
  if (!rover) return res.status(404).json({ error: `ровер ${rover_id} не найден` });

  const order = q.order.get(order_id);
  if (!order) return res.status(404).json({ error: `заказ ${order_id} не найден` });

  // Игровой логики пока нет: грузоподъёмность, заряд и статусы не проверяются
  // и не меняются — эндпоинт только заводит запись о доставке.
  const eta_hours = req.body?.eta_hours != null ? Number(req.body.eta_hours) : null;
  const battery_cost = req.body?.battery_cost != null ? Number(req.body.battery_cost) : null;

  const created = db.transaction(() => {
    const { lastInsertRowid } = q.insertDelivery.run({ rover_id, order_id, eta_hours, battery_cost });
    q.insertEvent.run(
      'delivery_created',
      `Доставка #${lastInsertRowid}: ровер «${rover.name}» назначен на заказ «${order.title}»`,
      rover_id, order_id);
    return q.delivery.get(lastInsertRowid);
  })();

  res.status(201).json(created);
});

app.use((req, res) => res.status(404).json({ error: `не найдено: ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  ${seeded ? '(база засеяна)' : '(база уже существует)'}`);
});
