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
  private lastPurchase: { uid: number; slot: number; defId: string; gold: number } | null = null;
  shopLocked = false;
  shopWasKept = false;
  stats = { wins: 0, losses: 0, upgrades: 0, startedAt: Date.now() };
  private announcedOut = new Set<string>();

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
    this.shop = Array.from({ length: C.SHOP_SIZE }, (): string | null => {
      let r = Math.random() * 100, cost = 1;
      for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r < 0) { cost = i + 1; break; } }
      // If the rolled tier is sold out, fall back to the nearest tier that still has stock.
      const tiers = [cost, ...[1, 2, 3, 4, 5].filter((c) => c !== cost).sort((a, b) => Math.abs(a - cost) - Math.abs(b - cost))];
      let options: C.UnitDef[] = [];
      for (const tc of tiers) {
        options = C.UNITS.filter((u) => u.cost === tc && this.pool[u.id] > 0);
        if (options.length) break;
      }
      if (!options.length) return null;
      const pick = options[Math.floor(Math.random() * options.length)];
      this.pool[pick.id]--;
      return pick.id;
    });
  }

  describeShop(prefix = ''): Say {
    const parts = this.shop.map((id, i) => {
      if (!id) return `Slot ${ordinal(i + 1)}: empty.`;
      const d = C.UNIT_BY_ID[id];
      return `Slot ${ordinal(i + 1)}: ${d.name}, ${d.cost} gold.${this.shopHint(id)}`;
    });
    const lock = this.shopLocked ? ' The shop is locked.' : '';
    return { text: `${prefix}${parts.join(' ')} You have ${this.gold} gold.${lock}`, priority: 'high' };
  }

  /** Short spoken hint about why a shop unit matters to you. */
  shopHint(id: string): string {
    const ones = [...this.board, ...this.bench].filter((u) => u && u.defId === id && u.stars === 1).length;
    const inShop = this.shop.filter((s) => s === id).length;
    if (ones >= 2) return ' Upgrades your unit!';
    if (ones === 1 && inShop >= 2) return ' Buy both to upgrade!';
    if (ones === 1) return ' Makes a pair.';
    const counts = new Map(activeTraits(this.board).map((t) => [t.trait, t.count]));
    for (const t of C.UNIT_BY_ID[id].traits) {
      const c = counts.get(t) ?? 0;
      const th = C.TRAITS.find((x) => x.name === t)!.thresholds.find((x) => x > c);
      if (c > 0 && th === c + 1) return ` Activates ${t}.`;
    }
    return '';
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
    // Remember the purchase so a misheard "buy" can be undone (only if it didn't trigger an upgrade).
    this.lastPurchase = wouldCombine ? null : { uid: unit.uid, slot: slot - 1, defId: id, gold: d.cost };
    const out: Say[] = [];
    // Auto-place on the board if there is room, otherwise bench
    const placedCell = this.board.length < this.maxUnits && !wouldCombine ? this.firstFreeCell(d.range > 1) : null;
    if (placedCell) {
      this.board.push({ ...unit, row: placedCell[0], col: placedCell[1] });
      out.push({ text: `You bought ${d.name}. Placed in ${cellName(placedCell[0], placedCell[1])}. ${this.board.length} of ${this.maxUnits} units on the board. ${this.gold} gold left.`, priority: 'high' });
    } else {
      if (benchIdx >= 0) this.bench[benchIdx] = unit;
      else this.bench.push(unit); // temporary, removed by combine
      const why = wouldCombine ? '' : ` Board is full, ${this.maxUnits} of ${this.maxUnits}, so it went to the bench.`;
      out.push({ text: `You bought ${d.name}.${why} ${this.gold} gold left.`, priority: 'high' });
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
          this.stats.upgrades++;
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
    if (benchIdx < 0) return { text: `Could not find ${name} on your bench.`, priority: 'high' };
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

  describeUnitLimit(): Say {
    const next = this.level < C.MAX_LEVEL ? ` Level ${this.level + 1} allows ${C.UNITS_PER_LEVEL[this.level + 1]}, and you need ${this.xpNeeded - this.xp} more XP.` : '';
    const free = this.maxUnits - this.board.length;
    const benchCount = this.bench.filter(Boolean).length;
    return { text: `At level ${this.level} you can field ${this.maxUnits} units. You have ${this.board.length} on the board${free > 0 ? `, so ${free} ${free === 1 ? 'spot is' : 'spots are'} free` : ', so the board is full'}. ${benchCount} on the bench.${next}`, priority: 'high' };
  }

  describeBench(): Say {
    const units = this.bench.filter(Boolean) as OwnedUnit[];
    if (!units.length) return { text: 'Your bench is empty.', priority: 'high' };
    return { text: `On your bench, ${units.length} of ${C.BENCH_SIZE}: ${units.map((u) => `${C.UNIT_BY_ID[u.defId].name}${u.stars > 1 ? ` ${STAR_WORD[u.stars]}` : ''}`).join(', ')}.`, priority: 'high' };
  }

  describeSynergies(): Say {
    const traits = activeTraits(this.board);
    if (!traits.length) return { text: 'No units on the board, so no synergies.', priority: 'high' };
    const parts = traits.sort((a, b) => b.count - a.count).map((t) => {
      const def = C.TRAITS.find((d) => d.name === t.trait)!;
      const next = def.thresholds.find((th) => th > t.count);
      const state = t.tier > 0 ? 'active' : 'not active';
      return `${t.count} ${t.trait}, ${state}${next ? `, ${next - t.count} more for the next bonus` : ''}`;
    });
    return { text: `Synergies: ${parts.join('. ')}.`, priority: 'high' };
  }

  describeAffordable(): Say {
    const slots = this.shop.map((id, i) => ({ id, i })).filter((x) => x.id && C.UNIT_BY_ID[x.id].cost <= this.gold);
    if (!slots.length) return { text: `With ${this.gold} gold you can't afford anything in the shop.`, priority: 'high' };
    return { text: `With ${this.gold} gold you can afford: ${slots.map((x) => `slot ${ordinal(x.i + 1)}, ${C.UNIT_BY_ID[x.id!].name}`).join('; ')}.`, priority: 'high' };
  }

  describeUpgrades(): Say {
    const counts: Record<string, number> = {};
    for (const u of [...this.board, ...this.bench]) if (u) { const k = `${u.defId}|${u.stars}`; counts[k] = (counts[k] ?? 0) + 1; }
    const close = Object.entries(counts).filter(([k, n]) => n === 2 && !k.endsWith('|3'));
    if (!close.length) return { text: 'You have no pairs yet. Three copies of a unit combine into a stronger one.', priority: 'high' };
    const parts = close.map(([k]) => {
      const [id, stars] = k.split('|');
      const inShop = this.shop.findIndex((s) => s === id);
      return `two ${C.UNIT_BY_ID[id].name}${stars === '2' ? ' two stars' : 's'}${inShop >= 0 && stars === '1' ? `, and one is in slot ${ordinal(inShop + 1)}` : ''}`;
    });
    return { text: `One more copy upgrades: ${parts.join('; ')}.`, priority: 'high' };
  }

  describeXp(): Say {
    if (this.level >= C.MAX_LEVEL) return { text: 'You are at max level.', priority: 'high' };
    const need = this.xpNeeded - this.xp;
    return { text: `Level ${this.level}, ${this.xp} of ${this.xpNeeded} XP. ${need} more XP to level ${this.level + 1}, which costs ${Math.ceil(need / C.XP_BUY_AMOUNT) * C.XP_BUY_COST} gold.`, priority: 'high' };
  }

  describeStandings(): Say {
    const list = [...this.opponents].sort((a, b) => b.hp - a.hp).map((o) => (o.hp > 0 ? `${o.name} ${o.hp}` : `${o.name} eliminated`));
    return { text: `You have ${this.hp} health. ${list.join(', ')}.`, priority: 'high' };
  }

  /** Move bench units onto empty board spots until the board is full. */
  fillBoard(): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    const placed: string[] = [];
    const bench = (this.bench.filter(Boolean) as OwnedUnit[]).sort((a, b) => b.stars - a.stars || C.UNIT_BY_ID[b.defId].cost - C.UNIT_BY_ID[a.defId].cost);
    for (const u of bench) {
      if (this.board.length >= this.maxUnits) break;
      const cell = this.firstFreeCell(C.UNIT_BY_ID[u.defId].range > 1);
      if (!cell) break;
      this.bench = this.bench.map((b) => (b && b.uid === u.uid ? null : b));
      this.board.push({ ...u, row: cell[0], col: cell[1] });
      placed.push(`${C.UNIT_BY_ID[u.defId].name} in ${cellName(cell[0], cell[1])}`);
    }
    if (!placed.length) return { text: this.board.length >= this.maxUnits ? `Your board is already full with ${this.maxUnits} units.` : 'Your bench is empty.', priority: 'high' };
    return { text: `Placed ${placed.join(', ')}. ${this.board.length} of ${this.maxUnits} units on the board.`, priority: 'high' };
  }

  buyAll(query: string): Say[] {
    const q = query.toLowerCase();
    const slots = this.shop.map((id, i) => ({ id, i })).filter((x) => x.id && (C.UNIT_BY_ID[x.id].name.toLowerCase() === q || C.UNIT_BY_ID[x.id].traits.some((t) => t.toLowerCase() === q)));
    if (!slots.length) return [{ text: `There is no ${query} in the shop.`, priority: 'high' }];
    return slots.flatMap((x) => this.buy(x.i + 1));
  }

  undo(): Say {
    if (this.phase !== 'prep') return this.notInPrep();
    const p = this.lastPurchase;
    if (!p) return { text: 'There is no purchase to undo.', priority: 'high' };
    const exists = [...this.board, ...this.bench].some((u) => u && u.uid === p.uid);
    if (!exists || this.shop[p.slot] !== null) { this.lastPurchase = null; return { text: 'That purchase can no longer be undone.', priority: 'high' }; }
    this.board = this.board.filter((u) => u.uid !== p.uid);
    this.bench = this.bench.map((u) => (u && u.uid === p.uid ? null : u));
    this.shop[p.slot] = p.defId;
    this.gold += p.gold;
    this.lastPurchase = null;
    return { text: `Undone. ${C.UNIT_BY_ID[p.defId].name} is back in slot ${ordinal(p.slot + 1)}, and you have ${this.gold} gold.`, priority: 'high' };
  }

  setLock(locked: boolean): Say {
    this.shopLocked = locked;
    return { text: locked ? 'Shop locked. It will stay the same next round.' : 'Shop unlocked.', priority: 'high' };
  }

  summary(): string {
    const mins = Math.max(1, Math.round((Date.now() - this.stats.startedAt) / 60000));
    const best = [...this.board].sort((a, b) => b.stars * 10 + C.UNIT_BY_ID[b.defId].cost - (a.stars * 10 + C.UNIT_BY_ID[a.defId].cost))[0];
    const bestText = best ? ` Your strongest unit was ${C.UNIT_BY_ID[best.defId].name} with ${STAR_WORD[best.stars]}.` : '';
    return `You won ${this.stats.wins} battles and lost ${this.stats.losses}, made ${this.stats.upgrades} upgrades, and played for ${mins} minutes.${bestText}`;
  }

  /** Coach: the single most useful thing to do right now. */
  advice(): Say {
    const tips: string[] = [];
    if (this.phase !== 'prep') return { text: 'Wait for the battle to finish.', priority: 'high' };
    const benchUnits = this.bench.filter(Boolean) as OwnedUnit[];
    // 1. Upgrades in the shop
    this.shop.forEach((id, i) => {
      if (!id || tips.length) return;
      const hint = this.shopHint(id);
      if (hint.includes('pgrade') && this.gold >= C.UNIT_BY_ID[id].cost) tips.push(`Buy slot ${ordinal(i + 1)}, ${C.UNIT_BY_ID[id].name}.${hint}`);
    });
    // 2. Empty board spots
    if (!tips.length && this.board.length < this.maxUnits) {
      if (benchUnits.length) tips.push(`You have ${this.maxUnits - this.board.length} empty board spots. Say fill the board.`);
      else {
        const affordable = this.shop.map((id, i) => ({ id, i })).filter((x) => x.id && C.UNIT_BY_ID[x.id].cost <= this.gold);
        if (affordable.length) {
          const pick = affordable.find((x) => this.shopHint(x.id!)) ?? affordable.sort((a, b) => C.UNIT_BY_ID[b.id!].cost - C.UNIT_BY_ID[a.id!].cost)[0];
          tips.push(`Your board has an empty spot. Buy slot ${ordinal(pick.i + 1)}, ${C.UNIT_BY_ID[pick.id!].name}.${this.shopHint(pick.id!)}`);
        }
      }
    }
    // 3. Synergy one away
    if (!tips.length) {
      const pick = this.shop.map((id, i) => ({ id, i })).find((x) => x.id && this.shopHint(x.id).includes('Activates') && C.UNIT_BY_ID[x.id].cost <= this.gold);
      if (pick) tips.push(`Buy slot ${ordinal(pick.i + 1)}, ${C.UNIT_BY_ID[pick.id!].name}.${this.shopHint(pick.id!)}`);
    }
    // 4. Bench full of singles
    if (!tips.length && benchUnits.length >= C.BENCH_SIZE - 1) {
      const junk = benchUnits.find((u) => u.stars === 1 && this.countCopies(u.defId) === 1);
      if (junk) tips.push(`Your bench is almost full. Consider selling ${C.UNIT_BY_ID[junk.defId].name}.`);
    }
    // 5. Economy / level
    if (!tips.length) {
      const lowHp = this.hp <= 40;
      const need = this.xpNeeded - this.xp;
      const levelCost = Math.ceil(need / C.XP_BUY_AMOUNT) * C.XP_BUY_COST;
      if (this.level < C.MAX_LEVEL && (lowHp || this.gold - levelCost >= 20) && this.gold >= levelCost) tips.push(`Level up for ${levelCost} gold to field ${C.UNITS_PER_LEVEL[this.level + 1]} units.`);
      else if (lowHp && this.gold >= C.REFRESH_COST + 2) tips.push('Your health is low. Spend gold: refresh the shop and look for upgrades.');
      else if (this.gold < 50) tips.push(`Save your gold. Every 10 gold earns 1 extra per round, up to ${C.MAX_INTEREST}. Say fight when ready.`);
      else tips.push('You have lots of gold. Refresh the shop to find upgrades, or level up.');
    }
    return { text: tips[0], priority: 'high' };
  }

  describeStatus(): Say {
    return {
      text: `Round ${this.round}. You have ${this.gold} gold, ${this.hp} health, level ${this.level} with ${this.xp} of ${this.xpNeeded} XP. ${this.board.length} of ${this.maxUnits} units on the board.`,
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
    if (this.phase !== 'battle' || !this.lastBattle) return [];
    const r = this.lastBattle;
    this.lastBattle = null;
    const out: Say[] = [];
    const op = this.opponent;
    const survivorsDmg = (side: 0 | 1) => r.survivors.filter((s) => s.side === side).reduce((a, s) => a + s.stars, 0);
    if (r.winner === 0) {
      const dmg = 2 + survivorsDmg(0) + Math.floor(this.round / 3);
      op.hp = Math.max(0, op.hp - dmg);
      this.streak = this.streak > 0 ? this.streak + 1 : 1;
      this.stats.wins++;
      out.push({ text: `Victory! You dealt ${dmg} damage to ${op.name}.${op.hp === 0 ? ` ${op.name} has been eliminated!` : ''}`, priority: 'high' });
    } else if (r.winner === 1) {
      const dmg = 2 + survivorsDmg(1) + Math.floor(this.round / 3);
      this.hp = Math.max(0, this.hp - dmg);
      this.streak = this.streak < 0 ? this.streak - 1 : -1;
      this.stats.losses++;
      out.push({ text: `Defeat. You lost ${dmg} health. ${this.hp} health remaining.`, priority: 'high' });
    } else {
      this.hp = Math.max(0, this.hp - 2);
      out.push({ text: `The battle timed out as a draw. You lost 2 health.`, priority: 'high' });
    }
    this.lastBattleSummary = out[0].text;

    // AI opponents also take some damage from each other off-screen
    // The other AI opponents fight each other: pair them up, each loser takes damage.
    const others = this.opponents.filter((o) => o !== op && o.hp > 0).sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < others.length; i += 2) {
      const loser = Math.random() < 0.5 ? others[i] : others[i + 1];
      loser.hp = Math.max(0, loser.hp - Math.round(C.AI.fightDamageBase + this.round * C.AI.fightDamagePerRound + Math.random() * 4));
    }
    const newlyOut = this.opponents.filter((o) => o !== op && o.hp === 0 && !this.announcedOut.has(o.name));
    for (const o of newlyOut) { this.announcedOut.add(o.name); out.push({ text: `${o.name} has been eliminated by another opponent.`, priority: 'normal' }); }

    if (this.hp <= 0) {
      this.phase = 'gameover';
      const place = this.opponents.filter((o) => o.hp > 0).length + 1;
      out.push({ text: `You have been eliminated in round ${this.round}, finishing in ${place === 2 ? 'second' : place === 3 ? 'third' : place === 4 ? 'fourth' : 'fifth'} place. ${this.summary()} Say new game to play again.`, priority: 'high' });
      return out;
    }
    if (this.opponents.every((o) => o.hp <= 0)) {
      this.phase = 'gameover';
      out.push({ text: `All opponents defeated. You win the game! ${this.summary()} Say new game to play again.`, priority: 'high' });
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
    this.lastPurchase = null;
    this.shopWasKept = this.shopLocked;
    if (this.shopLocked) this.shopLocked = false; // a lock holds for one round
    else this.rollShop();
    this.prepareOpponent();
    const nextInterest = Math.floor(this.gold / 10) + 1;
    const tip = nextInterest <= C.MAX_INTEREST && this.gold % 10 >= 7 ? ` Save ${nextInterest * 10 - this.gold} more for extra interest.` : '';
    out.push({ text: `Round ${this.round}. You earned ${income} gold and now have ${this.gold}.${tip}`, priority: 'normal' });
    if (leveled) out.push(leveled);
    return out;
  }

  /** Opponents with HP > 0 for UI */
  get aliveOpponents() { return this.opponents.filter((o) => o.hp > 0).length; }
}
