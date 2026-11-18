import * as C from './config';
import { BoardUnit, BattleResult, activeTraits, simulateBattle } from './battle';
import { Opponent, buildOpponentBoard, createOpponents, describeTeam } from './opponents';

export type Priority = 'high' | 'normal' | 'low';
export interface Say { text: string; priority: Priority }

export interface OwnedUnit { uid: number; defId: string; stars: number; }
export type Phase = 'prep' | 'battle' | 'gameover';

const STAR_WORD = ['', 'one star', 'two stars', 'three stars'];
export const ordinal = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);

export function cellName(row: number, col: number) { return `${C.BOARD_ROWS[row]}${col + 1}`; }

export class Game {
  gold = C.START_GOLD;
  level = 1;
  xp = 0;
  hp = C.PLAYER_START_HP;
  round = 1;
  phase: Phase = 'prep';
  shop: (string | null)[] = [];
  bench: (OwnedUnit | null)[] = Array(C.BENCH_SIZE).fill(null);
  board: (OwnedUnit & { row: number; col: number })[] = [];
  opponents: Opponent[] = createOpponents(4);
  opponentIndex = 0;
  streak = 0; // positive = win streak, negative = loss streak
  pool: Record<string, number> = Object.fromEntries(C.UNITS.map((u) => [u.id, C.POOL_SIZE[u.cost]]));
  lastBattle: BattleResult | null = null;
  lastBattleSummary = '';
  private nextUid = 1;

  constructor() {
    this.rollShop();
    this.prepareOpponent();
  }

  get opponent() { return this.opponents[this.opponentIndex]; }
  get maxUnits() { return C.UNITS_PER_LEVEL[this.level]; }
  get xpNeeded() { return C.XP_TO_NEXT[this.level]; }

  private prepareOpponent() {
    const alive = this.opponents.filter((o) => o.hp > 0);
    if (alive.length === 0) return;
    // rotate through living opponents
    do { this.opponentIndex = (this.opponentIndex + 1) % this.opponents.length; } while (this.opponent.hp <= 0);
    this.opponent.board = buildOpponentBoard(this.opponent, this.round);
  }

