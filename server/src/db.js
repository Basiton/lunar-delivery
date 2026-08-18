import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(here, '..', 'data', 'lunar.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Статусы держим CHECK-ограничениями: SQLite не знает enum, а без них
// опечатка в статусе тихо ляжет в базу и всплывёт уже в игровой логике.
db.exec(`
  CREATE TABLE IF NOT EXISTS rovers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    battery     INTEGER NOT NULL CHECK (battery BETWEEN 0 AND 100),
    capacity_kg REAL    NOT NULL CHECK (capacity_kg > 0),
    status      TEXT    NOT NULL CHECK (status IN ('idle','delivering','charging','damaged')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    weight_kg      REAL    NOT NULL CHECK (weight_kg > 0),
    reward         INTEGER NOT NULL CHECK (reward >= 0),
    deadline_hours REAL    NOT NULL CHECK (deadline_hours > 0),
    zone_id        TEXT    NOT NULL,
    status         TEXT    NOT NULL CHECK (status IN ('open','assigned','delivered','failed','expired')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rover_id     INTEGER NOT NULL REFERENCES rovers(id),
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    eta_hours    REAL,
    battery_cost INTEGER,
    status       TEXT    NOT NULL CHECK (status IN ('in_progress','done','failed'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    rover_id   INTEGER REFERENCES rovers(id),
    order_id   INTEGER REFERENCES orders(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_state (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    day     INTEGER NOT NULL CHECK (day >= 1),
    hour    INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    credits INTEGER NOT NULL CHECK (credits >= 0),
    rating  INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 100),
    status  TEXT    NOT NULL CHECK (status IN ('running','won','lost')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS deliveries_rover_idx ON deliveries(rover_id);
  CREATE INDEX IF NOT EXISTS deliveries_order_idx ON deliveries(order_id);
  CREATE INDEX IF NOT EXISTS events_created_idx   ON events(created_at DESC);
`);

/** Добавляет колонку, если её ещё нет: база с каркаса уже существует,
 *  и ронять её ради новых полей незачем. */
function ensureColumn(table, column, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

// Игровые часы вместо реального времени: доставка живёт в игровом времени,
// а оно тикает независимо от того, сколько секунд назад создана запись.
ensureColumn('deliveries', 'started_hour', 'INTEGER');
ensureColumn('deliveries', 'delay_hours', 'REAL NOT NULL DEFAULT 0');
ensureColumn('orders', 'created_hour', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'kind', "TEXT NOT NULL DEFAULT 'normal'");
ensureColumn('events', 'day', 'INTEGER');
ensureColumn('events', 'hour', 'INTEGER');

/** Доставки из каркаса заведены до появления игрового времени: у них нет
 *  started_hour, и движок не смог бы их досчитать. Закрываем как failed,
 *  роверов освобождаем. */
export function closeLegacyDeliveries() {
  const legacy = db.prepare(
    `SELECT id, rover_id FROM deliveries WHERE status = 'in_progress' AND started_hour IS NULL`).all();
  if (!legacy.length) return 0;

  db.transaction(() => {
    for (const d of legacy) {
      db.prepare(`UPDATE deliveries SET status = 'failed' WHERE id = ?`).run(d.id);
      db.prepare(`UPDATE rovers SET status = 'idle', updated_at = datetime('now') WHERE id = ?`).run(d.rover_id);
      db.prepare(`INSERT INTO events (type, message, rover_id) VALUES (?, ?, ?)`).run(
        'migration', `Доставка #${d.id} закрыта при переходе на игровое время`, d.rover_id);
    }
  })();
  return legacy.length;
}

/** Новая игра: чистим всё игровое и сеем заново.
 *  sqlite_sequence тоже сбрасываем, иначе id продолжат расти от прошлой партии. */
export function resetGame() {
  db.transaction(() => {
    db.exec('DELETE FROM deliveries; DELETE FROM events; DELETE FROM orders; DELETE FROM rovers;');
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('deliveries','events','orders','rovers')`);
    db.prepare(
      `UPDATE game_state SET day = 1, hour = 0, credits = 0, rating = 100,
              status = 'running', updated_at = datetime('now') WHERE id = 1`).run();
  })();
  seedIfEmpty();
}

/** Сид только при пустой базе: перезапуск сервера не должен плодить дубли. */
export function seedIfEmpty() {
  // Состояние игры заводится отдельно: таблица появилась позже роверов,
  // и в уже существующей базе её строки ещё нет.
  db.prepare(
    `INSERT OR IGNORE INTO game_state (id, day, hour, credits, rating, status)
     VALUES (1, 1, 0, 0, 100, 'running')`).run();

  const { n } = db.prepare('SELECT count(*) AS n FROM rovers').get();
  if (n > 0) return false;

  const insertRover = db.prepare(
    `INSERT INTO rovers (name, battery, capacity_kg, status) VALUES (?, 100, ?, 'idle')`);
  const insertOrder = db.prepare(
    `INSERT INTO orders (title, weight_kg, reward, deadline_hours, zone_id, status)
     VALUES (?, ?, ?, ?, ?, 'open')`);
  const insertEvent = db.prepare(
    `INSERT INTO events (type, message) VALUES (?, ?)`);

  db.transaction(() => {
    insertRover.run('Пилигрим', 60);
    insertRover.run('Селена', 90);
    insertRover.run('Тяжеловоз', 120);

    insertOrder.run('Комплект солнечных панелей', 48, 1200, 12, 'tranquillitatis');
    insertOrder.run('Медблок для станции', 72, 2100, 20, 'copernicus');
    insertOrder.run('Буровая установка', 110, 3400, 36, 'shackleton');
    insertOrder.run('Запас кислорода', 35, 900, 8, 'procellarum');

    insertEvent.run('seed', 'База инициализирована: 3 ровера, 4 заказа');
  })();

  return true;
}
