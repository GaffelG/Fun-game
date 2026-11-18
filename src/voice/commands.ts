// Turns recognized speech into game commands. Tolerant of common mishearings.
import { NAME_ALIASES, UNITS } from '../game/config';

export type Command =
  | { type: 'shop' }
  | { type: 'slotInfo'; slot: number }
  | { type: 'buy'; slot: number }
  | { type: 'buyName'; name: string }
  | { type: 'refresh' }
  | { type: 'buyXp' }
  | { type: 'levelUp' }
  /** col is null when only a row was named ("front"): the game picks a free spot in that row */
  | { type: 'place'; name: string; row: number; col: number | null }
  /** Only a unit name was heard; the game decides (buy it if it's in the shop, otherwise describe it). */
  | { type: 'nameOnly'; name: string }
  | { type: 'bench'; name: string }
  | { type: 'sell'; name: string }
  | { type: 'team' }
  | { type: 'unitInfo'; name: string }
  | { type: 'scout' }
  | { type: 'gold' }
  | { type: 'status' }
  | { type: 'fight' }
  | { type: 'lastBattle' }
  | { type: 'repeat' }
  | { type: 'quiet' }
  | { type: 'help' }
  | { type: 'verbosity'; level: 'minimal' | 'balanced' | 'detailed' }
  | { type: 'timer'; on: boolean }
  | { type: 'newGame' }
  | { type: 'unitLimit' }
  | { type: 'benchInfo' }
  | { type: 'synergies' }
  | { type: 'afford' }
  | { type: 'upgrades' }
  | { type: 'fillBoard' }
  | { type: 'xpInfo' }
  | { type: 'standings' }
  | { type: 'buyAll'; name: string }
  | { type: 'voice'; change: 'next' | 'faster' | 'slower' | 'which' }
  | { type: 'timeLeft' }
  | { type: 'advice' }
  | { type: 'undo' }
  | { type: 'lock'; on: boolean };

const NUM: Record<string, number> = {
  one: 1, won: 1, '1': 1, first: 1,
  two: 2, to: 2, too: 2, '2': 2, second: 2,
  three: 3, tree: 3, free: 3, '3': 3, third: 3,
  four: 4, for: 4, fore: 4, '4': 4, fourth: 4,
  five: 5, '5': 5, fifth: 5,
};
// Spoken letters for the board rows, including common mishearings.
const ROW: Record<string, number> = {
  a: 0, ay: 0, hey: 0, eh: 0, eight: 0, '8': 0, hay: 0, aye: 0,
  b: 1, be: 1, bee: 1, v: 1, vee: 1, d: 1, dee: 1, pee: 1, p: 1,
  c: 2, see: 2, sea: 2, si: 2, she: 2, z: 2, zee: 2, cee: 2, t: 2, tea: 2,
};
const ROW_WORDS: Record<string, number> = { front: 0, first: 0, middle: 1, mid: 1, center: 1, centre: 1, back: 2, backline: 2, rear: 2 };
const COL: Record<string, number> = { ...{ one: 1, won: 1, '1': 1, two: 2, to: 2, too: 2, '2': 2, three: 3, tree: 3, free: 3, '3': 3, four: 4, for: 4, fore: 4, '4': 4 } };

