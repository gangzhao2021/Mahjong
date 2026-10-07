/**
 * Daily trend line chart in plain SVG: 2px lines, recessive hairline grid,
 * one y-axis, crosshair + tooltip listing every series, end-value labels,
 * a legend for 2+ series, and a table view (dataviz skill rules).
 */
import { useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  /** CSS color token, e.g. var(--series-1). */
  color: string;
  values: number[];
}

interface Props {
  title: string;
  days: string[];
  series: Series[];
  format?: (n: number) => string;
  /** Faded while new data loads (keep the frame, no skeleton). */
  loading?: boolean;
}

const W = 560;
const H = 220;
const M = { top: 12, right: 56, bottom: 26, left: 52 };

/** Clean axis maximum and tick step (1/2/5 × 10^k); whole steps for counts. */
function niceScale(max: number, integer: boolean): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  if (integer) step = Math.max(1, step);
  return { max: Math.ceil(max / step) * step, step };
}

const compact = (n: number) =>
  Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : Math.abs(n) >= 1e4 ? `${(n / 1e4).toFixed(Math.abs(n) >= 1e5 ? 0 : 1)}万` : n.toLocaleString('zh-CN');

export function LineChart({ title, days, series, format = (n) => n.toLocaleString('zh-CN'), loading }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const { max, step } = useMemo(() => {
    const values = series.flatMap((s) => s.values);
    return niceScale(Math.max(0, ...values), values.every(Number.isInteger));
  }, [series]);
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  const last = days.length - 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = days.length <= 1 ? 0 : Math.round(((px - M.left) / innerW) * (days.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className="card chart-card" style={{ opacity: loading ? 0.5 : 1 }}>
      <div className="head">
        <h3>{title}</h3>
        <div className="row">
          {series.length >= 2 && (
            <div className="legend" aria-hidden>
              {series.map((s) => (
                <span key={s.name}>
                  <span className="key" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          )}
          <button onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? '图表' : '表格'}
          </button>
        </div>
      </div>

      {showTable ? (
        <table>
          <thead>
            <tr>
              <th>日期</th>
              {series.map((s) => (
                <th key={s.name} className="num">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}>
                <td>{d}</td>
                {series.map((s) => (
                  <td key={s.name} className="num">
                    {format(s.values[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`${title}：${series.map((s) => `${s.name} 最近一天 ${format(s.values[last] ?? 0)}`).join('，')}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? -1) + 1));
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {compact(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === last ? (
              <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {d.slice(5)}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <polyline
              key={s.name}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* End markers with direct value labels (text in ink, never the series color). */}
          {series.map((s) => (
            <g key={`end-${s.name}`}>
              <circle cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              <text x={x(last) + 8} y={y(s.values[last] ?? 0)} dy="0.32em" fontSize={11} fill="var(--text-secondary)">
                {compact(s.values[last] ?? 0)}
              </text>
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke="var(--axis)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}

      {hover !== null && !showTable && (
        <div className="tooltip" style={{ left: `calc(${(x(hover) / W) * 100}% + ${x(hover) > W * 0.6 ? -150 : 12}px)`, top: 48 }}>
          <div className="muted">{days[hover]}</div>
          {series.map((s) => (
            <div key={s.name}>
              <span className="legend">
                <span className="key" style={{ background: s.color }} />
              </span>
              <strong>{format(s.values[hover])}</strong> <span className="secondary">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
