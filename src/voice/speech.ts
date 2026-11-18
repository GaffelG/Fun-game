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
  rate = 1.05;
  lastSpoken = '';
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  constructor() {
    if (!this.supported) return;
    const pick = () => { this.voice = pickVoice(speechSynthesis.getVoices()); };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  get voiceName() { return this.voice?.name ?? 'default'; }
  get isSpeaking() { return this.speaking; }

  onChange(l: Listener) { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; }
  private emit() { this.listeners.forEach((l) => l(this.speaking)); }

  /** Must be called once from a tap: iOS only allows speech after a user gesture. */
  unlock() {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    if (!this.voice) this.voice = pickVoice(speechSynthesis.getVoices());
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
    const done = () => { this.finish(); window.setTimeout(() => this.next(), 150); };
    u.onend = done;
    u.onerror = done;
    // iOS sometimes never fires onend. Watchdog based on text length.
    this.watchdog = window.setTimeout(done, 3000 + item.text.length * 90);
    speechSynthesis.speak(u);
  }
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.startsWith('en'));
  if (!en.length) return null;
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
  return [...en].sort((a, b) => score(b) - score(a))[0];
}

export const speaker = new Speaker();
