```tsx
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
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted">
        Aucune donnée.
      </div>
    );
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: PADDING_X + i * stepX,
    y: PADDING_TOP + plotHeight - (p.value / max) * plotHeight,
  }));

  // Avec noUncheckedIndexedAccess=true, TypeScript considère
  // coords[0] et coords[coords.length - 1] comme potentiellement undefined.
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];

  // Cette vérification garantit également que le composant reste
  // robuste si le tableau coords venait à être vide.
  if (!firstCoord || !lastCoord) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted">
        Aucune donnée.
      </div>
    );
  }

  const linePath = coords
    .map(
      (c, i) =>
        `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`
    )
    .join(" ");

  const areaPath = `${linePath} L ${lastCoord.x.toFixed(1)} ${(
    PADDING_TOP + plotHeight
  ).toFixed(1)} L ${firstCoord.x.toFixed(1)} ${(
    PADDING_TOP + plotHeight
  ).toFixed(1)} Z`;

  const fmt =
    formatValue ?? ((v: number) => v.toLocaleString("fr-FR"));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-[220px] w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient
          id="lineAreaGradient"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#7C3AED"
            stopOpacity="0.28"
          />
          <stop
            offset="100%"
            stopColor="#7C3AED"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      <path d={areaPath} fill="url(#lineAreaGradient)" />

      <path
        d={linePath}
        fill="none"
        stroke="#7C3AED"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {coords.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r="3"
          fill="#7C3AED"
        />
      ))}

      {points.map((p, i) => {
        const coord = coords[i];

        if (!coord) {
          return null;
        }

        return (
          <text
            key={p.label}
            x={coord.x}
            y={HEIGHT - 6}
            textAnchor={
              i === 0
                ? "start"
                : i === points.length - 1
                  ? "end"
                  : "middle"
            }
            fontSize="10"
            fill="#6B6459"
          >
            {p.label}
          </text>
        );
      })}

      <title>
        {points.map((p) => `${p.label}: ${fmt(p.value)}`).join(" • ")}
      </title>
    </svg>
  );
}
```
