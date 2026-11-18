// Text-to-speech queue. Never speaks two things at once.
// High-priority messages jump ahead of lower ones; low-priority chatter is dropped if the queue backs up.

export type Priority = 'high' | 'normal' | 'low';
interface Item { text: string; priority: Priority }

type Listener = (speaking: boolean) => void;

const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

class Speaker {
  private queue: Item[] = [];
  private speaking = false;
  private voice: SpeechSynthesisVoice | null = null;
  private listeners: Listener[] = [];
  private watchdog: number | undefined;
  /** id of the utterance currently playing; stale callbacks are ignored */
  private current = 0;
  rate = Number(store('ttsRate')) || 1.05;
  /** English voices, best first */
  voices: SpeechSynthesisVoice[] = [];
  lastSpoken = '';
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
    const pick = () => {
      this.voices = rankVoices(speechSynthesis.getVoices());
      const saved = store('ttsVoice');
      this.voice = this.voices.find((v) => v.name === saved) ?? this.voices[0] ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  get voiceName() { return this.voice?.name ?? 'default'; }

  setVoice(name: string) {
    const v = this.voices.find((x) => x.name === name);
    if (v) { this.voice = v; store('ttsVoice', v.name); }
  }

  /** Cycle to the next English voice. Returns its name. */
  nextVoice(): string {
    if (!this.voices.length) return this.voiceName;
    const i = this.voices.findIndex((v) => v === this.voice);
    this.setVoice(this.voices[(i + 1) % this.voices.length].name);
    return this.voiceName;
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
    if (!this.voice) {
      this.voices = rankVoices(speechSynthesis.getVoices());
      this.voice = this.voices.find((v) => v.name === store('ttsVoice')) ?? this.voices[0] ?? null;
    }
  }

  say(text: string, priority: Priority = 'normal') {
    if (!this.supported || !text) return;
    // Drop low-priority chatter when busy
    if (priority === 'low' && (this.speaking || this.queue.length > 0)) return;
    if (priority === 'normal') this.queue = this.queue.filter((q) => q.priority !== 'low');
    const idx = this.queue.findIndex((q) => RANK[q.priority] > RANK[priority]);
    if (idx < 0) this.queue.push({ text, priority });
    else this.queue.splice(idx, 0, { text, priority });
    this.next();
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
    u.lang = 'en-US';
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
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

function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const en = voices.filter((v) => v.lang.startsWith('en'));
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (n.includes('premium')) s += 6;
    if (n.includes('enhanced')) s += 5;
    if (n.includes('neural') || n.includes('natural')) s += 5;
    if (['samantha', 'ava', 'zoe', 'evan', 'nathan', 'google us english'].some((k) => n.includes(k))) s += 3;
    if (v.lang === 'en-US') s += 2;
    if (v.localService) s += 1;
    if (['novelty', 'bells', 'bubbles', 'whisper', 'zarvox', 'trinoids', 'bad news', 'good news', 'jester', 'organ', 'cellos', 'boing', 'albert', 'fred', 'hysterical', 'superstar', 'wobble'].some((k) => n.includes(k))) s -= 20;
    return s;
  };
  return [...en].filter((v) => score(v) > -10).sort((a, b) => score(b) - score(a));
}

export const speaker = new Speaker();
