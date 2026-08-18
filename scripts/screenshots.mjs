// Скриншоты для README. Все состояния добываются честно: скрипт играет в игру
// через тот же HTTP API, что и человек, и снимает настоящий интерфейс в
// headless-браузере. В базу скрипт не лезет — только /api/*.
//
//   1. поднимите игру:  TICK_MS=250 npm run dev
//   2. запустите:       node scripts/screenshots.mjs
//
// Можно переснять не всё, а отдельные кадры:
//   node scripts/screenshots.mjs --only result
//   node scripts/screenshots.mjs --only map,rejection
//
// TICK_MS ускоряет только ход часов, правила и формулы те же самые.
// Нужен playwright, он не входит в зависимости игры:
//   npm i -D playwright
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SHOTS = ['map', 'rejection', 'events', 'result'];
const argv = process.argv.slice(2);
const only = argv.includes('--only')
  ? argv[argv.indexOf('--only') + 1].split(',').map((s) => s.trim())
  : SHOTS;
const want = (name) => only.includes(name);

const API = process.env.API ?? 'http://localhost:3001';
const UI = process.env.UI ?? 'http://localhost:5173';
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const WIDTH = 1600;
const HEIGHT = 1000;
const POLL_SETTLE = 2600; // клиент опрашивает сервер раз в 2 с — даём ему догнать

// Копии формул из server/src/game.js: скрипт ходит только по HTTP и не может
// импортировать движок, не открыв вторым процессом ту же базу.
const batteryCost = (z, w, cap) => z.distance * (1 + w / cap) * (1 + z.risk_factor);
const roundTrip = (z, w, cap) => (z.distance / (10 * z.speed_factor)) * (1 + 0.5 * w / cap) * 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ', ...a);

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

const totalHours = (g) => (g.day - 1) * 24 + g.hour;

/** Причина, по которой сервер откажет в рейсе — считаем теми же формулами. */
function rejection(rover, order, zone) {
  if (order.status !== 'open') return null;
  if (order.weight_kg > rover.capacity_kg) return 'Груз тяжелее грузоподъёмности';
  if (batteryCost(zone, order.weight_kg, rover.capacity_kg) > rover.battery) return 'Не хватит батареи';
  return null;
}

/**
 * Один ход диспетчера, та же жадная стратегия, что и в симуляторе баланса:
 * неподъёмное отклоняем, свободным роверам раздаём самые выгодные рейсы,
 * которым хватает батареи и срока, остальных ставим на зарядку.
 */
async function playStep({ hold = [], decline = true } = {}) {
  const s = await get('/api/state');
  if (s.game_state.status !== 'running') return s;

  const zoneById = new Map(s.zones.map((z) => [z.id, z]));
  const now = totalHours(s.game_state);
  const maxCap = Math.max(...s.rovers.map((r) => r.capacity_kg));
  const taken = new Set();

  if (decline) {
    for (const o of s.orders) {
      if (o.status === 'open' && o.weight_kg > maxCap) await post(`/api/orders/${o.id}/decline`);
    }
  }

  for (const rover of [...s.rovers].sort((a, b) => b.capacity_kg - a.capacity_kg)) {
    if (rover.status !== 'idle' || hold.includes(rover.id)) continue;

    const best = s.orders
      .filter((o) => o.status === 'open' && !taken.has(o.id) && o.weight_kg <= rover.capacity_kg)
      .map((o) => {
        const zone = zoneById.get(o.zone_id);
        const eta = roundTrip(zone, o.weight_kg, rover.capacity_kg);
        return {
          o,
          eta,
          cost: batteryCost(zone, o.weight_kg, rover.capacity_kg),
          slack: o.created_hour + o.deadline_hours - (now + eta),
          value: o.reward / eta,
        };
      })
      .filter((c) => c.cost <= rover.battery && c.slack >= 0)
      .sort((a, b) => b.value - a.value)[0];

    if (best) {
      const r = await post('/api/deliveries', { rover_id: rover.id, order_id: best.o.id });
      if (r.ok) taken.add(best.o.id);
      continue;
    }
    if (rover.battery < 60) await post(`/api/rovers/${rover.id}/charge`);
  }

  return get('/api/state');
}

/** Играем, пока не выполнится условие (или не кончится лимит игровых часов). */
async function playUntil(done, opts = {}, limitHours = 600) {
  const start = totalHours((await get('/api/state')).game_state);
  for (;;) {
    const s = await playStep(opts);
    if (done(s)) return s;
    if (s.game_state.status !== 'running') return s;
    if (totalHours(s.game_state) - start > limitHours) {
      throw new Error('не удалось получить нужное состояние за отведённые игровые часы');
    }
    await sleep(120);
  }
}

const pause = (paused) => post('/api/game/pause', { paused });

async function shot(page, name) {
  await page.screenshot({ path: join(DOCS, name), fullPage: true });
  log('снято', name);
}

/** Клик по заказу на карте: ищем нужный <g class="order"> по названию в <title>. */
async function clickOrder(page, title) {
  const idx = await page.$$eval('g.order', (nodes, t) =>
    nodes.findIndex((n) => n.querySelector('title')?.textContent === t), title);
  if (idx < 0) throw new Error(`заказ «${title}» не найден на карте`);
  await page.locator('g.order').nth(idx).click();
}

const clickRover = (page, name) =>
  page.locator('.rover-card', { hasText: name }).locator('.rover-main').click();

