import { batteryColor } from './layout.js';

const STATUS_LABEL = {
  idle: 'свободен',
  delivering: 'в пути',
  charging: 'на зарядке',
  damaged: 'повреждён',
};

export default function RoverPanel({ rovers, selectedRover, onSelectRover }) {
  return (
    <section className="panel">
      <h2>Роверы</h2>
      {rovers.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`rover-card${selectedRover === r.id ? ' selected' : ''}`}
          onClick={() => onSelectRover(r.id)}
          aria-pressed={selectedRover === r.id}
        >
          <div className="rover-head">
            <strong>{r.name}</strong>
            <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
          </div>

          <div className="battery">
            <div className="battery-track">
              <div className="battery-fill"
                   style={{ width: `${r.battery}%`, background: batteryColor(r.battery) }} />
            </div>
            <span className="battery-value">{r.battery}%</span>
          </div>

          <div className="rover-meta">грузоподъёмность {r.capacity_kg} кг</div>
        </button>
      ))}
    </section>
  );
}
