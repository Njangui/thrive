/**
 * Ligne + aire dégradée en SVG fait main. Pas de recharts/chart.js : ce
 * sandbox n'a pas d'accès réseau pour `npm install` une nouvelle
 * dépendance, donc impossible de vérifier qu'elle se résout correctement.
 * Un graphique aussi simple (une seule série, pas d'interaction complexe)
 * n'en a de toute façon pas besoin.
 */
const WIDTH = 640;
const HEIGHT = 220;
const PADDING_X = 8;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 28;

export function LineAreaChart({
  points,
  formatValue,
}: {
  points: { label: string; value: number }[];
  formatValue?: (value: number) => string;
}) {
  if (points.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-sm text-muted">Aucune donnée.</div>;
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  // Un seul tableau combiné (position + label + valeur) : on ne croise
  // jamais deux tableaux par index, donc rien à sécuriser vis-à-vis de
  // `noUncheckedIndexedAccess` (contrairement à la version précédente qui
  // indexait `coords[i]`, `coords[0]` et `coords[coords.length - 1]`
  // séparément — ce qui a fait échouer le build Vercel).
  const plotted = points.map((p, i) => ({
    x: PADDING_X + i * stepX,
    y: PADDING_TOP + plotHeight - (p.value / max) * plotHeight,
    label: p.label,
    value: p.value,
  }));

  const linePath = plotted.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  const firstX = PADDING_X;
  const lastX = PADDING_X + (points.length - 1) * stepX;
  const baselineY = (PADDING_TOP + plotHeight).toFixed(1);
  const areaPath = `${linePath} L ${lastX.toFixed(1)} ${baselineY} L ${firstX.toFixed(1)} ${baselineY} Z`;

  const fmt = formatValue ?? ((v: number) => v.toLocaleString("fr-FR"));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[220px] w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#lineAreaGradient)" />
      <path d={linePath} fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {plotted.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3" fill="#7C3AED" />
      ))}
      {plotted.map((c, i) => (
        <text
          key={c.label}
          x={c.x}
          y={HEIGHT - 6}
          textAnchor={i === 0 ? "start" : i === plotted.length - 1 ? "end" : "middle"}
          fontSize="10"
          fill="#6B6459"
        >
          {c.label}
        </text>
      ))}
      <title>{plotted.map((c) => `${c.label}: ${fmt(c.value)}`).join(" • ")}</title>
    </svg>
  );
}
