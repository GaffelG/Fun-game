import { describe, it, expect } from 'vitest';
import { parseCommand } from '../voice/commands';
import { Game } from '../game/engine';

describe('parseCommand', () => {
  const cases: [string, unknown][] = [
    ["What's in the shop?", { type: 'shop' }],
    ['Buy slot two.', { type: 'buy', slot: 2 }],
    ['by slot to', { type: 'buy', slot: 2 }],
    ['Buy experience.', { type: 'buyXp' }],
    ['Level up.', { type: 'levelUp' }],
    ['Place my Mage in B2.', { type: 'place', name: 'mage', row: 1, col: 1 }],
    ['Move my Warrior to A3.', { type: 'place', name: 'warrior', row: 0, col: 2 }],
    ['move my squire to bee four', { type: 'place', name: 'Squire', row: 1, col: 3 }],
    ['Scout opponent.', { type: 'scout' }],
    ['Tell me about my team.', { type: 'team' }],
    ['How much gold do I have?', { type: 'gold' }],
    ['refresh the shop', { type: 'refresh' }],
    ['tell me about slot three', { type: 'slotInfo', slot: 3 }],
    ['what does ember mage do', { type: 'unitInfo', name: 'Ember Mage' }],
  ];
  for (const [input, expected] of cases) it(input, () => expect(parseCommand(input)).toEqual(expected));
});

describe('Game', () => {
  it('combines three copies into two stars', () => {
    const g = new Game();
    g.gold = 100;
    g.shop = ['squire', 'squire', 'squire', null, null];
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
