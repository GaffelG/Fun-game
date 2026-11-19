// Text-to-speech queue. Never speaks two things at once.
// High-priority messages jump ahead of lower ones; low-priority chatter is dropped if the queue backs up.
//
// Two voice roles: "main" (announcer: shop, purchases, results) and "battle" (play-by-play commentary).
// iPhone loads its voice list late and often never fires `voiceschanged`, so we poll for it
// and notify the UI whenever the list changes.

export type Priority = 'high' | 'normal' | 'low';
export type Role = 'main' | 'battle';
interface Item { text: string; priority: Priority; role: Role }

type Listener = (speaking: boolean) => void;

const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const NOVELTY = ['bells', 'bubbles', 'whisper', 'zarvox', 'trinoids', 'bad news', 'good news', 'jester', 'organ', 'cellos', 'boing', 'albert', 'fred', 'hysterical', 'superstar', 'wobble', 'junior', 'kathy', 'ralph', 'grandma', 'grandpa', 'rocko', 'shelley', 'eddy', 'flo', 'reed', 'sandy'];

/** quality: 2 = Premium, 1 = Enhanced, 0 = basic */
/** Online voice (Google Cloud TTS through /api/tts). */
export type CloudState = 'checking' | 'on' | 'off' | 'error';

/** A tiny silent WAV, played inside the Start tap so iOS lets this audio element play later. */
function silentWav(): string {
  const samples = 800, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export interface VoiceOption { id: string; label: string; voice: SpeechSynthesisVoice; fun: boolean; quality: number }

class Speaker {
  private queue: Item[] = [];
  private speaking = false;
  private chosen: Record<Role, VoiceOption | null> = { main: null, battle: null };
  private listeners: Listener[] = [];
  private voiceListeners: (() => void)[] = [];
  private watchdog: number | undefined;
  /** id of the utterance currently playing; stale callbacks are ignored */
  private current = 0;
  rate = Number(store('ttsRate')) || 1.05;
  /** English voices: best-sounding first, fun/novelty voices last */
  voices: VoiceOption[] = [];
  lastSpoken = '';
  cloud: CloudState = 'checking';
  cloudError = '';
  private cloudFailures = 0;
  private audio: HTMLAudioElement | null = null;
  /** text -> pending/finished audio URL (null = failed). Repeated phrases play instantly. */
  private cache = new Map<string, Promise<string | null>>();
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
    this.checkCloud();
    this.loadVoices();
    speechSynthesis.addEventListener?.('voiceschanged', () => this.loadVoices());
    // Poll: iOS often fills the list a few seconds late without an event.
    let tries = 0;
    const poll = window.setInterval(() => {
      this.loadVoices();
      if (++tries > 40) window.clearInterval(poll);
    }, 250);
  }

  private loadVoices() {
    const list = buildOptions(speechSynthesis.getVoices());
    if (list.length === this.voices.length && list.every((v, i) => v.id === this.voices[i].id)) return;
    this.voices = list;
    // The game always speaks with one voice: Jamie (the player's chosen voice).
    // Prefer the Premium version, then Enhanced, then any Jamie; otherwise the best voice available.
    // Safari on iPhone usually can't use Premium voices, so if Jamie isn't offered,
    // fall back to the best British voice, then the best voice overall.
    const best = (l: VoiceOption[]) => [...l].sort((a, b) => b.quality - a.quality)[0];
    const voice = best(list.filter((v) => /jamie/i.test(v.voice.name)))
      ?? best(list.filter((v) => !v.fun && /en[-_]gb/i.test(v.voice.lang)))
      ?? list[0] ?? null;
    this.chosen = { main: voice, battle: voice };
    this.voiceListeners.forEach((l) => l());
  }

  /** The voices worth offering: Premium/Enhanced if the phone has any, otherwise the 5 best basic ones. */
  get shortlist(): VoiceOption[] {
    const good = this.voices.filter((v) => v.quality > 0 && !v.fun);
    return good.length ? good : this.voices.filter((v) => !v.fun).slice(0, 5);
  }

  private async checkCloud() {
    try {
      const r = await fetch('/api/tts');
      const data = r.ok ? await r.json() : null;
      this.cloud = data?.enabled ? 'on' : 'off';
    } catch { this.cloud = 'off'; }
    this.voiceListeners.forEach((l) => l());
  }

  private cacheKey(text: string) { return `${this.rate}|${text}`; }

  /** Start fetching audio for a phrase (called as soon as it is queued, to hide the delay). */
  private fetchAudio(text: string): Promise<string | null> {
    const key = this.cacheKey(text);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      try {
        const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, rate: this.rate }) });
        const data = await r.json();
        if (!r.ok || !data.audio) throw new Error(data.error || `HTTP ${r.status}`);
        this.cloudFailures = 0;
        const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      } catch (e) {
        this.cache.delete(key);
        // After 3 failures in a row, stop trying and use the phone's voice so the game keeps talking.
        if (++this.cloudFailures >= 3) {
          this.cloud = 'error';
          this.cloudError = (e as Error).message;
          this.voiceListeners.forEach((l) => l());
        }
        return null;
      }
    })();
    this.cache.set(key, p);
    if (this.cache.size > 300) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.get(oldest)?.then((u) => u && URL.revokeObjectURL(u));
      this.cache.delete(oldest);
    }
    return p;
  }

  onVoicesChanged(l: () => void) { this.voiceListeners.push(l); return () => { this.voiceListeners = this.voiceListeners.filter((x) => x !== l); }; }

  voiceId(role: Role = 'main') { return this.chosen[role]?.id ?? ''; }
  voiceLabel(role: Role = 'main') {
    if (this.cloud === 'on') return 'Google British voice (online)';
    return this.chosen[role]?.label ?? 'iPhone default voice';
  }
  /** Kept for older callers */
  get voiceName() { return this.voiceLabel('main'); }

  setVoice(id: string, role: Role = 'main') {
    const v = this.voices.find((x) => x.id === id);
    if (!v) return;
    this.chosen[role] = v;
    store(`ttsVoice2_${role}`, v.id);
    this.voiceListeners.forEach((l) => l());
  }

  /** Cycle to the next voice for a role. Returns its label. */
  nextVoice(role: Role = 'main'): string {
    if (!this.voices.length) { this.loadVoices(); if (!this.voices.length) return this.voiceLabel(role); }
    const list = this.shortlist;
    const i = list.findIndex((v) => v.id === this.voiceId(role));
    this.setVoice(list[(i + 1) % list.length].id, role);
    return this.voiceLabel(role);
  }

  setRate(r: number) {
    this.rate = Math.max(0.7, Math.min(1.6, Math.round(r * 100) / 100));
    store('ttsRate', String(this.rate));
  }
  get isSpeaking() { return this.speaking; }

  onChange(l: Listener) { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; }
  private emit() { this.listeners.forEach((l) => l(this.speaking)); }

  /** Must be called once from a tap: iOS only allows speech after a user gesture. */
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    this.loadVoices();
    // Unlock the audio element for the online voice (iOS only allows playback that started from a tap).
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.setAttribute('playsinline', '');
      this.audio.src = silentWav();
      this.audio.play().catch(() => { /* fine: unlocking is best effort */ });
    }
  }

  say(text: string, priority: Priority = 'normal', role: Role = 'main') {
    if (!this.supported || !text) return;
    // Drop low-priority chatter when busy
    if (priority === 'low' && (this.speaking || this.queue.length > 0)) return;
    if (priority === 'normal') this.queue = this.queue.filter((q) => q.priority !== 'low');
    const idx = this.queue.findIndex((q) => RANK[q.priority] > RANK[priority]);
    const item = { text, priority, role };
    if (this.cloud === 'on') void this.fetchAudio(text);
    if (idx < 0) this.queue.push(item);
    else this.queue.splice(idx, 0, item);
    this.next();
  }

  /** Speak a sample right away in the given voice (used by the voice picker). */
  preview(role: Role) {
    this.stop();
    this.say(role === 'main' ? `Hi, I'm ${this.voiceLabel(role)}. You bought Ninja.` : `Hi, I'm ${this.voiceLabel(role)}. First blood! Their Knight falls.`, 'high', role);
  }

  /** Stop talking and clear everything queued. */
  stop() {
    this.queue = [];
    this.current++; // invalidate callbacks of the cancelled utterance
    if (this.supported) speechSynthesis.cancel();
    this.audio?.pause();
    this.finish();
  }

  private finish() {
    window.clearTimeout(this.watchdog);
    this.speaking = false;
    this.emit();
  }

  private next() {
    if (this.speaking) return;
    const item = this.queue.shift();
    if (!item) return;
    this.speaking = true;
    this.lastSpoken = item.text;
    this.emit();
    const id = ++this.current;
    const done = () => {
      if (id !== this.current) return; // stale or repeated callback
      this.current++;
      this.finish();
      window.setTimeout(() => this.next(), 150);
    };
    // iOS sometimes never reports the end of speech. Watchdog based on text length (+ time to download).
    this.watchdog = window.setTimeout(done, 6000 + item.text.length * 90);
    if (this.cloud === 'on' && this.audio) {
      void this.fetchAudio(item.text).then((url) => {
        if (id !== this.current) return; // stopped meanwhile
        // Fall back to the phone's voice at most once, and only if the online audio never started.
        let started = false, fellBack = false;
        const fallback = () => {
          if (id !== this.current || fellBack) return;
          fellBack = true;
          if (started) done(); else this.speakLocal(item, done);
        };
        if (!url || !this.audio) { fallback(); return; }
        this.audio.onplaying = () => { started = true; };
        this.audio.onended = done;
        this.audio.onerror = fallback;
        this.audio.src = url;
        this.audio.play().then(() => { started = true; }, fallback);
      });
      return;
    }
    this.speakLocal(item, done);
  }

  /** Speak with the phone's own voice (fallback, and when no online voice is set up). */
  private speakLocal(item: Item, done: () => void) {
    const u = new SpeechSynthesisUtterance(item.text);
    const opt = this.chosen[item.role] ?? this.chosen.main;
    // iOS ignores the voice unless lang matches it, so set both.
    u.lang = 'en-US';
    // If the browser rejects the voice for any reason, keep talking with the default voice.
    if (opt) { try { u.voice = opt.voice; u.lang = opt.voice.lang; } catch { /* default voice */ } }
    u.rate = this.rate;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }
}

