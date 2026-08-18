import { useEffect, useState } from 'react';

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <main><h1>Lunar Delivery</h1><p className="error">Ошибка загрузки: {error}</p></main>;
  if (!state) return <main><h1>Lunar Delivery</h1><p>Загрузка…</p></main>;

  const zoneName = (id) => state.zones.find((z) => z.id === id)?.name ?? id;

  return (
    <main>
      <h1>Lunar Delivery</h1>

      <section>
        <h2>Роверы ({state.rovers.length})</h2>
        <ul>
          {state.rovers.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> — батарея {r.battery}%, грузоподъёмность {r.capacity_kg} кг,
              статус <code>{r.status}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Заказы ({state.orders.length})</h2>
        <ul>
          {state.orders.map((o) => (
            <li key={o.id}>
              <strong>{o.title}</strong> — {o.weight_kg} кг, награда {o.reward}, дедлайн {o.deadline_hours} ч,
              зона «{zoneName(o.zone_id)}», статус <code>{o.status}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Доставки ({state.deliveries.length})</h2>
        {state.deliveries.length === 0
          ? <p className="muted">Пока ни одной.</p>
          : (
            <ul>
              {state.deliveries.map((d) => (
                <li key={d.id}>
                  #{d.id}: ровер {d.rover_id} → заказ {d.order_id}, статус <code>{d.status}</code>
                </li>
              ))}
            </ul>
          )}
      </section>
    </main>
  );
}