// ---------------------------------------------------------------- карта и отказ
async function shotMapAndRejection(page) {
  // Играем до вторых суток: на карте уже есть кредиты, рейсы и заявка на негабарит,
  // а «Пилигрим» (60 кг) намеренно стоит на базе — он понадобится для отказа.
  const HOLD = [1];
  await playUntil((s) => {
    const g = s.game_state;
    if (g.day < 2 || g.credits <= 0) return false;
    const rover = s.rovers.find((r) => r.id === HOLD[0]);
    if (!rover || rover.status !== 'idle') return false;
    // На карте должен быть хотя бы один рейс: так видно маршрут и ровер в пути.
    if (!s.deliveries.some((d) => d.status === 'in_progress')) return false;
    const zoneById = new Map(s.zones.map((z) => [z.id, z]));
    return s.orders.some((o) => rejection(rover, o, zoneById.get(o.zone_id)));
  }, { hold: HOLD, decline: false });

  if (want('map')) {
    // Карту снимаем на ходу, без паузы: так выглядит обычная партия.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('g.order').first().waitFor();
    await shot(page, '01-map.png');
  }
  if (!want('rejection')) return;

  // ---------------------------------------------------------------- отказ
  // Здесь пауза нужна: иначе выбранный заказ протухнет прямо во время кликов.
  await pause(true);
  await sleep(POLL_SETTLE);
  const s2 = await get('/api/state');
  const rover = s2.rovers.find((r) => r.id === HOLD[0]);
  const zoneById = new Map(s2.zones.map((z) => [z.id, z]));
  // Из всех отказов берём самый наглядный — по самому тяжёлому грузу.
  const target = s2.orders
    .map((o) => ({ o, reason: rejection(rover, o, zoneById.get(o.zone_id)) }))
    .filter((c) => c.reason)
    .sort((a, b) => b.o.weight_kg - a.o.weight_kg)[0];
  if (!target) throw new Error('не нашлось заказа, на который сервер откажет');

  log(`отказ: «${rover.name}» (${rover.capacity_kg} кг, ${rover.battery}%) ->`
    + ` «${target.o.title}» ${target.o.weight_kg} кг — ожидаем «${target.reason}»`);

  await clickRover(page, rover.name);
  await clickOrder(page, target.o.title);
  await page.locator('.dispatch-btn').click();
  await page.locator('.notice.error').waitFor();
  await shot(page, '02-rejection.png');

  // снимаем выделение, чтобы оно не мешало дальше
  await clickOrder(page, target.o.title);
  await clickRover(page, rover.name);
  await pause(false);
}

// ---------------------------------------------------------------- журнал
async function shotEvents(page) {
  // Играем, пока в верхних строках журнала не соберутся разные типы: доставка,
  // происшествие в пути и потеря рейтинга. Нужные события должны стоять с
  // запасом выше нижней строки: пока делается снимок, журнал успевает
  // подрасти и сдвинуть их вниз.
  const at = (types, ok) => types.findIndex(ok);
  const within = (types, ok, n) => { const i = at(types, ok); return i >= 0 && i < n; };

  await playUntil((s) => {
    const types = s.events.slice(0, 15).map((e) => e.type);
    if (types.some((t) => t === 'paused' || t === 'resumed')) return false; // ждём, пока уедут вверх
    return within(types, (t) => t.startsWith('risk_'), 6)
      && within(types, (t) => t === 'delivered', 10)
      && within(types, (t) => t === 'order_expired' || t === 'order_declined', 13);
  });

  // Перезагружаем вкладку: она сбрасывает старую плашку отказа, а игра идёт
  // своим ходом — состояние живёт на сервере.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.log li').first().waitFor();
  await shot(page, '03-events.png');
}

// ---------------------------------------------------------------- финал
async function shotResult(page) {
  // Играем до конца партии. Если базу довели до нуля рейтинга — начинаем заново:
  // на экране результата хочется видеть выигранную партию.
  let final = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    final = await playUntil((s) => s.game_state.status !== 'running', {}, 1000);
    const g = final.game_state;
    log(`партия ${attempt}: ${g.status}, сутки ${g.day}, ${g.credits} ₡, рейтинг ${g.rating}`);
    if (g.status === 'won' || attempt === 4) break;
    await post('/api/game/reset');
  }

  await sleep(POLL_SETTLE);
  // Экран результата — оверлей поверх всей страницы, поэтому снимаем окно, а не
  // страницу целиком.
  await page.screenshot({ path: join(DOCS, '04-result.png') });
  log('снято', '04-result.png');
}

async function main() {
  mkdirSync(DOCS, { recursive: true });

  const unknown = only.filter((n) => !SHOTS.includes(n));
  if (unknown.length) throw new Error(`неизвестный кадр: ${unknown.join(', ')}; есть ${SHOTS.join(', ')}`);

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(UI, { waitUntil: 'networkidle' });

  // Каждый запуск начинается с новой партии: кадры должны показывать игру
  // с начала, а не то, что осталось от прошлого прогона.
  await post('/api/game/reset');
  log('новая игра');

  if (want('map') || want('rejection')) await shotMapAndRejection(page);
  if (want('events')) await shotEvents(page);
  if (want('result')) await shotResult(page);

  await browser.close();
  console.log('готово, скриншоты в docs/');
}

main().catch((e) => { console.error(e); process.exit(1); });