function store(k: string, v?: string): string | null {
  try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; }
}

const ACCENT: Record<string, string> = { 'en-US': 'American', 'en-GB': 'British', 'en-AU': 'Australian', 'en-IE': 'Irish', 'en-IN': 'Indian', 'en-ZA': 'South African', 'en-NZ': 'New Zealand', 'en-SC': 'Scottish', 'en-CA': 'Canadian' };

function buildOptions(voices: SpeechSynthesisVoice[]): VoiceOption[] {
  const en = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('en'));
  const score = (v: SpeechSynthesisVoice) => {
    // iPhone puts the quality in the voice ID, e.g. com.apple.voice.premium.en-GB.Jamie
    const n = `${v.name} ${v.voiceURI}`.toLowerCase();
    let s = 0;
    if (n.includes('premium')) s += 6;
    if (n.includes('enhanced')) s += 5;
    if (n.includes('neural') || n.includes('natural')) s += 5;
    if (['samantha', 'ava', 'zoe', 'evan', 'nathan', 'daniel', 'karen', 'moira', 'google'].some((k) => n.includes(k))) s += 3;
    if (v.lang === 'en-US') s += 1;
    if (v.localService) s += 1;
    return s;
  };
  const seen = new Set<string>();
  return en
    .map((v) => {
      const fun = NOVELTY.some((k) => v.name.toLowerCase().includes(k));
      const lang = v.lang.replace('_', '-');
      const accent = ACCENT[lang] ?? lang;
      const uri = (v.voiceURI || '').toLowerCase();
      const quality = /premium/.test(uri) && !/premium/i.test(v.name) ? ', Premium' : /enhanced/.test(uri) && !/enhanced/i.test(v.name) ? ', Enhanced' : '';
      const q = /premium/i.test(`${uri} ${v.name}`) ? 2 : /enhanced/i.test(`${uri} ${v.name}`) ? 1 : 0;
      return { id: v.voiceURI || `${v.name}|${v.lang}`, label: `${v.name} (${accent}${quality}${fun ? ', fun' : ''})`, voice: v, fun, quality: q, s: score(v) };
    })
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => Number(a.fun) - Number(b.fun) || b.s - a.s || a.label.localeCompare(b.label))
    .map(({ s: _s, ...o }) => o);
}

export const speaker = new Speaker();
