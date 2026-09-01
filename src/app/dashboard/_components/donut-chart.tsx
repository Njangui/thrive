const PALETTE = ["#7C3AED", "#EC4899", "#F59E0B", "#16A34A", "#94A3B8", "#3B82F6"];

const SIZE = 160;
const RADIUS = 62;
const STROKE = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; percent: number }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.percent, 0);

  if (slices.length === 0 || total === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted">Aucune donnée.</div>;
  }

  let cumulativePercent = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-40 w-40 -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#F1EEF9" strokeWidth={STROKE} />
          {slices.map((slice, i) => {
            const dash = (slice.percent / 100) * CIRCUMFERENCE;
            const offset = (cumulativePercent / 100) * CIRCUMFERENCE;
            cumulativePercent += slice.percent;
            return (
              <circle
                key={slice.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={PALETTE[i % PALETTE.length] ?? "#7C3AED"}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap={slices.length === 1 ? "butt" : "round"}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[11px] text-muted">{centerLabel}</p>
          <p className="font-display text-sm font-bold leading-tight text-ink">{centerValue}</p>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 text-sm">
        {slices.map((slice, i) => (
          <li key={slice.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] ?? "#7C3AED" }}
              />
              <span className="truncate text-ink/80">{slice.label}</span>
            </span>
            <span className="shrink-0 font-medium text-ink">{slice.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
