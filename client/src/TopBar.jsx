import { batteryColor, daysLived } from './layout.js';

const pad = (n) => String(n).padStart(2, '0');

export default function TopBar({ gameState, rules, inTransit, onNewGame, onTogglePause }) {
  const { hour, credits, rating, paused } = gameState;

  return (
    <header className={`topbar${paused ? ' paused' : ''}`}>
      <div className="brand-title">
        Lunar Delivery
        {Boolean(paused) && <span className="pause-badge">пауза</span>}
      </div>

      <div className="stat">
        <span className="stat-label">сутки</span>
        <span className="stat-value">{daysLived(gameState)}<span className="stat-sub"> / {rules.win_days}</span></span>
      </div>

      <div className="stat">
        <span className="stat-label">время</span>
        <span className="stat-value">{pad(hour)}:00</span>
      </div>

      <div className="stat">
        <span className="stat-label">кредиты</span>
        <span className="stat-value credits">{credits}<span className="stat-sub"> / {rules.win_credits} ₡</span></span>
      </div>

      <div className="stat rating-stat">
        <span className="stat-label">рейтинг базы</span>
        <span className="stat-value">{rating}</span>
        <div className="rating-track">
          <div className="rating-fill" style={{ width: `${rating}%`, background: batteryColor(rating) }} />
        </div>
      </div>

      <div className="stat">
        <span className="stat-label">в пути</span>
        <span className="stat-value">{inTransit}</span>
      </div>

      <button type="button" className="ghost-btn pause-btn" onClick={onTogglePause}
              title="пробел">
        {paused ? '▶ Продолжить' : '⏸ Пауза'}
      </button>
      <button type="button" className="ghost-btn" onClick={onNewGame}>Новая игра</button>
    </header>
  );
}
