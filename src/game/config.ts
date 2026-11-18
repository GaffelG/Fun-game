// All balance numbers live here so they are easy to tweak.

export const BOARD_ROWS = ['A', 'B', 'C'] as const; // A = front line, C = back line
export const BOARD_COLS = 4;
export const BENCH_SIZE = 8;
export const SHOP_SIZE = 5;

export const MAX_LEVEL = 9;
/** Max units on board per level (index = level). */
export const UNITS_PER_LEVEL = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** XP needed to go from level N to N+1 (index = current level). */
export const XP_TO_NEXT = [0, 2, 4, 6, 10, 20, 36, 56, 80, 0];

export const XP_BUY_COST = 4;
export const XP_BUY_AMOUNT = 4;
export const XP_PER_ROUND = 2;
export const REFRESH_COST = 2;
export const START_GOLD = 4;
export const BASE_INCOME = 5;
export const MAX_INTEREST = 5;
export const PLAYER_START_HP = 100;
export const PREP_SECONDS = 60;

/** Shop odds in percent for unit cost 1..5 at each level (index = level). */
export const SHOP_ODDS: number[][] = [
  [],
  [100, 0, 0, 0, 0],
  [100, 0, 0, 0, 0],
  [75, 25, 0, 0, 0],
  [55, 30, 15, 0, 0],
  [45, 33, 20, 2, 0],
  [30, 40, 25, 5, 0],
  [19, 30, 35, 15, 1],
  [16, 20, 35, 25, 4],
  [10, 15, 30, 30, 15],
];

export type Trait = 'Warrior' | 'Mage' | 'Ranger' | 'Guardian' | 'Assassin' | 'Fire' | 'Frost' | 'Storm';

export interface UnitDef {
  id: string;
  name: string;
  cost: number;
  traits: Trait[];
  hp: number;
  attack: number;
  /** attacks per second */
  attackSpeed: number;
  armor: number;
  range: number; // 1 = melee
  magic: boolean; // basic attacks deal magic damage
  ability: { name: string; description: string; mana: number; power: number; kind: 'nuke' | 'aoe' | 'heal' | 'shield' | 'stun';
    /** deals physical damage (armor applies) instead of magic */
    physical?: boolean;
    /** stun duration in seconds for 'stun' abilities */
    stunSeconds?: number;
    /** caster also gains a shield of this size */
    selfShield?: number;
  };
}

