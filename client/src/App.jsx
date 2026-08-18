import { useCallback, useEffect, useRef, useState } from 'react';
import MoonMap from './MoonMap.jsx';
import RoverPanel from './RoverPanel.jsx';
import TopBar from './TopBar.jsx';
import EventLog from './EventLog.jsx';

const POLL_MS = 2000;

export default function App() {
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState(null); // отказы сервера показываем пользователю
  const [selectedRover, setSelectedRover] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [busy, setBusy] = useState(false);
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
    } catch (e) {
      setNotice({ kind: 'error', text: `Нет связи с сервером: ${e.message}` });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /** Любой изменяющий запрос: причину отказа (422) показываем как есть. */
  async function send(url, body) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: 'error', text: data.error ?? `Ошибка ${res.status}` });
        return null;
      }
      await load();
      return data;
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function dispatchDelivery() {
    if (!selectedRover || !selectedOrder) return;
    const data = await send('/api/deliveries', { rover_id: selectedRover, order_id: selectedOrder });
    if (!data) return;
    setSelectedRover(null);
    setSelectedOrder(null);
    if (data.risk) setNotice({ kind: 'warn', text: `Происшествие в пути: ${data.risk.message}` });
  }

  async function newGame() {
    setSelectedRover(null);
    setSelectedOrder(null);
    await send('/api/game/reset');
  }

  const togglePause = useCallback(() => {
    if (state?.game_state.status !== 'running') return;
    send('/api/game/pause');
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Пробел — пауза. preventDefault нужен дважды: он гасит прокрутку страницы
  // и не даёт пробелу «нажать» кнопку, на которой остался фокус, иначе пауза
  // переключилась бы дважды за одно нажатие.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause]);

  if (!state) {
    return <div className="app-loading">{notice?.text ?? 'Загрузка карты…'}</div>;
  }

  const game = state.game_state;
  const order = state.orders.find((o) => o.id === selectedOrder);
  const rover = state.rovers.find((r) => r.id === selectedRover);
  const inTransit = state.deliveries.filter((d) => d.status === 'in_progress').length;
  const finished = game.status !== 'running';

  return (
    <div className="app">
      <TopBar gameState={game} inTransit={inTransit} onNewGame={newGame} onTogglePause={togglePause} />

      <div className="map-wrap">
        <MoonMap
          state={state}
          paused={Boolean(game.paused)}
          selectedOrder={selectedOrder}
          selectedRover={selectedRover}
          onSelectOrder={(id) => setSelectedOrder((cur) => (cur === id ? null : id))}
        />
      </div>

      <aside className="sidebar">
        <RoverPanel
          rovers={state.rovers}
          selectedRover={selectedRover}
          onSelectRover={(id) => setSelectedRover((cur) => (cur === id ? null : id))}
          onCharge={(id) => send(`/api/rovers/${id}/charge`)}
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

          <button type="button" className="dispatch-btn"
                  disabled={!order || !rover || busy} onClick={dispatchDelivery}>
            {busy ? 'Отправляем…' : 'Отправить'}
          </button>

          {order && (
            <button type="button" className="decline-btn" disabled={busy}
                    onClick={() => send(`/api/orders/${order.id}/decline`).then(() => setSelectedOrder(null))}>
              Отклонить заказ (−5 рейтинга)
            </button>
          )}

          {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
        </section>
      </aside>

      <EventLog events={state.events} />

      {finished && (
        <div className="overlay">
          <div className={`result ${game.status}`}>
            <h2>{game.status === 'won' ? 'Победа' : 'Поражение'}</h2>
            <p className="result-text">
              {game.status === 'won'
                ? `База продержалась 7 суток и заработала ${game.credits} ₡.`
                : 'Рейтинг базы упал до нуля — контракт расторгнут.'}
            </p>
            <div className="result-stats">
              <div><span>сутки</span><strong>{game.day}</strong></div>
              <div><span>кредиты</span><strong>{game.credits} ₡</strong></div>
              <div><span>рейтинг</span><strong>{game.rating}</strong></div>
            </div>
            <button type="button" className="dispatch-btn" onClick={newGame} disabled={busy}>
              Новая игра
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
