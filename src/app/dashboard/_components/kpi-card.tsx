import { Icon } from "./icons";

export function KpiCard({
  label,
  value,
  trend,
  alert,
}: {
  label: string;
  value: string;
  /** Variation par rapport à la période précédente, ex. "+18.2%". Omis si non calculable. */
  trend?: { direction: "up" | "down"; text: string };
  alert?: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${alert ? "border-danger/30" : "border-ink/5"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${alert ? "text-danger" : "text-ink"}`}>{value}</p>
      {trend && (
        <p
          className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${
            trend.direction === "up" ? "text-success" : "text-danger"
          }`}
        >
          <Icon name={trend.direction} className="h-3.5 w-3.5" />
          {trend.text}
        </p>
      )}
    </div>
  );
}
