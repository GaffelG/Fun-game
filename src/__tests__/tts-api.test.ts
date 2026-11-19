import { it, expect } from 'vitest';
it('tts function', async () => {
  const calls: any[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ audioContent: 'QUJD' }), { status: 200 }); };
  (globalThis as any).process.env.GOOGLE_TTS_API_KEY = '';
  const { default: handler } = await import('../../api/tts');
  expect(await (await handler(new Request('https://g.app/api/tts'))).json()).toEqual({ enabled: false, voice: 'en-GB-Neural2-B' });
  (globalThis as any).process.env.GOOGLE_TTS_API_KEY = 'k';
  expect((await (await handler(new Request('https://g.app/api/tts'))).json()).enabled).toBe(true);
  const ok = await handler(new Request('https://g.app/api/tts', { method: 'POST', headers: { origin: 'https://g.app', host: 'g.app' }, body: JSON.stringify({ text: 'You bought Ninja.', rate: 1.05 }) }));
  expect(await ok.json()).toEqual({ audio: 'QUJD' });
  expect(calls[0].body.voice.name).toBe('en-GB-Neural2-B');
  expect(calls[0].body.input.text).toBe('You bought Ninja.');
  const evil = await handler(new Request('https://g.app/api/tts', { method: 'POST', headers: { origin: 'https://evil.com', host: 'g.app' }, body: JSON.stringify({ text: 'hi' }) }));
  expect(evil.status).toBe(403);
});
