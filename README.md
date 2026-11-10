# 🎾 Tennis Mood Meter

Enter a Kalshi tennis match code → get the player's live win probability → see how they're (probably) feeling.

```
npm install
npm run dev        # API on :3001, UI on http://localhost:5173
```

Needs a `.env` file (git-ignored):

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta/muse-ember
PORT=3001
```

**Accepted codes:** event ticker (`KXATPMATCH-26NOV09RINKEC`), market ticker for one player (`KXATPMATCH-26NOV09RINKEC-RIN`), or a kalshi.com market URL.

**How it works**
- `server/kalshi.js` reads Kalshi's public API (no auth needed). It uses the bid/ask midpoint, or the last trade when the spread is wide, or 1 − the opponent's price in a two-player match.
- `server/emotions.js` maps the probability onto 9 levels: Triumphant → Euphoric → Confident → Focused → Nervy → Frustrated → Desperate → Crushed → Defeated.
- `server/muse.js` runs `meta/muse-ember` on OpenRouter with web search to find a player photo (it prefers atptour.com / wtatennis.com, then Wikimedia). Every URL gets checked to be a real image, and Wikipedia is the fallback. The model also writes a one-line inner monologue.
- **Live score:** Kalshi links each match to a "milestone" record, and its `live_data` gives sets, games, tiebreaks, current points (with AD), who's serving, and the winner.
- **Probability history:** built from Kalshi candlesticks for both players, using the same pricing rule. It's per minute once the match has started (from 30 min before the scheduled start) and per hour before that, falling back to per minute for markets that just opened.
- While a match is live, the UI calls `/api/live` every 20s. That call only refreshes price, mood, score and chart (no model calls).
- Shareable links: `/?code=<event>&player=<market>`.
- The server proxies `/api/image` so sites that block hotlinking still show the photo.
