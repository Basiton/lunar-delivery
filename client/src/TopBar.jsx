import { batteryColor } from './layout.js';

const pad = (n) => String(n).padStart(2, '0');

export default function TopBar({ gameState, inTransit, onNewGame }) {
  const { day, hour, credits, rating } = gameState;

  return (
    <header className="topbar">
      <div className="brand-title">Lunar Delivery</div>

      <div className="stat">
        <span className="stat-label">сутки</span>
        <span className="stat-value">{day}<span className="stat-sub"> / 7</span></span>
      </div>

      <div className="stat">
        <span className="stat-label">время</span>
        <span className="stat-value">{pad(hour)}:00</span>
      </div>

      <div className="stat">
        <span className="stat-label">кредиты</span>
        <span className="stat-value credits">{credits}<span className="stat-sub"> / 5000 ₡</span></span>
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

      <button type="button" className="ghost-btn" onClick={onNewGame}>Новая игра</button>
    </header>
  );
}
