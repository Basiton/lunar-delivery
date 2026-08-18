import { batteryColor } from './layout.js';

const STATUS_LABEL = {
  idle: 'свободен',
  delivering: 'в пути',
  charging: 'на зарядке',
  damaged: 'повреждён',
};

export default function RoverPanel({ rovers, selectedRover, onSelectRover, onCharge }) {
  return (
    <section className="panel">
      <h2>Роверы</h2>
      {rovers.map((r) => {
        // Ровер «на базе» — любой, кто не в рейсе; заряжать в пути нельзя.
        const atBase = r.status !== 'delivering';
        const canCharge = atBase && r.status !== 'charging' && r.battery < 100;

        return (
          <div key={r.id} className={`rover-card${selectedRover === r.id ? ' selected' : ''}`}>
            <button type="button" className="rover-main" onClick={() => onSelectRover(r.id)}
                    aria-pressed={selectedRover === r.id}>
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

            {canCharge && (
              <button type="button" className="charge-btn" onClick={() => onCharge(r.id)}>
                Зарядить {r.status === 'damaged' ? 'и починить' : ''}
              </button>
            )}
            {r.status === 'charging' && <div className="charging-note">заряжается, +10 в час</div>}
          </div>
        );
      })}
    </section>
  );
}