export function normalize(raw: string): string {
  return raw.toLowerCase()
    .replace(/[.,!?'’]/g, '')
    .replace(/\b([abc])\s*-?\s*([1-4])\b/g, '$1$2')     // "b 2" -> "b2"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find a cell like b2 / "bee two" / "see 3" in the text. */
function findCell(t: string): { row: number; col: number | null } | null {
  const direct = t.match(/\b([abc])([1-4])\b/);
  if (direct) return { row: ROW[direct[1]], col: Number(direct[2]) - 1 };
  // "83" is a very common mishearing of "A3"; "v2"/"d2" of "B2".
  const glued = t.match(/\b(8|v|d|p|z|t)([1-4])\b/);
  if (glued) return { row: ROW[glued[1]], col: Number(glued[2]) - 1 };
  const words = t.split(' ');
  for (let i = words.length - 2; i >= 0; i--) {
    const r = ROW[words[i]], c = COL[words[i + 1]];
    if (r !== undefined && c !== undefined) return { row: r, col: c - 1 };
  }
  // "front 3", "back row", "the middle"
  for (let i = 0; i < words.length; i++) {
    const r = ROW_WORDS[words[i]];
    if (r === undefined || (words[i] === 'first' && !/\b(row|line)\b/.test(t))) continue;
    const next = COL[words[i + 1]] ?? COL[words[i + 2]];
    return { row: r, col: next !== undefined ? next - 1 : null };
  }
  return null;
}

function findSlot(t: string): number | null {
  const m = t.match(/\b(?:slot|lot|spot|slaught|number)\s+(\w+)/);
  if (m && NUM[m[1]]) return NUM[m[1]];
  const m2 = t.match(/\b(first|second|third|fourth|fifth)\b/);
  if (m2) return NUM[m2[1]];
  return null;
}

/** Words that must never be fuzzy-matched to a unit name. */
const NOT_NAMES = new Set(['place', 'plays', 'play', 'buy', 'sell', 'move', 'shop', 'gold', 'level', 'team', 'bench', 'board', 'front', 'back', 'what', 'tell', 'about',
  'slot', 'fight', 'scout', 'help', 'quiet', 'undo', 'lock', 'refresh', 'roll', 'many', 'units', 'much', 'have', 'there', 'here', 'with', 'your', 'right', 'left',
  'nice', 'game', 'time', 'next', 'voice', 'faster', 'slower', 'party', 'into', 'some', 'like', 'make', 'take', 'give', 'want', 'that', 'this', 'then', 'they',
  'need', 'more', 'less', 'last', 'best', 'park', 'mark', 'dark', 'bark', 'rich', 'mine', 'line', 'nine', 'king', 'ring', 'thing']);

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Match a single heard word to a unit: exact, known mishearing, plural, or a close spelling. */
function matchUnitWord(w: string): string | null {
  const id = NAME_ALIASES[w] ?? w;
  const exact = UNITS.find((x) => x.id === id || `${x.id}s` === id);
  if (exact) return exact.name;
  if (w.length < 4 || NOT_NAMES.has(w)) return null;
  let best: { name: string; dist: number } | null = null;
  for (const u of UNITS) {
    const dist = editDistance(w, u.id);
    const allowed = u.id.length >= 6 ? 2 : 1;
    if (dist <= allowed && (!best || dist < best.dist)) best = { name: u.name, dist };
  }
  return best?.name ?? null;
}

/** Match a unit name or trait mentioned in text (whole words only, with common mishearings). */
function findUnitName(t: string): string | null {
  for (const w of t.split(' ')) {
    const name = matchUnitWord(w);
    if (name) return name;
  }
  const trait = t.match(/\b(warrior|mage|ranger|guardian|assassin|tank)s?\b/);
  if (trait) return trait[1] === 'tank' ? 'guardian' : trait[1];
  return null;
}

/** "44" or "4 4" -> "4": recognizers often double a lone number. */
function bareSlot(t: string): number | null {
  const m = t.match(/^(?:number |slot )?([1-5])(?:\s?\1)*$/) ?? t.match(/^(?:number |slot )?(one|two|three|four|five|won|too|tree|free|fore)$/);
  return m ? NUM[m[1]] : null;
}

export function parseCommand(raw: string): Command | null {
  const t = normalize(raw).replace(/\b(by|bye|bi|bae|boy|vibe|bike|buyer)\b/g, 'buy').replace(/^(i|ill|i will|lets|please) /, '');
  if (!t) return null;

  if (/\b(undo|take (that|it) back|cancel (that|purchase)|oops|mistake|wrong one)\b/.test(t)) return { type: 'undo' };
  if (/\b(what should i do|advice|any tips|tip|suggest|suggestion|recommend|coach|help me decide)\b/.test(t)) return { type: 'advice' };
  if (/\bunlock( the)? shop\b/.test(t)) return { type: 'lock', on: false };
  if (/\b(lock|freeze|keep|hold)( the)? shop\b/.test(t)) return { type: 'lock', on: true };

  // A lone slot number means "buy that slot". This is the shortest, most reliable way to buy.
  const lone = bareSlot(t) ?? bareSlot(t.replace(/^buy\s?/, ''));
  if (lone) return { type: 'buy', slot: lone };

  // Placing: a unit name plus a square or row is enough. The verb is optional because
  // "place" is often heard as "play", "plays", "please" or dropped entirely.
  if (!/\b(sell|cell|buy|tell|what|whats|about|info|describe)\b/.test(t)) {
    const name = findUnitName(t);
    const cell = findCell(t);
    if (name && cell && (cell.col !== null || /\b(place|play|plays|played|put|move|send|set|go|goes|to|in|on|at|row|line)\b/.test(t) || t.split(' ').length <= 3)) {
      return { type: 'place', name, row: cell.row, col: cell.col };
    }
  }

  if (/\bhow many (units|characters|champions|heroes)\b|\b(unit|board|team) (limit|cap|size|space)\b|\bhow many can i\b|\bmax(imum)? units\b|\b(room|space) (on|for)\b/.test(t)) return { type: 'unitLimit' };
  if (/\b(whats|what is|who is|whos)? ?on (my|the) bench\b|\bmy bench\b|\bbench (info|units)\b/.test(t) && !/\b(place|put|move|sell)\b/.test(t)) return { type: 'benchInfo' };
  if (/\b(synergy|synergies|traits|bonuses)\b/.test(t)) return { type: 'synergies' };
  if (/\b(afford|what can i buy)\b/.test(t)) return { type: 'afford' };
  if (/\b(upgrade|upgrades|close to|pairs|copies)\b/.test(t) && !/\bbuy\b/.test(t)) return { type: 'upgrades' };
  if (/\b(fill|auto ?place|place all|place everything|field all|put all)\b/.test(t)) return { type: 'fillBoard' };
  if (/\b(how much|my|current) (xp|exp|experience)\b|\bnext level\b|\bhow far\b/.test(t)) return { type: 'xpInfo' };
  if (/\b(standings|scoreboard|leaderboard|everyone|all opponents|opponents health)\b/.test(t)) return { type: 'standings' };
  if (/\b(time left|how long|seconds left|how much time)\b/.test(t)) return { type: 'timeLeft' };
  if (/\b(next|change|different|other|switch) voice\b/.test(t)) return { type: 'voice', change: 'next' };
  if (/\b(speak|talk|read) faster\b|\bfaster\b/.test(t)) return { type: 'voice', change: 'faster' };
  if (/\b(speak|talk|read) slower\b|\bslower\b|\bslow down\b/.test(t)) return { type: 'voice', change: 'slower' };
  if (/\b(which|what) voice\b/.test(t)) return { type: 'voice', change: 'which' };
  const buyAll = t.match(/\bbuy (all|every|each)( the)? (\w+(?: \w+)?)/);
  if (buyAll) { const name = findUnitName(buyAll[3]); if (name) return { type: 'buyAll', name }; }

  if (/\b(stop talking|quiet|shut up|silence|skip|be quiet)\b/.test(t)) return { type: 'quiet' };
  if (/\b(repeat|say that again|what did you say|pardon)\b/.test(t)) return { type: 'repeat' };
  if (/\b(help|what can i say|commands)\b/.test(t)) return { type: 'help' };
  if (/\bnew game\b|\brestart game\b|\bplay again\b/.test(t)) return { type: 'newGame' };
  if (/\b(minimal|minimum) (mode|announcements|commentary)?/.test(t) || /\bless (talking|commentary)\b/.test(t)) return { type: 'verbosity', level: 'minimal' };
  if (/\bbalanced\b/.test(t)) return { type: 'verbosity', level: 'balanced' };
  if (/\bdetailed\b/.test(t) || /\bmore commentary\b/.test(t)) return { type: 'verbosity', level: 'detailed' };
  if (/\b(pause|stop|disable) (the )?timer\b/.test(t)) return { type: 'timer', on: false };
  if (/\b(start|resume|enable) (the )?timer\b/.test(t)) return { type: 'timer', on: true };

  if (/\b(refresh|reroll|re roll|roll|new shop)\b/.test(t)) return { type: 'refresh' };
  if (/\blevel up\b|\blevel me\b/.test(t)) return { type: 'levelUp' };
  if (/\bbuy (xp|exp|experience)\b|\b(xp|experience) buy\b|^experience$|^xp$/.test(t)) return { type: 'buyXp' };

  if (/\bbench\b/.test(t)) { const name = findUnitName(t); if (name) return { type: 'bench', name }; }
  if (/\bsell\b|\bcell\b/.test(t)) { const name = findUnitName(t); if (name) return { type: 'sell', name }; }

  if (/\b(buy|purchase|get|take)\b/.test(t)) {
    const slot = findSlot(t) ?? (() => { const m = t.match(/\bbuy (\w+)$/); return m && NUM[m[1]] ? NUM[m[1]] : null; })();
    if (slot) return { type: 'buy', slot };
    const name = findUnitName(t);
    if (name) return { type: 'buyName', name };
  }

  if (/\b(scout|opponent|enemy|who am i (facing|fighting))\b/.test(t)) return { type: 'scout' };
  if (/\b(fight|ready|start (the )?battle|battle|go)\b/.test(t)) return { type: 'fight' };
  if (/\b(last|previous) (battle|fight|round)\b|\bwhat happened\b/.test(t)) return { type: 'lastBattle' };
  if (/\bgold\b|\bmoney\b/.test(t)) return { type: 'gold' };
  if (/\b(status|health|hp|level|round)\b/.test(t) && !/\bbuy\b/.test(t)) return { type: 'status' };
  if (/\b(my team|my board|my units|team|board)\b/.test(t)) return { type: 'team' };

  const slot = findSlot(t);
  if (slot && /\b(what|tell|about|info|details|describe|is)\b/.test(t)) return { type: 'slotInfo', slot };
  if (/\bshop\b|\bstore\b/.test(t)) return { type: 'shop' };
  if (slot) return { type: 'slotInfo', slot };

  if (/\b(tell me about|what is|whats|what does|info|describe|cost|class|ability)\b/.test(t)) {
    const name = findUnitName(t);
    if (name) return { type: 'unitInfo', name };
  }

  // Just a name (maybe with filler like "the ninja", "a ninja please"): the "buy" was probably not heard.
  const rest = t.replace(/\b(the|a|an|my|please|one|now|ok|okay|yes|play|plays|place|get|i|want)\b/g, '').trim();
  if (rest && rest.split(' ').length <= 2) {
    const name = findUnitName(rest);
    if (name && UNITS.some((u) => u.name === name)) return { type: 'nameOnly', name };
  }
  return null;
}

/** How specific a command is. When several transcripts parse, prefer the most specific one. */
const SPECIFICITY: Partial<Record<Command['type'], number>> = { nameOnly: 1, slotInfo: 1, unitInfo: 2, status: 2, team: 2, fight: 2 };

/** Parse all recognition alternatives and pick the best command. */
export function parseBest(alternatives: string[]): Command | null {
  let best: { cmd: Command; score: number } | null = null;
  alternatives.forEach((alt, i) => {
    const cmd = parseCommand(alt);
    if (!cmd) return;
    const score = (SPECIFICITY[cmd.type] ?? 5) * 10 - i; // earlier alternatives win ties
    if (!best || score > best.score) best = { cmd, score };
  });
  return best ? (best as { cmd: Command }).cmd : null;
}

export const HELP_TEXT =
  'You can say: what is in the shop, buy slot two, refresh, buy experience, level up, ' +
  'ninja A3, knight front, move my warrior to B2, bench my knight, sell my knight, tell me about my team, ' +
  'scout opponent, how much gold, status, fight, what happened last battle, repeat, or quiet. ' +
  'To buy, you can also just say the slot number, like four. Say undo if I misheard a purchase. ' +
  'Ask what should I do for advice. Lock shop keeps the shop for next round. ' +
  'More questions: how many units can I have, what is on my bench, my synergies, what can I afford, what can I upgrade, how much XP, standings, time left. ' +
  'Fill board puts bench units on empty spots. Buy all knights buys every copy in the shop. ' +
  'Voice: next voice, faster, slower. ' +
  'Settings: minimal, balanced or detailed announcements, start timer, stop timer, and new game.';
