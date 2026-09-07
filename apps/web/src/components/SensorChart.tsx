import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

type Range = '24h' | '7d' | '30d';

interface RawReading {
  ts: string;
  value: string | number;
}
interface BucketReading {
  ts: string;
  avg: string | number;
  min: string | number;
  max: string | number;
}

interface Point {
  t: number;
  value: number;
  min?: number;
  max?: number;
}

const RANGES: { key: Range; label: string; bucket?: 'hour' | 'day'; ms: number }[] = [
  { key: '24h', label: '24 h', ms: 24 * 3600_000 },
  { key: '7d', label: '7 d', bucket: 'hour', ms: 7 * 24 * 3600_000 },
  { key: '30d', label: '30 d', bucket: 'day', ms: 30 * 24 * 3600_000 },
];

const W = 560;
const H = 160;
const PAD = { top: 10, right: 12, bottom: 22, left: 44 };
const LINE = '#2563eb';
const BAND = 'rgba(37, 99, 235, 0.12)';
const GRID = '#e5e7eb';
const INK_MUTED = '#6b7280';

function niceTicks(lo: number, hi: number): number[] {
  if (lo === hi) return [lo];
  const span = hi - lo;
  const step = 10 ** Math.floor(Math.log10(span / 3));
  const mult = span / 3 / step >= 5 ? 5 : span / 3 / step >= 2 ? 2 : 1;
  const s = step * mult;
  const first = Math.ceil(lo / s) * s;
  const ticks: number[] = [];
  for (let v = first; v <= hi + s * 1e-6; v += s) ticks.push(Number(v.toPrecision(10)));
  return ticks;
}

function fmtValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
}

/** Inline SVG time-series chart for one sensor: raw points at 24 h, hourly
 *  avg with a min–max band at 7 d, daily at 30 d. No chart library. */
export function SensorChart({ sensorId, unit }: { sensorId: string; unit: string }) {
  const [range, setRange] = useState<Range>('24h');
  const [points, setPoints] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<number | null>(null); // index into points
  const rootRef = useRef<HTMLDivElement>(null);

  // The chart expands inside a scrollable list; bring it into view on open.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    setPoints(null);
    setHover(null);
    const cfg = RANGES.find((r) => r.key === range)!;
    const from = new Date(Date.now() - cfg.ms).toISOString();
    const query = cfg.bucket
      ? `bucket=${cfg.bucket}&from=${encodeURIComponent(from)}&limit=800`
      : `from=${encodeURIComponent(from)}&limit=2000`;
    let cancelled = false;
    api<(RawReading & BucketReading)[]>(`/sensors/${sensorId}/readings?${query}`)
      .then((rows) => {
        if (cancelled) return;
        const parsed = rows
          .map((r) =>
            'avg' in r && r.avg !== undefined
              ? {
                  t: Date.parse(r.ts),
                  value: Number(r.avg),
                  min: Number(r.min),
                  max: Number(r.max),
                }
              : { t: Date.parse(r.ts), value: Number(r.value) },
          )
          .sort((a, b) => a.t - b.t);
        setPoints(parsed);
      })
      .catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, [sensorId, range]);

  const geom = useMemo(() => {
    if (!points || points.length === 0) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const values = points.flatMap((p) => [p.min ?? p.value, p.max ?? p.value, p.value]);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 0.5;
      hi += 0.5;
    }
    const x = (t: number) =>
      t1 === t0
        ? (PAD.left + W - PAD.right) / 2
        : PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const line = points.map(
      (p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`,
    );
    const hasBand = points.some((p) => p.min !== undefined && p.min !== p.max);
    const band = hasBand
      ? [
          ...points.map(
            (p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.max ?? p.value).toFixed(1)}`,
          ),
          ...[...points]
            .reverse()
            .map((p) => `L${x(p.t).toFixed(1)},${y(p.min ?? p.value).toFixed(1)}`),
          'Z',
        ].join('')
      : null;
    return { x, y, lo, hi, t0, t1, line: line.join(''), band };
  }, [points]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points || !geom || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geom.x(p.t) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hoverPoint = hover !== null && points ? points[hover] : null;
  const fmtTime = (t: number) =>
    range === '24h'
      ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric' });

  return (
    <div className="sensor-chart" ref={rootRef}>
      <div className="chart-ranges">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={range === r.key ? 'active' : ''}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
        {hoverPoint && (
          <span className="chart-readout">
            {fmtTime(hoverPoint.t)} · <strong>{fmtValue(hoverPoint.value)}</strong> {unit}
            {hoverPoint.min !== undefined &&
              hoverPoint.min !== hoverPoint.max &&
              ` (${fmtValue(hoverPoint.min!)}–${fmtValue(hoverPoint.max!)})`}
          </span>
        )}
      </div>
      {points === null && <p className="muted">Loading…</p>}
      {points !== null && points.length === 0 && <p className="muted">No readings in range</p>}
      {points !== null && points.length > 0 && geom && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`Sensor readings over the last ${range}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {niceTicks(geom.lo, geom.hi).map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geom.y(v)}
                y2={geom.y(v)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={geom.y(v) + 3.5}
                textAnchor="end"
                fontSize={10}
                fill={INK_MUTED}
              >
                {fmtValue(v)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 6} fontSize={10} fill={INK_MUTED}>
            {fmtTime(geom.t0)}
          </text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill={INK_MUTED}>
            {fmtTime(geom.t1)}
          </text>
          {geom.band && <path d={geom.band} fill={BAND} stroke="none" />}
          <path d={geom.line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
          {hoverPoint && (
            <g>
              <line
                x1={geom.x(hoverPoint.t)}
                x2={geom.x(hoverPoint.t)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={INK_MUTED}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={geom.x(hoverPoint.t)}
                cy={geom.y(hoverPoint.value)}
                r={4}
                fill={LINE}
                stroke="#fff"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