  // ---------- Shop ----------
  private rollShop() {
    for (const id of this.shop) if (id) this.pool[id]++;
    const odds = C.SHOP_ODDS[this.level];
    this.shop = Array.from({ length: C.SHOP_SIZE }, () => {
      let r = Math.random() * 100, cost = 1;
      for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) { cost = i + 1; break; } }
      const options = C.UNITS.filter((u) => u.cost === cost && this.pool[u.id] > 0);
      const pick = options[Math.floor(Math.random() * options.length)] ?? C.UNITS[0];
      this.pool[pick.id]--;
      return pick.id;
    });
  }

  describeShop(prefix = ''): Say {
    const parts = this.shop.map((id, i) => {
      if (!id) return `Slot ${ordinal(i + 1)}: empty.`;
      const d = C.UNIT_BY_ID[id];
      const owned = this.countCopies(id);
      const ownText = owned ? ` You own ${ordinal(owned)}.` : '';
      return `Slot ${ordinal(i + 1)}: ${d.name}, ${d.cost} gold.${ownText}`;
    });
    return { text: `${prefix}${parts.join(' ')} You have ${this.gold} gold.`, priority: 'high' };
  }

  describeSlot(slot: number): Say {
    const id = this.shop[slot - 1];
    if (!id) return { text: `Slot ${ordinal(slot)} is empty.`, priority: 'high' };
    return this.describeUnit(id, `Slot ${ordinal(slot)}: `);
  }

  describeUnit(id: string, prefix = ''): Say {
    const d = C.UNIT_BY_ID[id];
    return {
      text: `${prefix}${d.name}. Costs ${d.cost} gold. Traits: ${d.traits.join(' and ')}. ${d.range > 1 ? 'Ranged' : 'Melee'}. Ability: ${d.ability.name}. ${d.ability.description}`,
      priority: 'high',
    };
  }

  refresh(): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    if (this.gold < C.REFRESH_COST) return { text: `Not enough gold to refresh. You have ${this.gold}.`, priority: 'high' };
    this.gold -= C.REFRESH_COST;
    this.rollShop();
    return this.describeShop('Shop refreshed. ');
  }

  private countCopies(id: string) {
    return [...this.bench, ...this.board].filter((u) => u && u.defId === id).length;
  }

  buy(slot: number): Say[] {
    if (this.phase !== 'prep') return [this.notInPrep()];
    if (slot < 1 || slot > C.SHOP_SIZE) return [{ text: `There is no slot ${slot}. Choose one to five.`, priority: 'high' }];
    const id = this.shop[slot - 1];
    if (!id) return [{ text: `Slot ${ordinal(slot)} is empty.`, priority: 'high' }];
    const d = C.UNIT_BY_ID[id];
    if (this.gold < d.cost) return [{ text: `${d.name} costs ${d.cost} gold. You only have ${this.gold}.`, priority: 'high' }];
    const benchIdx = this.bench.findIndex((b) => b === null);
    // Allow buying with a full bench only if it completes an upgrade
    const wouldCombine = [...this.bench, ...this.board].filter((u) => u && u.defId === id && u.stars === 1).length >= 2;
    if (benchIdx < 0 && !wouldCombine) return [{ text: 'Your bench is full. Sell a unit first.', priority: 'high' }];

    this.gold -= d.cost;
    this.shop[slot - 1] = null;
    const unit: OwnedUnit = { uid: this.nextUid++, defId: id, stars: 1 };
    const out: Say[] = [];
    // Auto-place on the board if there is room, otherwise bench
    const placedCell = this.board.length < this.maxUnits && !wouldCombine ? this.firstFreeCell(d.range > 1) : null;
    if (placedCell) {
      this.board.push({ ...unit, row: placedCell[0], col: placedCell[1] });
      out.push({ text: `You bought ${d.name}. Placed in ${cellName(placedCell[0], placedCell[1])}. ${this.gold} gold left.`, priority: 'high' });
    } else {
      if (benchIdx >= 0) this.bench[benchIdx] = unit;
      else this.bench.push(unit); // temporary, removed by combine
      out.push({ text: `You bought ${d.name}. ${this.gold} gold left.`, priority: 'high' });
    }
    out.push(...this.combine());
    this.bench = this.bench.slice(0, C.BENCH_SIZE);
    return out;
  }

  sell(name: string): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    const found = this.findOwned(name, true);
    if (!found) return { text: `You don't have a ${name}.`, priority: 'high' };
    const d = C.UNIT_BY_ID[found.defId];
    const value = d.cost * (found.stars === 1 ? 1 : found.stars === 2 ? 3 : 9);
    this.gold += value;
    this.pool[found.defId] += found.stars === 1 ? 1 : found.stars === 2 ? 3 : 9;
    this.board = this.board.filter((u) => u.uid !== found.uid);
    this.bench = this.bench.map((u) => (u && u.uid === found.uid ? null : u));
    return { text: `Sold ${d.name} for ${value} gold. You have ${this.gold} gold.`, priority: 'high' };
  }

  private combine(): Say[] {
    const out: Say[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const stars of [1, 2]) {
        const groups: Record<string, OwnedUnit[]> = {};
        for (const u of [...this.board, ...this.bench]) if (u && u.stars === stars) (groups[u.defId] ??= []).push(u);
        for (const [id, list] of Object.entries(groups)) {
          if (list.length < 3) continue;
          const three = list.slice(0, 3);
          // Keep the one on the board if any
          const keeper = three.find((u) => this.board.some((b) => b.uid === u.uid)) ?? three[0];
          const remove = three.filter((u) => u !== keeper).map((u) => u.uid);
          this.board = this.board.filter((b) => !remove.includes(b.uid));
          this.bench = this.bench.map((b) => (b && remove.includes(b.uid) ? null : b));
          keeper.stars = stars + 1;
          const onBoard = this.board.find((b) => b.uid === keeper.uid);
          if (onBoard) onBoard.stars = stars + 1;
          const benchOne = this.bench.find((b) => b && b.uid === keeper.uid);
          if (benchOne) benchOne.stars = stars + 1;
          out.push({ text: `Your ${C.UNIT_BY_ID[id].name} has been upgraded to ${STAR_WORD[stars + 1]}!`, priority: 'high' });
          changed = true;
        }
      }
    }
    // compact bench overflow into nulls
    const extras = this.bench.slice(C.BENCH_SIZE).filter(Boolean) as OwnedUnit[];
    this.bench = this.bench.slice(0, C.BENCH_SIZE);
    for (const e of extras) { const i = this.bench.indexOf(null); if (i >= 0) this.bench[i] = e; }
    return out;
  }

  // ---------- XP ----------
  buyXp(): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    if (this.level >= C.MAX_LEVEL) return { text: 'You are already at max level.', priority: 'high' };
    if (this.gold < C.XP_BUY_COST) return { text: `Experience costs ${C.XP_BUY_COST} gold. You have ${this.gold}.`, priority: 'high' };
    this.gold -= C.XP_BUY_COST;
    const leveled = this.addXp(C.XP_BUY_AMOUNT);
    if (leveled) return leveled;
    return { text: `Bought experience. ${this.xp} of ${this.xpNeeded} XP to level ${this.level + 1}. ${this.gold} gold left.`, priority: 'high' };
  }

  levelUp(): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    if (this.level >= C.MAX_LEVEL) return { text: 'You are already at max level.', priority: 'high' };
    const needed = this.xpNeeded - this.xp;
    const buys = Math.ceil(needed / C.XP_BUY_AMOUNT);
    const cost = buys * C.XP_BUY_COST;
    if (this.gold < cost) return { text: `Leveling up needs ${cost} gold. You have ${this.gold}.`, priority: 'high' };
    this.gold -= cost;
    return this.addXp(buys * C.XP_BUY_AMOUNT)!;
  }

  private addXp(amount: number): Say | null {
    this.xp += amount;
    let leveled = false;
    while (this.level < C.MAX_LEVEL && this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      leveled = true;
    }
    if (this.level >= C.MAX_LEVEL) this.xp = 0;
    if (!leveled) return null;
    return { text: `Level up! You are now level ${this.level} and can field ${this.maxUnits} units. ${this.gold} gold left.`, priority: 'high' };
  }

  // ---------- Board ----------
  private firstFreeCell(ranged: boolean): [number, number] | null {
    const rows = ranged ? [2, 1, 0] : [0, 1, 2];
    for (const r of rows) for (const c of [1, 2, 0, 3]) if (!this.board.some((u) => u.row === r && u.col === c)) return [r, c];
    return null;
  }

  /** Find a unit by name or trait, e.g. "mage" or "ember mage". Prefers bench units when `preferBench`. */
  findOwned(query: string, preferBench = false): OwnedUnit | null {
    const q = query.toLowerCase().trim();
    const all: OwnedUnit[] = preferBench
      ? [...(this.bench.filter(Boolean) as OwnedUnit[]), ...this.board]
      : [...this.board, ...(this.bench.filter(Boolean) as OwnedUnit[])];
    const byName = all.find((u) => C.UNIT_BY_ID[u.defId].name.toLowerCase() === q)
      ?? all.find((u) => C.UNIT_BY_ID[u.defId].name.toLowerCase().includes(q) || q.includes(C.UNIT_BY_ID[u.defId].name.toLowerCase()));
    if (byName) return byName;
    return all.find((u) => C.UNIT_BY_ID[u.defId].traits.some((t) => q.includes(t.toLowerCase()))) ?? null;
  }

  place(query: string, row: number, col: number): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    // When placing, prefer a unit from the bench
    const unit = this.findOwned(query, true);
    if (!unit) return { text: `You don't have a ${query}.`, priority: 'high' };
    const name = C.UNIT_BY_ID[unit.defId].name;
    const cell = cellName(row, col);
    const onBoard = this.board.find((u) => u.uid === unit.uid);
    const occupant = this.board.find((u) => u.row === row && u.col === col);
    if (onBoard) {
      if (occupant && occupant.uid !== onBoard.uid) { occupant.row = onBoard.row; occupant.col = onBoard.col; }
      onBoard.row = row; onBoard.col = col;
      return { text: `Moved ${name} to ${cell}.${occupant && occupant.uid !== onBoard.uid ? ` Swapped with ${C.UNIT_BY_ID[occupant.defId].name}.` : ''}`, priority: 'high' };
    }
    // from bench
    const benchIdx = this.bench.findIndex((b) => b && b.uid === unit.uid);
    if (occupant) {
      this.board = this.board.filter((u) => u.uid !== occupant.uid);
      this.bench[benchIdx] = { uid: occupant.uid, defId: occupant.defId, stars: occupant.stars };
      this.board.push({ ...unit, row, col });
      return { text: `Placed ${name} in ${cell}. ${C.UNIT_BY_ID[occupant.defId].name} went to the bench.`, priority: 'high' };
    }
    if (this.board.length >= this.maxUnits) return { text: `Your board is full. Level ${this.level} allows ${this.maxUnits} units.`, priority: 'high' };
    this.bench[benchIdx] = null;
    this.board.push({ ...unit, row, col });
    return { text: `Placed ${name} in ${cell}.`, priority: 'high' };
  }

  bench_(query: string): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    const found = this.findOwned(query);
    const unit = found ? this.board.find((u) => u.uid === found.uid) : undefined;
    if (!unit) return { text: `No ${query} on your board.`, priority: 'high' };
    const i = this.bench.indexOf(null);
    if (i < 0) return { text: 'Your bench is full.', priority: 'high' };
    this.board = this.board.filter((u) => u.uid !== unit.uid);
    this.bench[i] = { uid: unit.uid, defId: unit.defId, stars: unit.stars };
    return { text: `${C.UNIT_BY_ID[unit.defId].name} moved to the bench.`, priority: 'high' };
  }

  describeTeam(): Say {
    if (this.board.length === 0 && this.bench.every((b) => !b)) return { text: 'You have no units yet.', priority: 'high' };
    const boardText = this.board.length
      ? this.board.map((u) => `${C.UNIT_BY_ID[u.defId].name}${u.stars > 1 ? ` ${STAR_WORD[u.stars]}` : ''} in ${cellName(u.row, u.col)}`).join(', ')
      : 'nothing';
    const benchUnits = this.bench.filter(Boolean) as OwnedUnit[];
    const benchText = benchUnits.length ? ` On the bench: ${benchUnits.map((u) => C.UNIT_BY_ID[u.defId].name).join(', ')}.` : '';
    const traits = activeTraits(this.board).filter((t) => t.tier > 0);
    const traitText = traits.length ? ` Active synergies: ${traits.map((t) => `${t.count} ${t.trait}`).join(', ')}.` : '';
    return { text: `On your board, ${this.board.length} of ${this.maxUnits}: ${boardText}.${benchText}${traitText}`, priority: 'high' };
  }

  describeStatus(): Say {
    return {
      text: `Round ${this.round}. You have ${this.gold} gold, ${this.hp} health, level ${this.level} with ${this.xp} of ${this.xpNeeded} XP.`,
      priority: 'high',
    };
  }

  scout(): Say {
    return { text: `${this.opponent.name}, with ${this.opponent.hp} health. ${describeTeam(this.opponent.board, 'This opponent')}`, priority: 'high' };
  }

  private notInPrep(): Say {
    return { text: this.phase === 'battle' ? 'Wait until the battle is over.' : 'The game is over. Say new game to play again.', priority: 'high' };
  }

  // ---------- Round flow ----------
  startBattle(): { result: BattleResult; opponentName: string } {
    this.phase = 'battle';
    const result = simulateBattle(this.board, this.opponent.board, this.opponent.name.split(' ').pop()!);
    this.lastBattle = result;
    return { result, opponentName: this.opponent.name };
  }

  /** Apply battle results and start next prep round. Returns announcements. */
  finishBattle(): Say[] {
    const r = this.lastBattle!;
    const out: Say[] = [];
    const op = this.opponent;
    const survivorsDmg = (side: 0 | 1) => r.survivors.filter((s) => s.side === side).reduce((a, s) => a + s.stars, 0);
    if (r.winner === 0) {
      const dmg = 2 + survivorsDmg(0) + Math.floor(this.round / 3);
      op.hp = Math.max(0, op.hp - dmg);
      this.streak = this.streak > 0 ? this.streak + 1 : 1;
      out.push({ text: `Victory! You dealt ${dmg} damage to ${op.name}.${op.hp === 0 ? ` ${op.name} has been eliminated!` : ''}`, priority: 'high' });
    } else if (r.winner === 1) {
      const dmg = 2 + survivorsDmg(1) + Math.floor(this.round / 3);
      this.hp = Math.max(0, this.hp - dmg);
      this.streak = this.streak < 0 ? this.streak - 1 : -1;
      out.push({ text: `Defeat. You lost ${dmg} health. ${this.hp} health remaining.`, priority: 'high' });
    } else {
      this.hp = Math.max(0, this.hp - 2);
      out.push({ text: `The battle timed out as a draw. You lost 2 health.`, priority: 'high' });
    }
    this.lastBattleSummary = out[0].text;

    // AI opponents also take some damage from each other off-screen
    for (const o of this.opponents) if (o !== op && o.hp > 0 && Math.random() < 0.5) o.hp = Math.max(0, o.hp - (2 + Math.floor(Math.random() * (this.round / 2 + 3))));

    if (this.hp <= 0) {
      this.phase = 'gameover';
      out.push({ text: `You have been eliminated in round ${this.round}. Game over. Say new game to play again.`, priority: 'high' });
      return out;
    }
    if (this.opponents.every((o) => o.hp <= 0)) {
      this.phase = 'gameover';
      out.push({ text: `All opponents defeated. You win the game! Say new game to play again.`, priority: 'high' });
      return out;
    }

    // Income
    const interest = Math.min(C.MAX_INTEREST, Math.floor(this.gold / 10));
    const streakBonus = Math.abs(this.streak) >= 5 ? 3 : Math.abs(this.streak) >= 3 ? 2 : Math.abs(this.streak) >= 2 ? 1 : 0;
    const winBonus = r.winner === 0 ? 1 : 0;
    const income = C.BASE_INCOME + interest + streakBonus + winBonus;
    this.gold += income;
    this.round++;
    const leveled = this.level < C.MAX_LEVEL ? this.addXp(C.XP_PER_ROUND) : null;
    this.phase = 'prep';
    this.rollShop();
    this.prepareOpponent();
    out.push({ text: `Round ${this.round}. You earned ${income} gold and now have ${this.gold}.`, priority: 'normal' });
    if (leveled) out.push(leveled);
    return out;
  }

  /** Opponents with HP > 0 for UI */
  get aliveOpponents() { return this.opponents.filter((o) => o.hp > 0).length; }
}
