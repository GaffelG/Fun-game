// Turns recognized speech into game commands. Tolerant of common mishearings.
import { UNITS } from '../game/config';

export type Command =
  | { type: 'shop' }
  | { type: 'slotInfo'; slot: number }
  | { type: 'buy'; slot: number }
  | { type: 'buyName'; name: string }
  | { type: 'refresh' }
  | { type: 'buyXp' }
  | { type: 'levelUp' }
  | { type: 'place'; name: string; row: number; col: number }
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
const ROW: Record<string, number> = { a: 0, ay: 0, hey: 0, eh: 0, b: 1, be: 1, bee: 1, c: 2, see: 2, sea: 2, si: 2 };

export function normalize(raw: string): string {
  return raw.toLowerCase()
    .replace(/[.,!?'’]/g, '')
    .replace(/\b([abc])\s*-?\s*([1-4])\b/g, '$1$2')     // "b 2" -> "b2"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find a cell like b2 / "bee two" / "see 3" in the text. */
function findCell(t: string): { row: number; col: number } | null {
  const direct = t.match(/\b([abc])([1-4])\b/);
  if (direct) return { row: ROW[direct[1]], col: Number(direct[2]) - 1 };
  const words = t.split(' ');
  for (let i = words.length - 2; i >= 0; i--) {
    const r = ROW[words[i]], c = NUM[words[i + 1]];
    if (r !== undefined && c !== undefined && c <= 4) return { row: r, col: c - 1 };
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

const GENERIC = ['mage', 'guard', 'archer', 'scout', 'knife', 'frost', 'fire', 'storm', 'shadow'];
/** Match a unit name or trait mentioned in text. */
function findUnitName(t: string): string | null {
  const byName = [...UNITS].sort((a, b) => b.name.length - a.name.length).find((u) => t.includes(u.name.toLowerCase()));
  if (byName) return byName.name;
  // partial first word, e.g. "ember", "phantom", "dragon"
  for (const u of UNITS) for (const w of u.name.toLowerCase().split(' ')) if (w.length > 3 && !GENERIC.includes(w) && new RegExp(`\\b${w}\\b`).test(t)) return u.name;
  const trait = t.match(/\b(warrior|mage|ranger|guardian|assassin|archer|tank)s?\b/);
  if (trait) return trait[1] === 'archer' ? 'ranger' : trait[1] === 'tank' ? 'guardian' : trait[1];
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

  // Place / move
  if (/\b(place|put|move|position|send|set)\b/.test(t)) {
    const cell = findCell(t);
    const name = findUnitName(t);
    if (/\bbench\b/.test(t) && name) return { type: 'bench', name };
    if (cell && name) return { type: 'place', name, ...cell };
  }
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
  return null;
}

export const HELP_TEXT =
  'You can say: what is in the shop, buy slot two, refresh, buy experience, level up, ' +
  'place my mage in B2, move my warrior to A3, bench my squire, sell my squire, tell me about my team, ' +
  'scout opponent, how much gold, status, fight, what happened last battle, repeat, or quiet. ' +
  'To buy, you can also just say the slot number, like four. Say undo if I misheard a purchase. ' +
  'Ask what should I do for advice. Lock shop keeps the shop for next round. ' +
  'More questions: how many units can I have, what is on my bench, my synergies, what can I afford, what can I upgrade, how much XP, standings, time left. ' +
  'Fill board puts bench units on empty spots. Buy all squires buys every copy in the shop. ' +
  'Voice: next voice, faster, slower. ' +
  'Settings: minimal, balanced or detailed announcements, start timer, stop timer, and new game.';
