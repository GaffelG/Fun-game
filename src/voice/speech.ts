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

export interface VoiceOption { id: string; label: string; voice: SpeechSynthesisVoice; fun: boolean }

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
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
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
    for (const role of ['main', 'battle'] as Role[]) {
      const saved = store(`ttsVoice_${role}`);
      this.chosen[role] = list.find((v) => v.id === saved) ?? null;
    }
    // Defaults: best voice for the announcer, a different good voice for battle commentary.
    if (!this.chosen.main) this.chosen.main = list[0] ?? null;
    if (!this.chosen.battle) this.chosen.battle = list.find((v) => !v.fun && v.id !== this.chosen.main?.id) ?? this.chosen.main;
    this.voiceListeners.forEach((l) => l());
  }

  onVoicesChanged(l: () => void) { this.voiceListeners.push(l); return () => { this.voiceListeners = this.voiceListeners.filter((x) => x !== l); }; }

  voiceId(role: Role = 'main') { return this.chosen[role]?.id ?? ''; }
  voiceLabel(role: Role = 'main') { return this.chosen[role]?.label ?? 'iPhone default voice'; }
  /** Kept for older callers */
  get voiceName() { return this.voiceLabel('main'); }

  setVoice(id: string, role: Role = 'main') {
    const v = this.voices.find((x) => x.id === id);
    if (!v) return;
    this.chosen[role] = v;
    store(`ttsVoice_${role}`, v.id);
    this.voiceListeners.forEach((l) => l());
  }

  /** Cycle to the next voice for a role. Returns its label. */
  nextVoice(role: Role = 'main'): string {
    if (!this.voices.length) { this.loadVoices(); if (!this.voices.length) return this.voiceLabel(role); }
    const i = this.voices.findIndex((v) => v.id === this.voiceId(role));
    this.setVoice(this.voices[(i + 1) % this.voices.length].id, role);
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
  }

  say(text: string, priority: Priority = 'normal', role: Role = 'main') {
    if (!this.supported || !text) return;
    // Drop low-priority chatter when busy
    if (priority === 'low' && (this.speaking || this.queue.length > 0)) return;
    if (priority === 'normal') this.queue = this.queue.filter((q) => q.priority !== 'low');
    const idx = this.queue.findIndex((q) => RANK[q.priority] > RANK[priority]);
    const item = { text, priority, role };
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
    const u = new SpeechSynthesisUtterance(item.text);
    const opt = this.chosen[item.role] ?? this.chosen.main;
    // iOS ignores the voice unless lang matches it, so set both.
    u.lang = 'en-US';
    // If the browser rejects the voice for any reason, keep talking with the default voice.
    if (opt) { try { u.voice = opt.voice; u.lang = opt.voice.lang; } catch { /* default voice */ } }
    u.rate = this.rate;
    const id = ++this.current;
    const done = () => {
      if (id !== this.current) return; // stale or repeated callback
      this.current++;
      this.finish();
      window.setTimeout(() => this.next(), 150);
    };
    u.onend = done;
    u.onerror = done;
    // iOS sometimes never fires onend. Watchdog based on text length.
    this.watchdog = window.setTimeout(done, 3000 + item.text.length * 90);
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
    const n = v.name.toLowerCase();
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
      return { id: v.voiceURI || `${v.name}|${v.lang}`, label: `${v.name} (${accent}${fun ? ', fun' : ''})`, voice: v, fun, s: score(v) };
    })
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => Number(a.fun) - Number(b.fun) || b.s - a.s || a.label.localeCompare(b.label))
    .map(({ s: _s, ...o }) => o);
}

export const speaker = new Speaker();
