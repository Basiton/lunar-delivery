const pad = (n) => String(n).padStart(2, '0');

// Тип события задаёт цвет строки: риск и штрафы должны быть видны сразу.
const TONE = {
  risk_battery: 'warn',
  risk_delay: 'warn',
  risk_breakdown: 'bad',
  order_expired: 'bad',
  order_declined: 'bad',
  game_lost: 'bad',
  delivered: 'good',
  charged: 'good',
  game_won: 'good',
  order_oversized: 'warn',
};

export default function EventLog({ events }) {
  return (
    <section className="log">
      <h2>Журнал событий</h2>
      <ul>
        {events.slice(0, 15).map((e) => (
          <li key={e.id} className={TONE[e.type] ?? ''}>
            <span className="log-time">
              {e.day != null ? `д${e.day} ${pad(e.hour)}:00` : '—'}
            </span>
            <span className="log-type">{e.type}</span>
            <span className="log-msg">{e.message}</span>
          </li>
        ))}
        {events.length === 0 && <li className="muted">Пока пусто.</li>}
      </ul>
    </section>
  );
}
