import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Game, Say, cellName } from './game/engine';
import { BOARD_COLS, BOARD_ROWS, PREP_SECONDS, TRAITS, UNIT_BY_ID, UNITS } from './game/config';
import { activeTraits } from './game/battle';
import { speaker } from './voice/speech';
import { Listener, MicState } from './voice/recognition';
import { Command, HELP_TEXT, parseCommand } from './voice/commands';

type Verbosity = 'minimal' | 'balanced' | 'detailed';

export default function App() {
  const gameRef = useRef(new Game());
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [started, setStarted] = useState(false);
  const [mic, setMic] = useState<MicState | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [log, setLog] = useState<{ who: 'you' | 'game'; text: string }[]>([]);
  const [verbosity, setVerbosity] = useState<Verbosity>(() => (localStorageGet('verbosity') as Verbosity) || 'balanced');
  const [timerOn, setTimerOn] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(PREP_SECONDS);
  const [typed, setTyped] = useState('');
  const [wakeLock, setWakeLock] = useState<'on' | 'off' | 'unsupported'>('off');
  const verbosityRef = useRef(verbosity);
  verbosityRef.current = verbosity;
  const g = gameRef.current;

  const addLog = (who: 'you' | 'game', text: string) => setLog((l) => [{ who, text }, ...l].slice(0, 30));

  const say = useCallback((items: Say | Say[]) => {
    for (const s of Array.isArray(items) ? items : [items]) {
      speaker.say(s.text, s.priority);
      addLog('game', s.text);
    }
    rerender();
  }, []);

  // ---------- Battle ----------
  const battleTimers = useRef<number[]>([]);
  const countdown = useRef(PREP_SECONDS);
  /** Set by "quiet": skip the rest of this battle's play-by-play. */
  const narrationMuted = useRef(false);
  const runBattle = useCallback(() => {
    const game = gameRef.current;
    if (game.phase !== 'prep') return;
    if (game.board.length === 0) { say({ text: 'You have no units on the board. Buy some first.', priority: 'high' }); return; }
    const { result, opponentName } = game.startBattle();
    narrationMuted.current = false;
    const v = verbosityRef.current;
    if (v !== 'minimal') say({ text: `Battle against ${opponentName} begins.`, priority: 'normal' });
    rerender();
    // Play the battle back in compressed real time (max ~12 seconds)
    const scale = Math.min(1, 12 / Math.max(1, result.duration));
    for (const e of result.events) {
      if (v === 'minimal') continue;
      if (v === 'balanced' && !e.important) continue;
      battleTimers.current.push(window.setTimeout(() => { if (!narrationMuted.current) say({ text: e.text, priority: 'low' }); }, e.t * scale * 1000));
    }
    battleTimers.current.push(window.setTimeout(() => {
      const out = gameRef.current.finishBattle();
      say(out);
      if (gameRef.current.phase === 'prep') {
        if (verbosityRef.current !== 'minimal') say({ ...gameRef.current.scout(), text: `Next up: ${gameRef.current.scout().text}`, priority: 'normal' });
        say(gameRef.current.describeShop('New shop. '));
      }
      countdown.current = PREP_SECONDS; setSecondsLeft(PREP_SECONDS);
    }, result.duration * scale * 1000 + 800));
  }, [say]);

  // ---------- Commands ----------
  const execute = useCallback((cmd: Command) => {
    const game = gameRef.current;
    switch (cmd.type) {
      case 'shop': return say(game.describeShop());
      case 'slotInfo': return say(game.describeSlot(cmd.slot));
      case 'buy': return say(game.buy(cmd.slot));
      case 'buyName': {
        const q = cmd.name.toLowerCase();
        const slot = game.shop.findIndex((id) => id && (UNIT_BY_ID[id].name.toLowerCase() === q || UNIT_BY_ID[id].traits.some((t) => t.toLowerCase() === q)));
        return slot < 0 ? say({ text: `There is no ${cmd.name} in the shop.`, priority: 'high' }) : say(game.buy(slot + 1));
      }
      case 'refresh': return say(game.refresh());
      case 'buyXp': return say(game.buyXp());
      case 'levelUp': return say(game.levelUp());
      case 'place': return say(game.place(cmd.name, cmd.row, cmd.col));
      case 'bench': return say(game.bench_(cmd.name));
      case 'sell': return say(game.sell(cmd.name));
      case 'team': return say(game.describeTeam());
      case 'unitInfo': {
        const u = UNITS.find((x) => x.name === cmd.name);
        if (u) return say(game.describeUnit(u.id));
        const trait = TRAITS.find((t) => t.name.toLowerCase() === cmd.name.toLowerCase());
        if (trait) {
          const members = UNITS.filter((x) => x.traits.includes(trait.name)).map((x) => `${x.name}, ${x.cost} gold`).join('; ');
          return say({ text: `${trait.name}. ${trait.description} Bonus at ${trait.thresholds.join(' and ')} units. ${trait.name} units: ${members}.`, priority: 'high' });
        }
        return say({ text: `I don't know a unit called ${cmd.name}.`, priority: 'high' });
      }
      case 'scout': return say(game.scout());
      case 'gold': return say({ text: `You have ${game.gold} gold.`, priority: 'high' });
      case 'status': return say(game.describeStatus());
      case 'fight': return runBattle();
      case 'lastBattle': return say({ text: game.lastBattleSummary || 'No battles yet.', priority: 'high' });
      case 'repeat': speaker.say(speaker.lastSpoken || 'Nothing to repeat.', 'high'); return;
      case 'quiet': narrationMuted.current = true; speaker.stop(); return;
      case 'help': return say({ text: HELP_TEXT, priority: 'high' });
      case 'verbosity':
        setVerbosity(cmd.level); localStorageSet('verbosity', cmd.level);
        return say({ text: `Announcements set to ${cmd.level}.`, priority: 'high' });
      case 'timer':
        setTimerOn(cmd.on); countdown.current = PREP_SECONDS; setSecondsLeft(PREP_SECONDS);
        return say({ text: cmd.on ? `Round timer on. Battles start automatically after ${PREP_SECONDS} seconds.` : 'Round timer off. Say fight when you are ready.', priority: 'high' });
      case 'newGame':
        battleTimers.current.forEach(clearTimeout); battleTimers.current = [];
        speaker.stop(); // drop any old battle narration
        gameRef.current = new Game();
        countdown.current = PREP_SECONDS; setSecondsLeft(PREP_SECONDS);
        say({ text: 'New game started.', priority: 'high' });
        return say(gameRef.current.describeShop());
    }
  }, [say, runBattle]);

  const handlePhrase = useCallback((alts: string[]) => {
    addLog('you', alts[0]);
    for (const a of alts) {
      const cmd = parseCommand(a);
      if (cmd) { execute(cmd); return; }
    }
    // Ignore long phrases (probably conversation around you); respond to short unknown ones.
    if (alts[0].split(' ').length <= 7) say({ text: `I heard "${alts[0]}", but I don't know that command. Say help for options.`, priority: 'normal' });
  }, [execute, say]);

  const listener = useMemo(() => new Listener((alts) => handlerRef.current(alts)), []);
  const handlerRef = useRef(handlePhrase);
  handlerRef.current = handlePhrase;

  useEffect(() => listener.subscribe(setMic), [listener]);
  useEffect(() => speaker.onChange((s) => {
    setSpeaking(s);
    // Don't let the mic hear the game talking.
    if (s) listener.pause(); else window.setTimeout(() => { if (!speaker.isSpeaking) listener.resume(); }, 300);
  }), [listener]);

  // Background / foreground handling
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) listener.handleHidden();
      else if (started) requestWakeLock(setWakeLock);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [listener, started]);

  // Prep timer
  useEffect(() => {
    if (!started || !timerOn) return;
    const id = window.setInterval(() => {
      if (gameRef.current.phase !== 'prep') return;
      // Side effects stay outside the state setter so they run exactly once.
      countdown.current -= 1;
      if (countdown.current === 10) say({ text: 'Ten seconds until battle.', priority: 'normal' });
      if (countdown.current <= 0) { countdown.current = PREP_SECONDS; runBattle(); }
      setSecondsLeft(countdown.current);
    }, 1000);
    return () => clearInterval(id);
  }, [started, timerOn, runBattle, say]);

  const start = () => {
    speaker.unlock(); // must happen inside the tap
    requestWakeLock(setWakeLock);
    // Start the listener first so the announcements below pause it instead of being heard by it.
    listener.start(speaker.isSpeaking);
    if (!started) {
      setStarted(true);
      say({ text: listener.supported ? 'Voice control on. Say help at any time.' : 'Speech recognition is not available in this browser. Use the text box.', priority: 'high' });
      say(gameRef.current.describeShop('Round one. '));
    }
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed.trim()) return;
    speaker.unlock();
    handlePhrase([typed.trim()]);
    setTyped('');
  };

  const micOk = mic?.status === 'listening' || mic?.status === 'paused' || mic?.status === 'starting';
  const traits = activeTraits(g.board);

  return (
    <div className="app">
      <header className="top">
        <div><b>Round {g.round}</b> · ❤️ {g.hp} · 🪙 {g.gold} · Lv {g.level} ({g.xp}/{g.xpNeeded || '-'} XP) · {g.board.length}/{g.maxUnits} units</div>
      </header>

      <section className={`mic mic-${mic?.status}`} aria-live="polite">
        <div className="mic-row">
          <span className="dot" />
          <span className="mic-status">{micLabel(mic, speaking)}</span>
          {micOk
            ? <button className="small" onClick={() => listener.stop()}>Mic off</button>
            : <button className="big" onClick={start}>{started ? 'Tap to resume listening' : 'Start voice game'}</button>}
        </div>
        {mic && mic.status !== 'listening' && mic.status !== 'paused' && <div className="mic-msg">{mic.message}</div>}
        {mic?.lastHeard && <div className="heard">Heard: “{mic.lastHeard}”</div>}
        <div className="meta">
          Voice: {speaker.voiceName} · Restarts: {mic?.restarts ?? 0} · Screen awake: {wakeLock}
        </div>
      </section>

      <form className="typed" onSubmit={submitTyped}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Or type a command, e.g. "buy slot 2"' />
        <button type="submit">Send</button>
      </form>

      <section>
        <h3>Shop {g.phase === 'battle' && <em>(battle in progress)</em>}</h3>
        <div className="shop">
          {g.shop.map((id, i) => (
            <button key={i} className={`card cost${id ? UNIT_BY_ID[id].cost : 0}`} disabled={!id || g.phase !== 'prep'} onClick={() => say(g.buy(i + 1))}>
              <small>{i + 1}</small>
              {id ? <><b>{UNIT_BY_ID[id].name}</b><span>{UNIT_BY_ID[id].cost}🪙</span><i>{UNIT_BY_ID[id].traits.join(' · ')}</i></> : <span>—</span>}
            </button>
          ))}
        </div>
        <div className="actions">
          <button onClick={() => execute({ type: 'refresh' })}>Refresh (2)</button>
          <button onClick={() => execute({ type: 'buyXp' })}>Buy XP (4)</button>
          <button onClick={() => execute({ type: 'fight' })} disabled={g.phase !== 'prep'}>Fight{timerOn ? ` (${secondsLeft}s)` : ''}</button>
        </div>
      </section>

      <section>
        <h3>Board <small>(A = front)</small></h3>
        <div className="board">
          {BOARD_ROWS.map((r, ri) => Array.from({ length: BOARD_COLS }, (_, ci) => {
            const u = g.board.find((b) => b.row === ri && b.col === ci);
            return (
              <div key={`${r}${ci}`} className={`cell ${u ? `cost${UNIT_BY_ID[u.defId].cost}` : ''}`}>
                <small>{cellName(ri, ci)}</small>
                {u && <><b>{UNIT_BY_ID[u.defId].name}</b><span>{'★'.repeat(u.stars)}</span></>}
              </div>
            );
          }))}
        </div>
        <h3>Bench</h3>
        <div className="bench">
          {g.bench.map((u, i) => <div key={i} className={`cell ${u ? `cost${UNIT_BY_ID[u.defId].cost}` : ''}`}>{u && <><b>{UNIT_BY_ID[u.defId].name}</b><span>{'★'.repeat(u.stars)}</span></>}</div>)}
        </div>
        {traits.length > 0 && <div className="traits">{traits.map((t) => <span key={t.trait} className={t.tier ? 'on' : ''}>{t.trait} {t.count}</span>)}</div>}
      </section>

      <section>
        <h3>Opponents</h3>
        <div className="opps">{g.opponents.map((o) => <span key={o.name} className={o === g.opponent ? 'next' : o.hp <= 0 ? 'dead' : ''}>{o.name}: {o.hp}</span>)}</div>
      </section>

      <section>
        <h3>Settings</h3>
        <div className="actions">
          {(['minimal', 'balanced', 'detailed'] as Verbosity[]).map((v) => (
            <button key={v} className={v === verbosity ? 'active' : ''} onClick={() => execute({ type: 'verbosity', level: v })}>{v}</button>
          ))}
          <button className={timerOn ? 'active' : ''} onClick={() => execute({ type: 'timer', on: !timerOn })}>Round timer {timerOn ? 'on' : 'off'}</button>
        </div>
      </section>

      <section>
        <h3>Log</h3>
        <ul className="log">{log.map((l, i) => <li key={i} className={l.who}>{l.who === 'you' ? '🗣 ' : '🔊 '}{l.text}</li>)}</ul>
      </section>
    </div>
  );
}

function micLabel(mic: MicState | null, speaking: boolean) {
  if (!mic) return '…';
  if (speaking) return '🔊 Speaking (mic paused)';
  switch (mic.status) {
    case 'listening': return '🎙 Listening';
    case 'starting': return '⏳ Starting mic…';
    case 'paused': return '⏸ Mic paused';
    case 'denied': return '⛔ Mic permission denied';
    case 'unsupported': return '⚠️ No speech recognition';
    case 'error': return '⚠️ Mic error';
    case 'stopped': return '🔇 Not listening';
    default: return '🔇 Mic not started';
  }
}

async function requestWakeLock(set: (s: 'on' | 'off' | 'unsupported') => void) {
  const wl = (navigator as any).wakeLock;
  if (!wl) { set('unsupported'); return; }
  try { const lock = await wl.request('screen'); set('on'); lock.addEventListener('release', () => set('off')); }
  catch { set('off'); }
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
