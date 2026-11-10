const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Normalise user input into { eventTicker, marketTicker? }.
 * Accepts:
 *   KXATPMATCH-26NOV09RINKEC          (event)
 *   KXATPMATCH-26NOV09RINKEC-RIN      (market = specific player)
 *   https://kalshi.com/markets/kxatpmatch/.../kxatpmatch-26nov09rinkec
 */
export function parseCode(raw) {
  let code = raw.trim();
  if (!code) throw httpError(400, 'Please enter a Kalshi match code.');
  if (/^https?:\/\//i.test(code)) {
    const parts = new URL(code).pathname.split('/').filter(Boolean);
    code = parts[parts.length - 1] || '';
  }
  code = code.toUpperCase();
  const segments = code.split('-');
  if (segments.length < 2) throw httpError(400, `"${raw}" doesn't look like a Kalshi ticker (e.g. KXATPMATCH-26NOV09RINKEC).`);
  return segments.length >= 3
    ? { eventTicker: segments.slice(0, 2).join('-'), marketTicker: code }
    : { eventTicker: code, marketTicker: null };
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Best single estimate of P(yes) for one market, plus how trustworthy it is. */
function marketEstimate(m) {
  const bid = num(m.yes_bid_dollars);
  const ask = num(m.yes_ask_dollars);
  const last = num(m.last_price_dollars);
  const prev = num(m.previous_price_dollars);
  if (bid !== null && ask !== null && ask > 0 && ask - bid <= 0.15) {
    return { p: (bid + ask) / 2, spread: ask - bid, method: 'bid/ask midpoint' };
  }
  if (last) return { p: last, spread: ask !== null && bid !== null ? ask - bid : null, method: 'last trade' };
  if (prev) return { p: prev, spread: null, method: 'previous close' };
  if (bid !== null && ask !== null && ask > 0) return { p: (bid + ask) / 2, spread: ask - bid, method: 'wide bid/ask midpoint' };
  return null;
}

export async function resolveMatch(rawCode) {
  const { eventTicker, marketTicker } = parseCode(rawCode);
  const res = await fetch(`${KALSHI}/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`);
  if (res.status === 404) throw httpError(404, `Kalshi has no event "${eventTicker}".`);
  if (!res.ok) throw httpError(502, `Kalshi returned ${res.status}.`);
  const { event, markets: topMarkets } = await res.json();
  const markets = event.markets || topMarkets || [];
  if (!markets.length) throw httpError(404, `No markets found for ${eventTicker}.`);

  const est = markets.map(marketEstimate);
  const players = markets.map((m, i) => {
    let e = est[i];
    // In a two-player market, a wide/illiquid side is better inferred from the liquid opponent.
    if (markets.length === 2) {
      const other = est[1 - i];
      const weak = !e || e.method !== 'bid/ask midpoint';
      if (weak && other && other.method === 'bid/ask midpoint') {
        e = { p: 1 - other.p, spread: other.spread, method: 'inferred from opponent' };
      }
    }
    return {
      ticker: m.ticker,
      name: m.yes_sub_title || m.title,
      probability: e ? Math.min(0.999, Math.max(0.001, e.p)) : 0.5,
      method: e ? e.method : 'no price data (assumed 50%)',
      status: m.status,
      result: m.result || null,
    };
  });

  // Settled markets: the outcome trumps the last price.
  for (const p of players) {
    if (p.result === 'yes') p.probability = 1;
    if (p.result === 'no') p.probability = 0;
  }

  if (marketTicker && !players.some((p) => p.ticker === marketTicker)) {
    throw httpError(404, `Market ${marketTicker} isn't part of ${eventTicker}.`);
  }

  const series = event.series_ticker || eventTicker.split('-')[0];
  return {
    eventTicker,
    title: event.title,
    subtitle: event.sub_title,
    series,
    tour: /WTA/.test(series) ? 'WTA' : /ATP|CHALLENGER/.test(series) ? 'ATP' : 'tennis',
    players,
    selected: marketTicker || null,
    url: `https://kalshi.com/markets/${series.toLowerCase()}/${eventTicker.toLowerCase()}`,
  };
}

// ---------------------------------------------------------------------------
// Live score (Kalshi "milestones" + live_data) and win-probability history.
// ---------------------------------------------------------------------------

async function kalshi(path) {
  const res = await fetch(`${KALSHI}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw httpError(502, `Kalshi ${path.split('?')[0]} returned ${res.status}`);
  return res.json();
}

async function findMilestone(eventTicker) {
  const { milestones = [] } = await kalshi(`/milestones?limit=10&related_event_ticker=${encodeURIComponent(eventTicker)}`);
  return milestones.find((m) => m.details?.main_game_event_ticker === eventTicker) || milestones[0] || null;
}

/** Kalshi's competitor1 is the first name in "A vs B"; work out which market is which. */
function competitorOrder(title, players) {
  const left = (title.split(/\s+vs\.?\s+/i)[0] || '').toLowerCase();
  const tokens = (name) => name.toLowerCase().split(/[\s-]+/).filter((t) => t.length > 2);
  const firstIdx = players.findIndex((p) => tokens(p.name).some((t) => left.includes(t)));
  return firstIdx === 1 ? [1, 0] : [0, 1]; // index into players for competitor1, competitor2
}

const STATUS_LABELS = { '1st_set': '1st set', '2nd_set': '2nd set', '3rd_set': '3rd set', '4th_set': '4th set', '5th_set': '5th set' };

function buildScore(milestone, live, match) {
  const d = live?.details || {};
  const [i1, i2] = competitorOrder(match.title, match.players);
  const byComp = { [d.competitor1_id]: match.players[i1]?.ticker, [d.competitor2_id]: match.players[i2]?.ticker };
  // Arrays below are aligned with match.players order.
  const perPlayer = (k1, k2) => {
    const out = [];
    out[i1] = d[k1];
    out[i2] = d[k2];
    return out;
  };
  const r = perPlayer('competitor1_round_scores', 'competitor2_round_scores');
  const nSets = Math.max(r[0]?.length || 0, r[1]?.length || 0);
  const sets = Array.from({ length: nSets }, (_, s) => ({
    games: [r[0]?.[s]?.score ?? 0, r[1]?.[s]?.score ?? 0],
    tiebreak: r[0]?.[s]?.tiebreak_score != null ? [r[0][s].tiebreak_score, r[1]?.[s]?.tiebreak_score ?? 0] : null,
    done: r[0]?.[s]?.outcome === 'winner' || r[0]?.[s]?.outcome === 'loser',
  }));

  const state =
    d.status === 'cancelled' ? 'cancelled'
    : d.widget_status === 'finished' || d.status === 'closed' ? 'final'
    : d.widget_status === 'suspended' || d.status === 'interrupted' ? 'suspended'
    : d.widget_status === 'live' || d.status === 'live' || d.status === 'started' ? 'live'
    : 'scheduled';

  let points = null;
  if (state === 'live' || state === 'suspended') {
    points = perPlayer('competitor1_current_round_score', 'competitor2_current_round_score').map((p) => String(p ?? 0));
    const adv = byComp[d.advantage];
    if (adv) points = match.players.map((p) => (p.ticker === adv ? 'AD' : '40'));
  }

  return {
    state,
    label:
      state === 'live' ? `Live${STATUS_LABELS[d.match_status] ? ' · ' + STATUS_LABELS[d.match_status] : ''}`
      : state === 'final' ? (d.match_status === 'retired' ? 'Final · retired' : 'Final')
      : state === 'suspended' ? 'Suspended'
      : state === 'cancelled' ? 'Cancelled'
      : 'Not started',
    startTime: milestone.start_date || null,
    tournament: milestone.details?.tournament_name || null,
    round: milestone.details?.round || null,
    bestOf: Number(milestone.details?.best_of) || null,
    setsWon: perPlayer('competitor1_overall_score', 'competitor2_overall_score').map((n) => n ?? 0),
    sets,
    points,
    server: state === 'live' ? byComp[d.server] || null : null,
    winner: byComp[d.winner] || null,
  };
}

/** Same pricing rule as the live estimate, applied to each candle. */
function candleEstimate(c) {
  if (!c) return null;
  return marketEstimate({
    yes_bid_dollars: c.yes_bid?.close_dollars,
    yes_ask_dollars: c.yes_ask?.close_dollars,
    last_price_dollars: c.price?.close_dollars,
    previous_price_dollars: c.price?.previous_dollars,
  });
}

async function buildHistory(match, milestone, score) {
  const now = Math.floor(Date.now() / 1000);
  const start = milestone?.start_date ? Math.floor(Date.parse(milestone.start_date) / 1000) : null;
  const inPlay = score && score.state !== 'scheduled' && start && start < now;
  // During/after the match: minute candles from 30 min before first serve. Before: hourly over the last 3 days.
  let interval = inPlay ? 1 : 60;
  let from = inPlay ? start - 30 * 60 : now - 3 * 86400;
  const to = inPlay ? Math.min(now, start + 8 * 3600) : now;

  const fetchCandles = () =>
    Promise.all(
      match.players.map((p) =>
        kalshi(`/series/${match.series}/markets/${p.ticker}/candlesticks?start_ts=${from}&end_ts=${to}&period_interval=${interval}`)
          .then((r) => r.candlesticks || [])
          .catch(() => []),
      ),
    );
  let candles = await fetchCandles();
  // Freshly listed market: not enough hourly candles yet, so zoom in to minutes.
  if (interval === 60 && Math.max(...candles.map((c) => c.length)) < 3) {
    interval = 1;
    from = now - 6 * 3600;
    candles = await fetchCandles();
  }
  const byTs = candles.map((list) => new Map(list.map((c) => [c.end_period_ts, c])));
  const allTs = [...new Set(candles.flat().map((c) => c.end_period_ts))].sort((a, b) => a - b);

  const series = match.players.map((_, i) => {
    const pts = [];
    for (const t of allTs) {
      let e = candleEstimate(byTs[i].get(t));
      if (match.players.length === 2) {
        const o = candleEstimate(byTs[1 - i].get(t));
        if ((!e || e.method !== 'bid/ask midpoint') && o?.method === 'bid/ask midpoint') e = { p: 1 - o.p };
      }
      if (e) pts.push({ t: t * 1000, p: Math.min(1, Math.max(0, e.p)) });
    }
    return pts;
  });
  return {
    interval: interval === 1 ? 'minute' : 'hour',
    matchStart: start ? start * 1000 : null,
    byPlayer: Object.fromEntries(match.players.map((p, i) => [p.ticker, series[i]])),
  };
}

/** Score + probability history for a resolved match. Each part fails soft (null) independently. */
export async function getLive(match) {
  const milestone = await findMilestone(match.eventTicker).catch(() => null);
  let score = null;
  if (milestone) {
    try {
      const { live_data } = await kalshi(`/live_data/${milestone.type}/milestone/${milestone.id}`);
      score = buildScore(milestone, live_data, match);
    } catch (e) {
      console.error('live score failed:', e.message);
    }
  }
  const history = await buildHistory(match, milestone, score).catch((e) => {
    console.error('history failed:', e.message);
    return null;
  });
  return { score, history };
}
