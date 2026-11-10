const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = () => process.env.OPENROUTER_MODEL || 'meta/muse-ember';
const UA = 'Mozilla/5.0 (tennis-mood-widget)';

async function chat({ messages, web = false, effort = 'low', max_tokens = 2000 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY missing');
  const body = { model: MODEL(), messages, reasoning: { effort }, max_tokens };
  if (web) body.plugins = [{ id: 'web', max_results: 6 }];
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Tennis Mood Widget' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** True if the URL actually serves an image (models sometimes hallucinate hosts/paths). */
async function isImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const ok = res.ok && (res.headers.get('content-type') || '').startsWith('image/');
    res.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}

async function wikipediaImage(name) {
  const search = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(name + ' tennis player')}`,
    { headers: { 'User-Agent': UA } },
  ).then((r) => r.json());
  const title = search?.query?.search?.[0]?.title;
  if (!title) return null;
  const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: { 'User-Agent': UA },
  }).then((r) => r.json());
  const url = summary?.originalimage?.source || summary?.thumbnail?.source;
  return url ? { url, source: summary?.content_urls?.desktop?.page, via: 'Wikipedia' } : null;
}

/** Use muse-ember + web search to find a player photo; verify it; fall back to Wikipedia. */
export async function findPlayerImage(name, tour) {
  const site = tour === 'WTA' ? 'wtatennis.com' : tour === 'ATP' ? 'atptour.com' : 'atptour.com or wtatennis.com';
  try {
    const text = await chat({
      web: true,
      messages: [{
        role: 'user',
        content:
          `Search the web for a photo of the professional ${tour} tennis player "${name}". ` +
          `Prefer their official headshot on ${site} (player profile / rankings pages), otherwise Wikimedia Commons (upload.wikimedia.org). ` +
          `Return up to 3 DIRECT image file URLs (jpg/png/webp/avif), best first. ` +
          `Reply with ONLY JSON: {"images": [{"url": "...", "source_page": "..."}]}`,
      }],
    });
    const candidates = extractJson(text)?.images || [];
    for (const c of candidates) {
      if (c?.url && (await isImage(c.url))) return { url: c.url, source: c.source_page || null, via: 'web search (muse-ember)' };
    }
  } catch (e) {
    console.error('web image search error:', e.message);
  }
  return wikipediaImage(name);
}

/** A short first-person thought bubble from the player, in character for the emotion. */
export async function writeMonologue({ player, opponent, emotion, match }) {
  const pct = Math.round(player.probability * 100);
  const text = await chat({
    messages: [
      {
        role: 'system',
        content:
          'You write a single short inner-monologue line (max 25 words) for a pro tennis player mid-match. ' +
          'First person, vivid, tennis-specific, light-hearted, no hashtags, no quotation marks.',
      },
      {
        role: 'user',
        content:
          `Match: ${match.title} (${match.subtitle || ''}). Player: ${player.name}. Opponent: ${opponent?.name || 'unknown'}. ` +
          `Prediction market win probability: ${pct}%. Emotional state: ${emotion.label} — ${emotion.blurb}`,
      },
    ],
  });
  return text.trim().replace(/^["“]|["”]$/g, '') || null;
}
