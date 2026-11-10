import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMatch, getLive } from './kalshi.js';
import { emotionFor } from './emotions.js';
import { findPlayerImage, writeMonologue } from './muse.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('[warn] OPENROUTER_API_KEY is not set — image search and monologue will fall back.');
}

// Step 1: look up the match on Kalshi. Accepts an event ticker, a market ticker, or a kalshi.com URL.
app.get('/api/match', async (req, res) => {
  try {
    const match = await resolveMatch(String(req.query.code || ''));
    res.json(match);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Step 2: for one player, map win prob -> emotion, find a photo, and write an inner monologue.
app.get('/api/mood', async (req, res) => {
  try {
    const match = await resolveMatch(String(req.query.code || ''));
    const wanted = String(req.query.player || match.selected || '');
    const player = match.players.find((p) => p.ticker === wanted) || match.players[0];
    const opponent = match.players.find((p) => p !== player);
    const emotion = emotionFor(player.probability);

    const [live, image, monologue] = await Promise.all([
      getLive(match),
      findPlayerImage(player.name, match.tour).catch((e) => {
        console.error('image search failed:', e.message);
        return null;
      }),
      writeMonologue({ player, opponent, emotion, match }).catch((e) => {
        console.error('monologue failed:', e.message);
        return null;
      }),
    ]);

    res.json({ match, player, opponent, emotion, image, monologue, ...live });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Fast refresh (no LLM): current probabilities, emotion, score and history.
app.get('/api/live', async (req, res) => {
  try {
    const match = await resolveMatch(String(req.query.code || ''));
    const player = match.players.find((p) => p.ticker === (req.query.player || match.selected)) || match.players[0];
    const opponent = match.players.find((p) => p !== player);
    res.json({ match, player, opponent, emotion: emotionFor(player.probability), ...(await getLive(match)) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Proxy player photos so hotlink-protected hosts still render in the browser.
app.get('/api/image', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    if (!/^https?:$/.test(url.protocol)) throw new Error('bad protocol');
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (tennis-mood-widget)', Accept: 'image/*' },
      redirect: 'follow',
    });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return res.status(502).end();
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(400).end();
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
