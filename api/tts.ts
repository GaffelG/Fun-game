// Vercel Edge Function: turns text into natural British speech with Google Cloud Text-to-Speech.
// The API key lives only in Vercel's environment variables (GOOGLE_TTS_API_KEY), never in the game code.
//
//   GET  /api/tts            -> { enabled: true|false }   (is a key configured?)
//   POST /api/tts {text,rate} -> { audio: "<base64 mp3>" }

export const config = { runtime: 'edge' };

declare const process: { env: Record<string, string | undefined> };

/** British male neural voice, close to Apple's "Jamie". Change here to try another (en-GB-Neural2-A/C/F are female). */
const VOICE = process.env.GOOGLE_TTS_VOICE || 'en-GB-Neural2-B';
const MAX_CHARS = 700; // a single game announcement is never longer; stops misuse of the key

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (req.method === 'GET') return json({ enabled: !!key, voice: VOICE });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!key) return json({ error: 'GOOGLE_TTS_API_KEY is not set in Vercel' }, 503);

  // Only accept requests from this game's own pages.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json({ error: 'forbidden' }, 403);

  let text = '', rate = 1;
  try {
    const body = await req.json();
    text = String(body.text ?? '').slice(0, MAX_CHARS).trim();
    rate = Math.min(1.6, Math.max(0.7, Number(body.rate) || 1));
  } catch { return json({ error: 'bad request' }, 400); }
  if (!text) return json({ error: 'no text' }, 400);

  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: VOICE.slice(0, 5), name: VOICE },
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
    }),
  });
  if (!r.ok) {
    // Pass Google's reason through (e.g. API not enabled, bad key) so the game can show it.
    const detail = await r.text();
    let message = detail.slice(0, 300);
    try { message = JSON.parse(detail).error?.message ?? message; } catch { /* keep raw */ }
    return json({ error: message }, 502);
  }
  const data = await r.json();
  return json({ audio: data.audioContent });
}
