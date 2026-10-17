import { cn } from "@/lib/utils";

export interface BarSeries {
  name: string;
  /** Any CSS colour, normally a theme variable such as `var(--primary)`. */
  color: string;
}

/** A "nice" round upper bound for the axis (1, 2, 5 × 10ⁿ), so gridlines land on readable numbers. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Dependency-free grouped bar chart drawn in SVG.
 * `values[s][i]` is series s at point i. Every number is also available to screen readers as a table,
 * because a picture of data is not an accessible way to read it.
 */
export function BarChart({
  title,
  labels,
  series,
  values,
  formatValue = (n) => String(n),
  height = 180,
  className,
}: {
  title: string;
  labels: string[];
  series: BarSeries[];
  values: number[][];
  formatValue?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const W = 640;
  const padL = 44;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL - 4;
  const plotH = height - padB - padT;
  const n = labels.length;
  const top = niceMax(Math.max(0, ...values.flat()));
  const slot = n > 0 ? plotW / n : plotW;
  const group = slot * 0.72;
  const bar = group / Math.max(1, series.length);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  // Label roughly six x positions so they never collide.
  const every = Math.max(1, Math.ceil(n / 6));

  return (
    <figure className={cn("w-full", className)}>
      <figcaption className="sr-only">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} className="h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.12} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.65}>
              {formatValue(Math.round(t))}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <g key={`${label}-${i}`}>
            {series.map((s, si) => {
              const v = values[si]?.[i] ?? 0;
              const h = Math.max(0, plotH - (y(v) - padT));
              return (
                <rect
                  key={s.name}
                  x={padL + i * slot + (slot - group) / 2 + si * bar}
                  y={y(v)}
                  width={Math.max(1, bar - 1)}
                  height={v > 0 ? Math.max(1, h) : 0}
                  rx={2}
                  fill={s.color}
                >
                  <title>{`${label} · ${s.name}: ${formatValue(v)}`}</title>
                </rect>
              );
            })}
            {i % every === 0 && (
              <text x={padL + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity={0.65}>
                {label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
          {series.map((s) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.name}
            </li>
          ))}
        </ul>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={`${label}-${i}`}>
              <th scope="row">{label}</th>
              {series.map((s, si) => (
                <td key={s.name}>{formatValue(values[si]?.[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
