/**
 * Graphiques SVG faits main — chrome de l'app authentifiée CRESYVA
 * (Super Admin `/admin/*` ET dashboard marchand `/dashboard/*`).
 *
 * Déplacé de `admin/_components/charts.tsx` vers ici (sept. 2026, chantier
 * d'unification design) — même raisonnement que `app-icons.tsx` : le
 * dashboard marchand a besoin des MÊMES graphiques (évolution des ventes,
 * répartition), source unique ici plutôt que dupliquer ~140 lignes de SVG.
 *
 * Toujours aucune dépendance de charting (pas de recharts/chart.js) — SVG
 * pur, données réelles uniquement, jamais de valeur interpolée ou inventée.
 */
export function AppLineChart({
  points,
  height = 200,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const width = 600;
  const paddingX = 8;
  const paddingTop = 16;
  const paddingBottom = 28;
  const plotHeight = height - paddingTop - paddingBottom;
  const plotWidth = width - paddingX * 2;

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = points.length === 1 ? paddingX : paddingX + (i / (points.length - 1)) * plotWidth;
    const y = paddingTop + plotHeight - ((p.value - min) / range) * plotHeight;
    return { x, y, ...p };
  });

  if (coords.length === 0) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Aucune donnée">
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="#64748B">
          Pas encore de données
        </text>
      </svg>
    );
  }

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const firstCoord = coords[0]!;
  const lastCoord = coords[coords.length - 1]!;
  const areaPath = `${linePath} L${lastCoord.x.toFixed(1)},${(paddingTop + plotHeight).toFixed(1)} L${firstCoord.x.toFixed(1)},${(paddingTop + plotHeight).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => paddingTop + plotHeight * t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Évolution sur la période">
      <defs>
        <linearGradient id="adm-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00D1A0" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#00D1A0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((y) => (
        <line key={y} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#0F172A" strokeOpacity={0.05} strokeWidth={1} />
      ))}
      <path d={areaPath} fill="url(#adm-line-fill)" stroke="none" />
      <path d={linePath} fill="none" stroke="#00D1A0" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c.label} cx={c.x} cy={c.y} r={3.5} fill="#00D1A0" stroke="white" strokeWidth={1.5} />
      ))}
      {coords.map((c) => (
        <text key={`${c.label}-label`} x={c.x} y={height - 8} textAnchor="middle" fontSize={11} fill="#64748B">
          {c.label}
        </text>
      ))}
    </svg>
  );
}

export function AppDonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  // Arcs calculés sans mutation pendant le rendu : décalage de chaque segment = somme des longueurs précédentes.
  const arcs = segments.map((s) => {
    const dash = (s.value / total) * circumference;
    return { dash, gap: circumference - dash };
  });
  const offsets = arcs.map((_, i) => arcs.slice(0, i).reduce((sum, arc) => sum + arc.dash, 0));

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#F0EDFB" strokeWidth="14" />
          {segments.map((s, i) => {
            const { dash, gap } = arcs[i] ?? { dash: 0, gap: circumference };
            return (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-(offsets[i] ?? 0)}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        {centerValue ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="font-jakarta text-lg font-bold text-navy-900">{centerValue}</p>
            {centerLabel ? <p className="text-xs adm-muted">{centerLabel}</p> : null}
          </div>
        ) : null}
      </div>
      <ul className="flex w-full flex-col gap-2.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 text-navy-900/80">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-navy-900">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppBarChart({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  const width = 600;
  const height = 220;
  const padding = { top: 18, right: 12, bottom: 42, left: 12 };
  const chartHeight = height - padding.top - padding.bottom;
  const chartWidth = width - padding.left - padding.right;
  const max = Math.max(...items.map((item) => item.value), 1);
  const slot = items.length ? chartWidth / items.length : chartWidth;
  const barWidth = Math.min(72, slot * 0.56);

  if (!items.length) {
    return <div className="grid min-h-[220px] place-items-center text-sm adm-muted">Pas encore de données.</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Répartition des abonnés par plan">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = padding.top + chartHeight - chartHeight * ratio;
        return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#0F172A" strokeOpacity={0.05} />;
      })}
      {items.map((item, index) => {
        const barHeight = (item.value / max) * chartHeight;
        const x = padding.left + index * slot + (slot - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        return (
          <g key={item.label}>
            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 2)} rx={8} fill="#00D1A0" opacity={0.9} />
            <text x={x + barWidth / 2} y={Math.max(y - 7, 12)} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0F172A">
              {item.value}
            </text>
            <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" fontSize={10.5} fill="#64748B">
              {item.label.length > 13 ? `${item.label.slice(0, 12)}…` : item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
