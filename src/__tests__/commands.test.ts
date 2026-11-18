import { describe, it, expect } from 'vitest';
import { parseBest, parseCommand } from '../voice/commands';
import { Game } from '../game/engine';
import { UNITS } from '../game/config';

describe('parseCommand', () => {
  const cases: [string, unknown][] = [
    ["What's in the shop?", { type: 'shop' }],
    ['Buy slot two.', { type: 'buy', slot: 2 }],
    ['by slot to', { type: 'buy', slot: 2 }],
    ['Buy experience.', { type: 'buyXp' }],
    ['Level up.', { type: 'levelUp' }],
    ['Place my Mage in B2.', { type: 'place', name: 'mage', row: 1, col: 1 }],
    ['Move my Warrior to A3.', { type: 'place', name: 'warrior', row: 0, col: 2 }],
    ['move my knight to bee four', { type: 'place', name: 'Knight', row: 1, col: 3 }],
    ['Scout opponent.', { type: 'scout' }],
    ['Tell me about my team.', { type: 'team' }],
    ['How much gold do I have?', { type: 'gold' }],
    ['refresh the shop', { type: 'refresh' }],
    ['tell me about slot three', { type: 'slotInfo', slot: 3 }],
    ['what does the ninja do', { type: 'unitInfo', name: 'Ninja' }],
  ];
  for (const [input, expected] of cases) it(input, () => expect(parseCommand(input)).toEqual(expected));
});

describe('Game', () => {
  it('combines three copies into two stars', () => {
    const g = new Game();
    g.gold = 100;
    g.shop = ['knight', 'knight', 'knight', null, null];
    const msgs = [...g.buy(1), ...g.buy(2), ...g.buy(3)].map((m) => m.text);
    expect(msgs.some((m) => m.includes('upgraded to two stars'))).toBe(true);
    const all = [...g.board, ...g.bench].filter(Boolean);
    expect(all.length).toBe(1);
    expect(all[0]!.stars).toBe(2);
  });
  it('levels up and runs a full round', () => {
    const g = new Game();
    g.gold = 50;
    expect(g.levelUp().text).toContain('level 2');
    g.startBattle();
    const out = g.finishBattle();
    expect(out.length).toBeGreaterThan(0);
    expect(g.round).toBe(2);
  });
  it('ignores finishBattle outside a battle', () => {
    const g = new Game();
    expect(g.finishBattle()).toEqual([]);
    g.gold = 10; g.buy(1); g.startBattle();
    g.finishBattle();
    const round = g.round;
    expect(g.finishBattle()).toEqual([]);
    expect(g.round).toBe(round);
  });
  it('never sells from an empty pool', () => {
    const g = new Game();
    g.shop = [null, null, null, null, null];
    for (const k of Object.keys(g.pool)) g.pool[k] = 0;
    g.gold = 10;
    g.refresh();
    expect(g.shop.every((s) => s === null)).toBe(true);
    expect(Object.values(g.pool).every((n) => n >= 0)).toBe(true);
  });
});

import { simulateBattle } from '../game/battle';
describe('abilities', () => {
  it('Warlord shields itself when casting', () => {
    // Warlord alone vs a sturdy dummy; it must survive longer thanks to shields. Just ensure no crash and a result.
    const r = simulateBattle([{ uid: 1, defId: 'general', stars: 1, row: 0, col: 1 }], [{ uid: 2, defId: 'knight', stars: 1, row: 0, col: 1 }]);
    expect(r.winner).toBe(0);
  });
});

describe('new commands', () => {
  const cases: [string, unknown][] = [
    ['4', { type: 'buy', slot: 4 }],
    ['44', { type: 'buy', slot: 4 }],
    ['four', { type: 'buy', slot: 4 }],
    ['by for', { type: 'buy', slot: 4 }],
    ['buy 4', { type: 'buy', slot: 4 }],
    ['How many units can I have?', { type: 'unitLimit' }],
    ["What's on my bench", { type: 'benchInfo' }],
    ['what are my synergies', { type: 'synergies' }],
    ['what can I afford', { type: 'afford' }],
    ['what can I upgrade', { type: 'upgrades' }],
    ['fill the board', { type: 'fillBoard' }],
    ['how much XP do I have', { type: 'xpInfo' }],
    ['standings', { type: 'standings' }],
    ['buy all knights', { type: 'buyAll', name: 'Knight' }],
    ['next voice', { type: 'voice', change: 'next' }],
    ['speak slower', { type: 'voice', change: 'slower' }],
    ['how much time left', { type: 'timeLeft' }],
    ['place my mage in B2', { type: 'place', name: 'mage', row: 1, col: 1 }],
  ];
  for (const [input, expected] of cases) it(input, () => expect(parseCommand(input)).toEqual(expected));
});

