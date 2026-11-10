import { useEffect, useState } from 'react';
import { ProbChart, Scoreboard } from './LivePanel.jsx';

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const pct = (p) => `${Math.round(p * 100)}%`;

export default function App() {
  const [code, setCode] = useState('');
  const [match, setMatch] = useState(null);
  const [mood, setMood] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadMood(matchCode, playerTicker) {
    setLoading(true);
    setError('');
    setMood(null);
    try {
      const q = new URLSearchParams({ code: matchCode, ...(playerTicker ? { player: playerTicker } : {}) });
      const data = await getJson(`/api/mood?${q}`);
      setMatch(data.match);
      setMood(data);
      window.history.replaceState(null, '', `?${new URLSearchParams({ code: data.match.eventTicker, player: data.player.ticker })}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // While the match is live, refresh price/score/chart every 20s (no LLM calls; photo + monologue are kept).
  const live = mood?.score?.state === 'live';
  const liveKey = mood ? `${mood.match.eventTicker}|${mood.player.ticker}` : null;
  useEffect(() => {
    if (!live || !liveKey) return;
    const [eventTicker, player] = liveKey.split('|');
    const id = setInterval(async () => {
      try {
        const fresh = await getJson(`/api/live?${new URLSearchParams({ code: eventTicker, player })}`);
        setMood((m) => (m && m.player.ticker === player ? { ...m, ...fresh, updatedAt: Date.now() } : m));
        setMatch(fresh.match);
      } catch {
        /* keep last good data */
      }
    }, 20000);
    return () => clearInterval(id);
  }, [live, liveKey]);

  // Deep link: /?code=KXATPMATCH-...&player=KXATPMATCH-...-RIN loads immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('code');
    if (c) {
      setCode(c);
      loadMood(c, q.get('player'));
    }
  }, []);

  function onSubmit(e) {
    e.preventDefault();
    setMatch(null);
    loadMood(code, null);
  }

  return (
    <main className="wrap">
      <header>
        <h1>🎾 Tennis Mood Meter</h1>
        <p className="sub">Kalshi win probability → how the player is feeling right now.</p>
      </header>

      <form className="search" onSubmit={onSubmit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Kalshi code, e.g. KXATPMATCH-26NOV09RINKEC-RIN or a kalshi.com URL"
          aria-label="Kalshi match code"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !code.trim()}>
          {loading ? 'Reading the room…' : 'Submit'}
        </button>
      </form>
      <p className="hint">
        Use a match ticker (both players) or a market ticker ending in the player code (e.g. <code>-RIN</code>).
      </p>

      {error && <div className="error">⚠️ {error}</div>}

      {match && (
        <div className="players">
          {match.players.map((p) => (
            <button
              key={p.ticker}
              className={`chip ${mood?.player.ticker === p.ticker ? 'active' : ''}`}
              disabled={loading}
              onClick={() => loadMood(match.eventTicker, p.ticker)}
            >
              {p.name} · {pct(p.probability)}
            </button>
          ))}
        </div>
      )}

      <section className="stage" aria-live="polite">
        {loading && <div className="placeholder pulse">🔎 Checking Kalshi and searching for a photo…</div>}
        {!loading && !mood && <div className="placeholder">Your player will appear here.</div>}
        {!loading && mood && <MoodCard mood={mood} />}
      </section>
    </main>
  );
}

function MoodCard({ mood }) {
  const { player, opponent, emotion, image, monologue, match, score, history } = mood;
  const [imgFailed, setImgFailed] = useState(false);
  const imgSrc = image?.url ? `/api/image?url=${encodeURIComponent(image.url)}` : null;

  return (
    <>
    <article className="card" style={{ '--mood': emotion.color }}>
      <div className="photo">
        {imgSrc && !imgFailed ? (
          <img src={imgSrc} alt={player.name} onError={() => setImgFailed(true)} />
        ) : (
          <div className="nophoto">🎾</div>
        )}
        <span className="badge" title={emotion.label}>{emotion.emoji}</span>
        {monologue && <div className="bubble">{monologue}</div>}
      </div>

      <div className="info">
        <div className="match">{match.subtitle || match.title}</div>
        <h2>{player.name}</h2>
        <div className="feeling">
          feels <strong>{emotion.label}</strong>
        </div>
        <p className="blurb">{emotion.blurb}</p>

        <div className="meter" aria-label={`Win probability ${pct(player.probability)}`}>
          <div className="fill" style={{ width: pct(player.probability) }} />
        </div>
        <div className="meter-labels">
          <span>{player.name.split(' ').slice(-1)} {pct(player.probability)}</span>
          {opponent && <span>{opponent.name.split(' ').slice(-1)} {pct(opponent.probability)}</span>}
        </div>

        <div className="meta">
          Price: {player.method} ·{' '}
          <a href={match.url} target="_blank" rel="noreferrer">Kalshi</a>
          {image?.source && (
            <>
              {' '}· Photo:{' '}
              <a href={image.source} target="_blank" rel="noreferrer">{image.via}</a>
            </>
          )}
        </div>
      </div>
    </article>

    <section className="live">
      <Scoreboard score={score} players={match.players} selected={player.ticker} />
      {history && (
        <ProbChart
          points={history.byPlayer[player.ticker]}
          playerName={player.name}
          interval={history.interval}
          matchStart={history.matchStart}
        />
      )}
      {score?.state === 'live' && <div className="muted small">Auto-refreshing every 20s{mood.updatedAt ? ` · updated ${new Date(mood.updatedAt).toLocaleTimeString()}` : ''}</div>}
    </section>
    </>
  );
}
