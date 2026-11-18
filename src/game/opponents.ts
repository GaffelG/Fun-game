import { AI, SHOP_ODDS, Trait, UNITS, UNITS_PER_LEVEL, UnitDef } from './config';
import { BoardUnit, activeTraits } from './battle';

export interface Strategy {
  id: string;
  description: string;
  favored: Trait[];
  /** front-line preference: tanks first */
  tanky: boolean;
}

export const STRATEGIES: Strategy[] = [
  { id: 'aggressive', description: 'an aggressive team of Warriors and Assassins', favored: ['Warrior', 'Assassin'], tanky: false },
  { id: 'defensive', description: 'a defensive wall of Guardians', favored: ['Guardian', 'Frost'], tanky: true },
  { id: 'magic', description: 'a magic damage team built around Mages', favored: ['Mage', 'Fire'], tanky: false },
  { id: 'physical', description: 'a physical damage team of Rangers', favored: ['Ranger', 'Storm'], tanky: false },
  { id: 'synergy', description: 'a synergy team that upgrades its units', favored: ['Storm', 'Frost'], tanky: true },
];

export interface Opponent {
  name: string;
  strategy: Strategy;
  hp: number;
  board: BoardUnit[];
}

const NAMES = ['Captain Rook', 'Lady Vex', 'The Old Hermit', 'Baron Ash', 'Sister Gale'];

export function createOpponents(count: number): Opponent[] {
  const strategies = [...STRATEGIES].sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => ({
    name: NAMES[i % NAMES.length],
    strategy: strategies[i % strategies.length],
    hp: 100,
    board: [],
  }));
}

/** Build a fresh AI board for the given round. Stronger as the game goes on. */
export function buildOpponentBoard(op: Opponent, round: number): BoardUnit[] {
  const level = Math.min(9, 1 + Math.floor(round * AI.levelPerRound));
  const size = UNITS_PER_LEVEL[level];
  // Only use cost tiers that a player of this level would commonly see in the shop.
  const commonCost = SHOP_ODDS[level].reduce((m, pct, i) => (pct >= AI.minShopOdds ? i + 1 : m), 1);
  const maxCost = Math.min(commonCost, 1 + Math.floor(round / AI.costTierEvery));
  // Draw units like a player would: each pick rolls a cost tier using the shop odds for this level,
  // then prefers units matching the strategy's favored traits. No duplicates (stars model copies).
  const odds = SHOP_ODDS[level].slice(0, maxCost);
  const total = odds.reduce((a, b) => a + b, 0);
  const picks: UnitDef[] = [];
  for (let tries = 0; picks.length < size && tries < 50; tries++) {
    let r = Math.random() * total, cost = 1;
    for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) { cost = i + 1; break; } }
    const options = UNITS.filter((u) => u.cost === cost && !picks.includes(u));
    if (!options.length) continue;
    const weight = (u: UnitDef) => 1 + u.traits.filter((t) => op.strategy.favored.includes(t)).length * 3;
    let w = Math.random() * options.reduce((a, u) => a + weight(u), 0);
    picks.push(options.find((u) => (w -= weight(u)) < 0) ?? options[0]);
  }

  const starBonus = op.strategy.id === 'synergy' ? 0.15 : 0;
  const twoStarChance = Math.min(AI.twoStarMax, round * AI.twoStarPerRound + starBonus);
  const threeStarChance = Math.max(0, (round - AI.threeStarFromRound) * AI.threeStarPerRound);

  const isTank = (u: UnitDef) => u.traits.includes('Guardian') || u.traits.includes('Warrior') || u.traits.includes('Assassin');
  const front = picks.filter(isTank);
  const back = picks.filter((u) => !isTank(u));
  const units: BoardUnit[] = [];
  let uid = 10000;
  const place = (list: UnitDef[], rows: number[]) => {
    for (const d of list) {
      for (const r of rows) {
        const used = units.filter((u) => u.row === r).map((u) => u.col);
        const col = [1, 2, 0, 3].find((c) => !used.includes(c));
        if (col !== undefined) {
          const roll = Math.random();
          const stars = roll < threeStarChance ? 3 : roll < twoStarChance ? 2 : 1;
          units.push({ uid: uid++, defId: d.id, stars, row: r, col });
          break;
        }
      }
    }
  };
  place(front, [0, 1, 2]);
  place(back, [2, 1, 0]);
  return units;
}

export function describeTeam(board: BoardUnit[], who: string): string {
  if (board.length === 0) return `${who} has no units.`;
  const traits = activeTraits(board).filter((t) => t.count >= 2).sort((a, b) => b.count - a.count);
  const traitText = traits.length
    ? traits.slice(0, 3).map((t) => `${t.count} ${t.trait}${t.count > 1 ? 's' : ''}`).join(' and ')
    : `${board.length} unrelated units`;
  const front = board.filter((u) => u.row === 0).length;
  const back = board.filter((u) => u.row === 2).length;
  const starred = board.filter((u) => u.stars >= 2).length;
  let formation = front >= back ? 'Their frontline is strong' : 'Their frontline is thin';
  formation += back >= 2 ? ', with a protected backline.' : ', and their backline is vulnerable.';
  const stars = starred ? ` ${starred} of their units ${starred === 1 ? "is" : "are"} upgraded.` : '';
  return `${who} is running ${traitText}. ${formation}${stars}`;
}
