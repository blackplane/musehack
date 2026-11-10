import { useLayoutEffect, useMemo, useRef, useState } from 'react';

const pct = (p) => `${Math.round(p * 100)}%`;
const lastName = (n) => n.split(' ').slice(-1)[0];

export function Scoreboard({ score, players, selected }) {
  if (!score) return <div className="score-empty">No live score available for this match.</div>;
  const started = score.state !== 'scheduled' && score.state !== 'cancelled';
  const when = score.startTime
    ? new Date(score.startTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="scoreboard">
      <div className="score-head">
        <span className={`pill ${score.state}`}>
          {score.state === 'live' && <span className="dot" />}
          {score.label}
        </span>
        <span className="muted">
          {[score.tournament, score.round, score.bestOf && `Best of ${score.bestOf}`].filter(Boolean).join(' · ')}
          {!started && when && ` · starts ${when}`}
        </span>
      </div>
      <table>
        <tbody>
          {players.map((p, i) => (
            <tr key={p.ticker} className={p.ticker === selected ? 'me' : ''}>
              <td className="srv" title={score.server === p.ticker ? 'Serving' : undefined}>
                {score.server === p.ticker ? '🎾' : ''}
              </td>
              <td className="name">
                {p.name}
                {score.winner === p.ticker && <span className="won"> ✓</span>}
              </td>
              {score.sets.map((s, k) => {
                const mine = s.games[i];
                const theirs = s.games[1 - i];
                return (
                  <td key={k} className={`set ${s.done && mine > theirs ? 'won-set' : ''} ${!s.done ? 'current' : ''}`}>
                    {mine}
                    {s.tiebreak && <sup>{s.tiebreak[i]}</sup>}
                  </td>
                );
              })}
              {score.points && <td className="pts">{score.points[i]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const H = 220;
const M = { top: 14, right: 48, bottom: 26, left: 40 };

function timeTicks(t0, t1, n = 5) {
  const step = (t1 - t0) / (n - 1);
  return Array.from({ length: n }, (_, i) => t0 + i * step);
}

export function ProbChart({ points, playerName, interval, matchStart, color = '#4d7c0f' }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (!points?.length) return null;
    const t0 = points[0].t;
    const t1 = Math.max(points[points.length - 1].t, t0 + 1);
    const iw = width - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (t) => M.left + ((t - t0) / (t1 - t0)) * iw;
    const y = (p) => M.top + (1 - p) * ih;
    const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('');
    const area = `${d}L${x(points[points.length - 1].t).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    return { t0, t1, x, y, d, area, iw };
  }, [points, width]);

  if (!geo) return <div className="score-empty">No price history yet.</div>;
  const { t0, t1, x, y, d, area } = geo;
  const fmt = (t) =>
    new Date(t).toLocaleString([], interval === 'minute' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit' });
  const last = points[points.length - 1];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left - M.left) / (width - M.left - M.right)) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(points[best]);
  }

  return (
    <figure className="chart" ref={wrapRef}>
      <figcaption>
        <strong>{lastName(playerName)} win probability</strong>
        <span className="muted"> · Kalshi, per {interval}</span>
      </figcaption>
      <svg width={width} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`${playerName} win probability over time, now ${pct(last.p)}`}>
        <defs>
          <linearGradient id="probFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={M.left} x2={width - M.right} y1={y(g)} y2={y(g)}
              className={g === 0.5 ? 'grid mid' : 'grid'} />
            <text x={M.left - 8} y={y(g)} className="axis" textAnchor="end" dominantBaseline="middle">{g * 100}%</text>
          </g>
        ))}
        {timeTicks(t0, t1).map((t, i, arr) => (
          <text key={t} x={x(t)} y={H - 6} className="axis"
            textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}>{fmt(t)}</text>
        ))}
        {matchStart && matchStart > t0 && matchStart < t1 && (
          <g>
            <line x1={x(matchStart)} x2={x(matchStart)} y1={M.top} y2={y(0)} className="grid mid" />
            <text x={x(matchStart) + 4} y={M.top + 10} className="axis">scheduled start</text>
          </g>
        )}
        <path d={area} fill="url(#probFill)" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.p)} r="4" fill={color} stroke="white" strokeWidth="2" />
        <text x={x(last.t) + 8} y={y(last.p)} className="end-label" dominantBaseline="middle">{pct(last.p)}</text>
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.t)} x2={x(hover.t)} y1={M.top} y2={y(0)} className="crosshair" />
            <circle cx={x(hover.t)} cy={y(hover.p)} r="5" fill={color} stroke="white" strokeWidth="2" />
          </g>
        )}
        <rect x={M.left} y={M.top} width={Math.max(0, width - M.left - M.right)} height={H - M.top - M.bottom} fill="transparent" />
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(x(hover.t) + 12, width - 140), top: Math.max(0, y(hover.p) - 10) }}>
          <div className="tt-val">{pct(hover.p)}</div>
          <div className="muted">{new Date(hover.t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      )}
    </figure>
  );
}
