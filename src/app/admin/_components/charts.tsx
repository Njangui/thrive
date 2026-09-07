/**
 * Graphiques SVG faits main pour la console Super Admin. Le projet n'a
 * aucune dépendance de charting (pas de recharts/chart.js dans
 * package.json) — plutôt que d'en ajouter une pour deux graphiques,
 * ceux-ci sont du SVG pur, sans JS d'exécution (server components,
 * comme le reste de la console). Données réelles uniquement : chaque
 * graphique reçoit exactement les points calculés par
 * `admin-overview-service.ts`, jamais de valeur interpolée ou inventée.
 */

export function AdminLineChart({
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
          <stop offset="0%" stopColor="#5B21E5" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#5B21E5" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((y) => (
        <line key={y} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#0E1130" strokeOpacity={0.05} strokeWidth={1} />
      ))}
      <path d={areaPath} fill="url(#adm-line-fill)" stroke="none" />
      <path d={linePath} fill="none" stroke="#5B21E5" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c.label} cx={c.x} cy={c.y} r={3.5} fill="#5B21E5" stroke="white" strokeWidth={1.5} />
      ))}
      {coords.map((c) => (
        <text key={`${c.label}-label`} x={c.x} y={height - 8} textAnchor="middle" fontSize={11} fill="#64748B">
          {c.label}
        </text>
      ))}
    </svg>
  );
}

export function AdminDonutChart({
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
  let offsetAcc = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative h-[168px] w-[168px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#F0EDFB" strokeWidth="14" />
          {segments.map((s) => {
            const fraction = s.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const circle = (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offsetAcc}
                strokeLinecap="butt"
              />
            );
            offsetAcc += dash;
            return circle;
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
