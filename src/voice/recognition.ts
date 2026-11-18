// Continuous speech recognition using the Web Speech API (webkitSpeechRecognition on iOS Safari).
// iOS stops recognition after silence, while TTS plays, and when the page is hidden,
// so we restart automatically and report every state honestly to the UI.

export type MicStatus =
  | 'unsupported'   // browser has no speech recognition
  | 'idle'          // not started yet (needs a tap)
  | 'starting'
  | 'listening'
  | 'paused'        // deliberately paused while the game speaks
  | 'denied'        // permission refused
  | 'error'         // something else went wrong; see message
  | 'stopped';      // stopped and needs a tap to restart

export interface MicState { status: MicStatus; message: string; restarts: number; lastHeard: string; }

type Ctor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

const Impl: Ctor | undefined = typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : undefined;

export class Listener {
  private rec: SpeechRecognitionLike | null = null;
  private wanted = false;
  private paused = false;
  private recentRestarts: number[] = [];
  state: MicState = { status: Impl ? 'idle' : 'unsupported', message: Impl ? 'Tap Start to enable the microphone.' : 'This browser has no speech recognition. Use Safari on iPhone or Chrome.', restarts: 0, lastHeard: '' };
  private subs: ((s: MicState) => void)[] = [];

  constructor(private onPhrase: (alternatives: string[]) => void) {}

  get supported() { return !!Impl; }
  subscribe(fn: (s: MicState) => void) { this.subs.push(fn); return () => { this.subs = this.subs.filter((x) => x !== fn); }; }
  private set(p: Partial<MicState>) { this.state = { ...this.state, ...p }; this.subs.forEach((f) => f(this.state)); }

  /** Call from a tap. */
  start() {
    if (!Impl) return;
    this.wanted = true;
    this.paused = false;
    this.recentRestarts = [];
    this.spawn();
  }

  stop() {
    this.wanted = false;
    this.rec?.abort();
    this.set({ status: 'stopped', message: 'Microphone off. Tap Start to listen again.' });
  }

  /** Pause while the game is speaking so it doesn't hear itself. */
  pause() {
    if (!this.wanted || this.paused) return;
    this.paused = true;
    this.rec?.abort();
    this.set({ status: 'paused', message: 'Paused while speaking.' });
  }

  resume() {
    if (!this.wanted || !this.paused) return;
    this.paused = false;
    // A deliberate pause/resume is not a crash loop; don't count it.
    this.recentRestarts = [];
    this.spawn();
  }

  private spawn() {
    if (!Impl || !this.wanted || this.paused) return;
    // Detect restart loops (iOS can end immediately over and over)
    const now = Date.now();
    this.recentRestarts = this.recentRestarts.filter((t) => now - t < 10000);
    this.recentRestarts.push(now);
    if (this.recentRestarts.length > 8) {
      this.wanted = false;
      this.set({ status: 'error', message: 'The microphone keeps stopping. Tap Start to try again.' });
      return;
    }
    const rec = new Impl();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onstart = () => this.set({ status: 'listening', message: 'Listening.' });
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const alts: string[] = [];
        for (let j = 0; j < r.length; j++) alts.push(r[j].transcript.trim());
        this.set({ lastHeard: alts[0] });
        this.onPhrase(alts);
      }
    };
    rec.onerror = (e: any) => {
      const err = e.error as string;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.wanted = false;
        this.set({ status: 'denied', message: 'Microphone or speech recognition permission was denied. On iPhone: Settings > Safari > Microphone, and Settings > Privacy > Speech Recognition. Then reload.' });
      } else if (err === 'no-speech' || err === 'aborted') {
        // normal; onend will restart
      } else if (err === 'audio-capture') {
        this.set({ status: 'error', message: 'No microphone found or it is in use by another app.' });
      } else if (err === 'network') {
        this.set({ status: 'error', message: 'Speech recognition needs an internet connection. Retrying.' });
      } else {
        this.set({ status: 'error', message: `Recognition error: ${err}. Retrying.` });
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (this.wanted && !this.paused) {
        this.set({ restarts: this.state.restarts + 1 });
        window.setTimeout(() => this.spawn(), 250);
      } else if (!this.wanted && this.state.status === 'listening') {
        this.set({ status: 'stopped', message: 'Microphone stopped. Tap Start to listen again.' });
      }
    };
    this.rec = rec;
    this.set({ status: 'starting', message: 'Starting microphone.' });
    try { rec.start(); }
    catch (err) { this.set({ status: 'error', message: `Could not start microphone: ${(err as Error).message}` }); }
  }

  /** The page was hidden (screen locked, app switched). iOS kills recognition then. */
  handleHidden() {
    if (!this.wanted) return;
    this.rec?.abort();
    this.rec = null;
    this.wanted = false;
    this.set({ status: 'stopped', message: 'The page was in the background, so iOS stopped the microphone. Tap Start to listen again.' });
  }
}