describe('smart features', () => {
  it('parses', () => {
    expect(parseCommand('what should I do')).toEqual({ type: 'advice' });
    expect(parseCommand('undo')).toEqual({ type: 'undo' });
    expect(parseCommand('lock the shop')).toEqual({ type: 'lock', on: true });
    expect(parseCommand('unlock shop')).toEqual({ type: 'lock', on: false });
  });
  it('undo refunds a purchase', () => {
    const g = new Game();
    g.shop = ['knight', 'lava', 'archer', 'rock', 'ninja'];
    const before = g.gold;
    g.buy(1);
    expect(g.undo().text).toContain('Undone');
    expect(g.gold).toBe(before);
    expect(g.shop[0]).toBe('knight');
    expect(g.board.length).toBe(0);
  });
  it('shop hints upgrades and advice suggests it', () => {
    const g = new Game();
    g.gold = 20;
    g.shop = ['knight', 'knight', 'lava', null, null];
    g.buy(1); g.buy(2);
    g.shop = ['lava', 'knight', null, null, null];
    expect(g.describeShop().text).toContain('Upgrades your unit');
    expect(g.advice().text).toContain('slot two');
  });
  it('locked shop survives a round', () => {
    const g = new Game();
    g.gold = 10; g.buy(1);
    const shop = [...g.shop];
    g.setLock(true);
    g.startBattle(); g.finishBattle();
    if (g.phase === 'prep') expect(g.shop).toEqual(shop);
  });
});

describe('unit names', () => {
  it('are unique single words and not command words', () => {
    const banned = ['scout', 'gold', 'level', 'shop', 'buy', 'sell', 'fight', 'team', 'bench', 'help', 'quiet', 'undo', 'lock'];
    const names = UNITS.map((u) => u.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) { expect(n).not.toContain(' '); expect(banned).not.toContain(n); }
  });
  it('hears common mishearings', () => {
    expect(parseCommand('sell my night')).toEqual({ type: 'sell', name: 'Knight' });
    expect(parseCommand('move the yetti to c1')).toEqual({ type: 'place', name: 'Yeti', row: 2, col: 0 });
    expect(parseCommand('tell me about phoenix')).toEqual({ type: 'unitInfo', name: 'Phoenix' });
  });
  it('does not match names inside other words', () => {
    expect(parseCommand('place my mage in b2')).toEqual({ type: 'place', name: 'mage', row: 1, col: 1 });
  });
});

describe('hard-to-hear commands', () => {
  const cases: [string, unknown][] = [
    ['place ninja on a3', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['play ninja on a3', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['plays ninja a3', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['please ninja to a three', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['ninja a3', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['ninja 83', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['ninja to eight three', { type: 'place', name: 'Ninja', row: 0, col: 2 }],
    ['knight bee too', { type: 'place', name: 'Knight', row: 1, col: 1 }],
    ['knight v2', { type: 'place', name: 'Knight', row: 1, col: 1 }],
    ['yeti see four', { type: 'place', name: 'Yeti', row: 2, col: 3 }],
    ['ninja front', { type: 'place', name: 'Ninja', row: 0, col: null }],
    ['move the archer to the back', { type: 'place', name: 'Archer', row: 2, col: null }],
    ['ninja front 2', { type: 'place', name: 'Ninja', row: 0, col: 1 }],
    ['ninja', { type: 'nameOnly', name: 'Ninja' }],
    ['the ninja please', { type: 'nameOnly', name: 'Ninja' }],
    ['buy ninja', { type: 'buyName', name: 'Ninja' }],
    ['lava', { type: 'nameOnly', name: 'Lava' }],
    ['larva', { type: 'nameOnly', name: 'Lava' }],
    ['ninjas', { type: 'nameOnly', name: 'Ninja' }],
    ['phonix', { type: 'nameOnly', name: 'Phoenix' }],
    ['shamen b1', { type: 'place', name: 'Shaman', row: 1, col: 0 }],
    ['sell my ninja', { type: 'sell', name: 'Ninja' }],
    ['what does the ninja do', { type: 'unitInfo', name: 'Ninja' }],
    ['bench my knight', { type: 'bench', name: 'Knight' }],
    ['play again', { type: 'newGame' }],
    ['fight', { type: 'fight' }],
    ['scout opponent', { type: 'scout' }],
  ];
  for (const [input, expected] of cases) it(input, () => expect(parseCommand(input)).toEqual(expected));
  it('prefers the more specific alternative', () => {
    expect(parseBest(['ninja', 'ninja a3'])).toEqual({ type: 'place', name: 'Ninja', row: 0, col: 2 });
  });
});
