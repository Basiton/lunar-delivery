// Проверка баланса: прогоняем 7 игровых суток настоящим движком (тот же tick и
// тот же startDelivery, что и в игре), управляя базой жадной стратегией.
// Отдельный файл базы, реальная игра не трогается.
//
//   npm run simulate --workspace server -- [--runs 20]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const value = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : Number(argv[i + 1]); };
const RUNS = value('--runs', 20);
const DAYS = 7;

// DB_PATH читается при импорте db.js, поэтому подменяем до динамического импорта.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'lunar-sim-')), 'sim.db');

const { db, resetGame } = await import('./db.js');
const { ZONE_BY_ID } = await import('./zones.js');
const {
  batteryCost, roundTripHours, startDelivery, tick, getState, totalHours, HOURS_PER_DAY,
} = await import('./game.js');

/** Ход игрока: заряжаем севших, отклоняем неподъёмное, раздаём выгодные рейсы. */
function playHour() {
  const state = getState();
  const now = totalHours(state);

  const open = db.prepare(`SELECT * FROM orders WHERE status = 'open'`).all();
  const rovers = db.prepare('SELECT * FROM rovers ORDER BY capacity_kg DESC').all();
  const maxCapacity = Math.max(...rovers.map((r) => r.capacity_kg));

  // Неподъёмное отклоняем сразу: −5 дешевле, чем −10 за протухание.
  for (const o of open) {
    if (o.weight_kg <= maxCapacity) continue;
    db.prepare(`UPDATE orders SET status = 'failed' WHERE id = ?`).run(o.id);
    db.prepare(
      `UPDATE game_state SET rating = max(0, rating - 5) WHERE id = 1`).run();
  }

  for (const rover of rovers) {
    if (rover.status !== 'idle') continue;

    const candidates = db.prepare(`SELECT * FROM orders WHERE status = 'open'`).all()
      .filter((o) => o.weight_kg <= rover.capacity_kg)
      .map((o) => {
        const zone = ZONE_BY_ID.get(o.zone_id);
        const cost = batteryCost(zone, o.weight_kg, rover.capacity_kg);
        const eta = roundTripHours(zone, o.weight_kg, rover.capacity_kg);
        const slack = o.created_hour + o.deadline_hours - (now + eta); // успеваем ли в срок
        return { o, cost, eta, slack, value: o.reward / eta };
      })
      .filter((c) => c.cost <= rover.battery && c.slack >= 0)
      .sort((a, b) => b.value - a.value);

    if (candidates.length) {
      startDelivery(rover.id, candidates[0].o.id);
      continue;
    }

    // Брать нечего: если заряд низкий, выгоднее встать на зарядку.
    if (rover.battery < 60) {
      db.prepare(`UPDATE rovers SET status = 'charging' WHERE id = ?`).run(rover.id);
    }
  }
}

function runOnce() {
  resetGame();
  for (let h = 0; h < DAYS * HOURS_PER_DAY; h++) {
    if (getState().status !== 'running') break;
    playHour();
    tick();
  }
  const s = getState();
  const delivered = db.prepare(`SELECT count(*) n FROM orders WHERE status = 'delivered'`).get().n;
  const expired = db.prepare(`SELECT count(*) n FROM orders WHERE status = 'expired'`).get().n;
  return { status: s.status, day: s.day, credits: s.credits, rating: s.rating, delivered, expired };
}

const results = [];
for (let i = 0; i < RUNS; i++) results.push(runOnce());

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const survived = results.filter((r) => r.status !== 'lost').length;
const won = results.filter((r) => r.status === 'won').length;

console.log(`прогонов: ${RUNS}, стратегия — жадная, без простоев\n`);
console.log('  # | исход   | сутки | кредиты | рейтинг | доставлено | просрочено');
results.forEach((r, i) => {
  console.log(`  ${String(i + 1).padStart(2)} | ${r.status.padEnd(7)} | ${String(r.day).padStart(5)} |`
    + ` ${String(r.credits).padStart(7)} | ${String(r.rating).padStart(7)} |`
    + ` ${String(r.delivered).padStart(10)} | ${String(r.expired).padStart(10)}`);
});

console.log(`\nдожили до 7 суток: ${survived}/${RUNS}`);
console.log(`победили (7 суток и 5000 ₡): ${won}/${RUNS}`);
console.log(`медиана: кредиты ${med(results.map((r) => r.credits))},`
  + ` рейтинг ${med(results.map((r) => r.rating))},`
  + ` доставок ${med(results.map((r) => r.delivered))},`
  + ` просрочек ${med(results.map((r) => r.expired))}`);
