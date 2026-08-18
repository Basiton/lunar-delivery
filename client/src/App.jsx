import { useCallback, useEffect, useRef, useState } from 'react';
import MoonMap from './MoonMap.jsx';
import RoverPanel from './RoverPanel.jsx';

const POLL_MS = 2000;

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRover, setSelectedRover] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  // Единственный источник данных — /api/state. Ответ не накладывается сам на
  // себя: если предыдущий опрос ещё идёт, такт пропускается.
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function dispatch() {
    if (!selectedRover || !selectedOrder) return;
    setSending(true);
    try {
      const res = await fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rover_id: selectedRover, order_id: selectedOrder }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setSelectedRover(null);
      setSelectedOrder(null);
      await load(); // не ждём следующего такта поллинга
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (!state) {
    return (
      <div className="app">
        <p className="loading">{error ? `Ошибка загрузки: ${error}` : 'Загрузка карты…'}</p>
      </div>
    );
  }

  const order = state.orders.find((o) => o.id === selectedOrder);
  const rover = state.rovers.find((r) => r.id === selectedRover);
  const ready = Boolean(order && rover);

  return (
    <div className="app">
      <div className="map-wrap">
        <MoonMap
          state={state}
          selectedOrder={selectedOrder}
          selectedRover={selectedRover}
          onSelectOrder={(id) => setSelectedOrder((cur) => (cur === id ? null : id))}
        />
      </div>

      <aside className="sidebar">
        <header className="brand">
          <h1>Lunar Delivery</h1>
          <span className="muted">{state.deliveries.filter((d) => d.status === 'in_progress').length} в пути</span>
        </header>

        <RoverPanel
          rovers={state.rovers}
          selectedRover={selectedRover}
          onSelectRover={(id) => setSelectedRover((cur) => (cur === id ? null : id))}
        />

        <section className="panel dispatch">
          <h2>Отправка</h2>
          <div className="slot">
            <span className="slot-label">ровер</span>
            <span className={rover ? '' : 'muted'}>{rover ? rover.name : 'не выбран'}</span>
          </div>
          <div className="slot">
            <span className="slot-label">заказ</span>
            <span className={order ? '' : 'muted'}>{order ? order.title : 'не выбран'}</span>
          </div>
          {order && rover && order.weight_kg > rover.capacity_kg && (
            <p className="warn">вес {order.weight_kg} кг больше грузоподъёмности {rover.capacity_kg} кг</p>
          )}
          <button type="button" className="dispatch-btn" disabled={!ready || sending} onClick={dispatch}>
            {sending ? 'Отправляем…' : 'Отправить'}
          </button>
          {error && <p className="warn">{error}</p>}
        </section>

        <section className="panel">
          <h2>Журнал</h2>
          <ul className="events">
            {state.events.slice(0, 8).map((e) => (
              <li key={e.id}><span className="event-type">{e.type}</span> {e.message}</li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
