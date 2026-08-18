import { CENTER, CRATERS, MOON_R, VIEW, ZONE_R, orderPos, riskColor, zonePos } from './layout.js';

/** Путь «база -> зона -> база» для анимации ровера. */
function routePath(zone) {
  const p = zonePos(zone);
  return `M ${CENTER.x} ${CENTER.y} L ${p.x} ${p.y} L ${CENTER.x} ${CENTER.y}`;
}

export default function MoonMap({ state, selectedOrder, selectedRover, onSelectOrder }) {
  const { zones, orders, deliveries, rovers } = state;
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const openOrders = orders.filter((o) => o.status === 'open');
  const active = deliveries.filter((d) => d.status === 'in_progress');

  return (
    <svg className="map" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Карта Луны">
      <defs>
        <radialGradient id="moon" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#3a4152" />
          <stop offset="70%" stopColor="#272c38" />
          <stop offset="100%" stopColor="#1b1f28" />
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={VIEW} height={VIEW} fill="#0b0d12" />
      <circle cx={CENTER.x} cy={CENTER.y} r={MOON_R + 26} fill="url(#glow)" />
      <circle cx={CENTER.x} cy={CENTER.y} r={MOON_R} fill="url(#moon)" stroke="#3d4457" strokeWidth="2" />

      {CRATERS.map((c, i) => (
        <g key={i} opacity="0.55">
          <circle cx={c.cx} cy={c.cy} r={c.r} fill="#20242e" stroke="#454c5f" strokeWidth="1.5" />
          <circle cx={c.cx - c.r * 0.18} cy={c.cy - c.r * 0.18} r={c.r * 0.72} fill="#262b36" />
        </g>
      ))}

      {/* маршруты активных доставок */}
      {active.map((d) => {
        const order = orders.find((o) => o.id === d.order_id);
        const zone = order && zoneById.get(order.zone_id);
        if (!zone) return null;
        const p = zonePos(zone);
        return (
          <line key={`route-${d.id}`} x1={CENTER.x} y1={CENTER.y} x2={p.x} y2={p.y}
                stroke="#7dd3fc" strokeWidth="2" strokeDasharray="8 6" opacity="0.5" />
        );
      })}

      {/* зоны */}
      {zones.map((z) => {
        const p = zonePos(z);
        const color = riskColor(z.risk_factor);
        return (
          <g key={z.id}>
            <circle cx={p.x} cy={p.y} r={ZONE_R} fill={color} fillOpacity="0.1"
                    stroke={color} strokeWidth="2" strokeDasharray="6 5" strokeOpacity="0.75" />
            <text x={p.x} y={p.y - ZONE_R - 30} textAnchor="middle" className="zone-name">{z.name}</text>
            <text x={p.x} y={p.y - ZONE_R - 13} textAnchor="middle" className="zone-meta" fill={color}>
              риск {Math.round(z.risk_factor * 100)}% · {z.distance} км
            </text>
          </g>
        );
      })}

      {/* открытые заказы */}
      {zones.flatMap((z) => {
        const inZone = openOrders.filter((o) => o.zone_id === z.id);
        return inZone.map((o, i) => {
          const p = orderPos(z, i, inZone.length);
          const isSelected = selectedOrder === o.id;
          return (
            <g key={`order-${o.id}`} className="order" transform={`translate(${p.x} ${p.y})`}
               onClick={() => onSelectOrder(o.id)} role="button" tabIndex={0}
               onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelectOrder(o.id)}>
              <title>{o.title}</title>
              <rect x="-46" y="-17" width="92" height="34" rx="8"
                    fill={isSelected ? '#1d4ed8' : '#161a22'}
                    stroke={isSelected ? '#93c5fd' : '#4b5568'} strokeWidth={isSelected ? 3 : 1.5} />
              <text y="-3" textAnchor="middle" className="order-weight">{o.weight_kg} кг</text>
              <text y="10" textAnchor="middle" className="order-reward">{o.reward} ₡</text>
            </g>
          );
        });
      })}

      {/* база */}
      <g>
        <circle cx={CENTER.x} cy={CENTER.y} r="30" fill="#111722" stroke="#7dd3fc" strokeWidth="2.5" />
        <circle cx={CENTER.x} cy={CENTER.y} r="9" fill="#7dd3fc" />
        <text x={CENTER.x} y={CENTER.y + 48} textAnchor="middle" className="base-label">БАЗА</text>
      </g>

      {/* роверы в пути: туда и обратно по маршруту */}
      {active.map((d) => {
        const order = orders.find((o) => o.id === d.order_id);
        const zone = order && zoneById.get(order.zone_id);
        if (!zone) return null;
        const rover = rovers.find((r) => r.id === d.rover_id);
        // Дальняя зона проезжается дольше: время хода зависит от distance и speed_factor.
        const dur = Math.max(4, (zone.distance / zone.speed_factor) * 0.16).toFixed(1);
        return (
          <g key={`rover-${d.id}`} className="rover-dot">
            <circle r="11" fill="#7dd3fc" stroke="#0b0d12" strokeWidth="2">
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={routePath(zone)} rotate="auto" />
            </circle>
            <text className="rover-tag" y="-18" textAnchor="middle">
              {rover?.name ?? `#${d.rover_id}`}
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={routePath(zone)} />
            </text>
          </g>
        );
      })}

      {selectedRover && (
        <text x={CENTER.x} y={VIEW - 18} textAnchor="middle" className="hint">
          выбран ровер — кликните заказ на карте
        </text>
      )}
    </svg>
  );
}