export const UNITS: UnitDef[] = [
  { id: 'squire', name: 'Squire', cost: 1, traits: ['Warrior', 'Storm'], hp: 600, attack: 50, attackSpeed: 0.7, armor: 25, range: 1, magic: false,
    ability: { name: 'Shield Bash', description: 'Stuns the target for one second.', mana: 60, power: 80, kind: 'stun', stunSeconds: 1 } },
  { id: 'ember', name: 'Ember Mage', cost: 1, traits: ['Mage', 'Fire'], hp: 450, attack: 40, attackSpeed: 0.6, armor: 10, range: 3, magic: true,
    ability: { name: 'Fireball', description: 'Hurls a fireball for heavy magic damage.', mana: 50, power: 200, kind: 'nuke' } },
  { id: 'scout', name: 'Frost Scout', cost: 1, traits: ['Ranger', 'Frost'], hp: 480, attack: 55, attackSpeed: 0.75, armor: 15, range: 3, magic: false,
    ability: { name: 'Ice Arrow', description: 'Fires an arrow that deals bonus physical damage.', mana: 60, power: 150, kind: 'nuke', physical: true } },
  { id: 'stonewall', name: 'Stonewall', cost: 1, traits: ['Guardian'], hp: 750, attack: 40, attackSpeed: 0.55, armor: 40, range: 1, magic: false,
    ability: { name: 'Fortify', description: 'Gains a large shield.', mana: 70, power: 250, kind: 'shield' } },
  { id: 'knife', name: 'Shadow Knife', cost: 2, traits: ['Assassin', 'Storm'], hp: 500, attack: 70, attackSpeed: 0.85, armor: 15, range: 1, magic: false,
    ability: { name: 'Backstab', description: 'Strikes for massive physical damage.', mana: 50, power: 250, kind: 'nuke', physical: true } },
  { id: 'frostguard', name: 'Frost Guard', cost: 2, traits: ['Guardian', 'Frost'], hp: 800, attack: 45, attackSpeed: 0.6, armor: 45, range: 1, magic: false,
    ability: { name: 'Frozen Wall', description: 'Stuns the target for one and a half seconds and shields itself.', mana: 80, power: 120, kind: 'stun', stunSeconds: 1.5, selfShield: 200 } },
  { id: 'pyro', name: 'Pyromancer', cost: 2, traits: ['Mage', 'Fire'], hp: 520, attack: 45, attackSpeed: 0.65, armor: 15, range: 3, magic: true,
    ability: { name: 'Flame Wave', description: 'Burns all enemies for magic damage.', mana: 80, power: 120, kind: 'aoe' } },
  { id: 'berserker', name: 'Berserker', cost: 3, traits: ['Warrior', 'Fire'], hp: 800, attack: 75, attackSpeed: 0.8, armor: 30, range: 1, magic: false,
    ability: { name: 'Rampage', description: 'Cleaves all enemies for physical damage.', mana: 70, power: 150, kind: 'aoe', physical: true } },
  { id: 'storm', name: 'Storm Archer', cost: 3, traits: ['Ranger', 'Storm'], hp: 600, attack: 75, attackSpeed: 0.85, armor: 20, range: 4, magic: false,
    ability: { name: 'Chain Lightning', description: 'Lightning hits every enemy.', mana: 80, power: 130, kind: 'aoe' } },
  { id: 'cleric', name: 'Frost Cleric', cost: 3, traits: ['Mage', 'Frost'], hp: 620, attack: 40, attackSpeed: 0.6, armor: 20, range: 3, magic: true,
    ability: { name: 'Healing Snow', description: 'Heals the weakest ally.', mana: 70, power: 300, kind: 'heal' } },
  { id: 'warlord', name: 'Warlord', cost: 4, traits: ['Warrior', 'Guardian'], hp: 1100, attack: 85, attackSpeed: 0.75, armor: 50, range: 1, magic: false,
    ability: { name: 'War Cry', description: 'Shields itself and stuns its target for two seconds.', mana: 90, power: 200, kind: 'stun', stunSeconds: 2, selfShield: 300 } },
  { id: 'phantom', name: 'Phantom', cost: 4, traits: ['Assassin', 'Frost'], hp: 750, attack: 100, attackSpeed: 0.9, armor: 25, range: 1, magic: false,
    ability: { name: 'Death Mark', description: 'Executes the target for huge physical damage.', mana: 60, power: 450, kind: 'nuke', physical: true } },
  { id: 'archmage', name: 'Archmage', cost: 5, traits: ['Mage', 'Storm'], hp: 900, attack: 60, attackSpeed: 0.7, armor: 30, range: 4, magic: true,
    ability: { name: 'Meteor Storm', description: 'Rains meteors on all enemies.', mana: 100, power: 350, kind: 'aoe' } },
  { id: 'dragon', name: 'Fire Dragon', cost: 5, traits: ['Warrior', 'Fire'], hp: 1500, attack: 110, attackSpeed: 0.75, armor: 50, range: 2, magic: true,
    ability: { name: 'Dragon Breath', description: 'Breathes fire on every enemy.', mana: 90, power: 300, kind: 'aoe' } },
];

export const UNIT_BY_ID: Record<string, UnitDef> = Object.fromEntries(UNITS.map((u) => [u.id, u]));

/** How many copies of each cost tier exist in the shared pool. */
export const POOL_SIZE = [0, 22, 18, 14, 10, 8];

export interface TraitDef {
  name: Trait;
  thresholds: number[];
  description: string;
}
/** Synergy bonuses. Effect is applied in battle.ts by trait name and tier (1-based). */
export const TRAITS: TraitDef[] = [
  { name: 'Warrior', thresholds: [2, 4], description: 'Warriors gain bonus attack damage.' },
  { name: 'Mage', thresholds: [2, 4], description: 'Mages gain ability power.' },
  { name: 'Ranger', thresholds: [2], description: 'Rangers attack faster.' },
  { name: 'Guardian', thresholds: [2, 4], description: 'All allies gain armor.' },
  { name: 'Assassin', thresholds: [2], description: 'Assassins deal more damage.' },
  { name: 'Fire', thresholds: [2, 4], description: 'Fire units gain attack speed.' },
  { name: 'Frost', thresholds: [2, 4], description: 'Frost units gain health.' },
  { name: 'Storm', thresholds: [2, 3], description: 'Storm units start with mana.' },
];

export const STAR_MULT = [0, 1, 1.8, 3.2];
