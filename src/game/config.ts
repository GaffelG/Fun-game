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

/** Names are short single words so they are easy to say and easy for speech recognition to hear. */
export const UNITS: UnitDef[] = [
  // ----- 1 gold -----
  { id: 'knight', name: 'Knight', cost: 1, traits: ['Warrior', 'Storm'], hp: 600, attack: 50, attackSpeed: 0.7, armor: 25, range: 1, magic: false,
    ability: { name: 'Shield Bash', description: 'Stuns the target for one second.', mana: 60, power: 80, kind: 'stun', stunSeconds: 1 } },
  { id: 'lava', name: 'Lava', cost: 1, traits: ['Mage', 'Fire'], hp: 450, attack: 40, attackSpeed: 0.6, armor: 10, range: 3, magic: true,
    ability: { name: 'Fireball', description: 'Hurls a fireball for heavy magic damage.', mana: 50, power: 200, kind: 'nuke' } },
  { id: 'archer', name: 'Archer', cost: 1, traits: ['Ranger', 'Frost'], hp: 480, attack: 55, attackSpeed: 0.75, armor: 15, range: 3, magic: false,
    ability: { name: 'Ice Arrow', description: 'Fires an arrow for bonus physical damage.', mana: 60, power: 150, kind: 'nuke', physical: true } },
  { id: 'rock', name: 'Rock', cost: 1, traits: ['Guardian'], hp: 750, attack: 40, attackSpeed: 0.55, armor: 40, range: 1, magic: false,
    ability: { name: 'Fortify', description: 'Gains a large shield.', mana: 70, power: 250, kind: 'shield' } },
  { id: 'bandit', name: 'Bandit', cost: 1, traits: ['Assassin', 'Fire'], hp: 480, attack: 60, attackSpeed: 0.8, armor: 15, range: 1, magic: false,
    ability: { name: 'Cheap Shot', description: 'Leaps to the back line and stabs for physical damage.', mana: 50, power: 170, kind: 'nuke', physical: true } },
  { id: 'pixie', name: 'Pixie', cost: 1, traits: ['Mage', 'Frost'], hp: 420, attack: 35, attackSpeed: 0.65, armor: 10, range: 3, magic: true,
    ability: { name: 'Sparkle', description: 'Heals the weakest ally.', mana: 60, power: 200, kind: 'heal' } },
  // ----- 2 gold -----
  { id: 'ninja', name: 'Ninja', cost: 2, traits: ['Assassin', 'Storm'], hp: 500, attack: 70, attackSpeed: 0.85, armor: 15, range: 1, magic: false,
    ability: { name: 'Backstab', description: 'Strikes for massive physical damage.', mana: 50, power: 250, kind: 'nuke', physical: true } },
  { id: 'yeti', name: 'Yeti', cost: 2, traits: ['Guardian', 'Frost'], hp: 800, attack: 45, attackSpeed: 0.6, armor: 45, range: 1, magic: false,
    ability: { name: 'Frozen Wall', description: 'Stuns the target for one and a half seconds and shields itself.', mana: 80, power: 120, kind: 'stun', stunSeconds: 1.5, selfShield: 200 } },
  { id: 'shaman', name: 'Shaman', cost: 2, traits: ['Mage', 'Storm'], hp: 520, attack: 45, attackSpeed: 0.65, armor: 15, range: 3, magic: true,
    ability: { name: 'Lightning', description: 'Strikes all enemies with lightning.', mana: 80, power: 110, kind: 'aoe' } },
  { id: 'hunter', name: 'Hunter', cost: 2, traits: ['Ranger', 'Fire'], hp: 550, attack: 65, attackSpeed: 0.8, armor: 15, range: 3, magic: false,
    ability: { name: 'Fire Arrow', description: 'Fires a burning arrow for physical damage.', mana: 60, power: 200, kind: 'nuke', physical: true } },
  { id: 'viking', name: 'Viking', cost: 2, traits: ['Warrior', 'Frost'], hp: 700, attack: 65, attackSpeed: 0.75, armor: 30, range: 1, magic: false,
    ability: { name: 'Axe Throw', description: 'Throws an axe that stuns for one second.', mana: 70, power: 150, kind: 'stun', physical: true, stunSeconds: 1 } },
  // ----- 3 gold -----
  { id: 'tiger', name: 'Tiger', cost: 3, traits: ['Warrior', 'Fire'], hp: 800, attack: 75, attackSpeed: 0.8, armor: 30, range: 1, magic: false,
    ability: { name: 'Rampage', description: 'Cleaves all enemies for physical damage.', mana: 70, power: 150, kind: 'aoe', physical: true } },
  { id: 'falcon', name: 'Falcon', cost: 3, traits: ['Ranger', 'Storm'], hp: 600, attack: 75, attackSpeed: 0.85, armor: 20, range: 4, magic: false,
    ability: { name: 'Chain Lightning', description: 'Lightning hits every enemy.', mana: 80, power: 130, kind: 'aoe' } },
  { id: 'healer', name: 'Healer', cost: 3, traits: ['Mage', 'Frost'], hp: 620, attack: 40, attackSpeed: 0.6, armor: 20, range: 3, magic: true,
    ability: { name: 'Healing Snow', description: 'Heals the weakest ally.', mana: 70, power: 300, kind: 'heal' } },
  { id: 'giant', name: 'Giant', cost: 3, traits: ['Guardian', 'Storm'], hp: 1000, attack: 55, attackSpeed: 0.55, armor: 45, range: 1, magic: false,
    ability: { name: 'Stomp', description: 'Shakes the ground, damaging all enemies.', mana: 90, power: 120, kind: 'aoe' } },
  { id: 'monk', name: 'Monk', cost: 3, traits: ['Guardian', 'Fire'], hp: 850, attack: 60, attackSpeed: 0.75, armor: 40, range: 1, magic: false,
    ability: { name: 'Inner Fire', description: 'Shields itself and stuns the target for one second.', mana: 70, power: 120, kind: 'stun', stunSeconds: 1, selfShield: 250 } },
  // ----- 4 gold -----
  { id: 'general', name: 'General', cost: 4, traits: ['Warrior', 'Guardian'], hp: 1000, attack: 80, attackSpeed: 0.75, armor: 50, range: 1, magic: false,
    ability: { name: 'War Cry', description: 'Shields itself and stuns its target for one and a half seconds.', mana: 90, power: 200, kind: 'stun', stunSeconds: 1.5, selfShield: 300 } },
  { id: 'ghost', name: 'Ghost', cost: 4, traits: ['Assassin', 'Frost'], hp: 750, attack: 100, attackSpeed: 0.9, armor: 25, range: 1, magic: false,
    ability: { name: 'Death Mark', description: 'Executes the target for huge physical damage.', mana: 75, power: 330, kind: 'nuke', physical: true } },
  { id: 'phoenix', name: 'Phoenix', cost: 4, traits: ['Mage', 'Fire'], hp: 800, attack: 55, attackSpeed: 0.7, armor: 25, range: 3, magic: true,
    ability: { name: 'Rebirth Flame', description: 'Burns all enemies for magic damage.', mana: 90, power: 220, kind: 'aoe' } },
  { id: 'sniper', name: 'Sniper', cost: 4, traits: ['Ranger', 'Storm'], hp: 700, attack: 95, attackSpeed: 0.8, armor: 20, range: 4, magic: false,
    ability: { name: 'Headshot', description: 'A single huge physical shot.', mana: 70, power: 400, kind: 'nuke', physical: true } },
  // ----- 5 gold -----
  { id: 'dragon', name: 'Dragon', cost: 5, traits: ['Warrior', 'Fire'], hp: 1500, attack: 110, attackSpeed: 0.75, armor: 50, range: 2, magic: true,
    ability: { name: 'Dragon Breath', description: 'Breathes fire on every enemy.', mana: 90, power: 300, kind: 'aoe' } },
  { id: 'titan', name: 'Titan', cost: 5, traits: ['Guardian', 'Storm'], hp: 1800, attack: 80, attackSpeed: 0.6, armor: 70, range: 1, magic: false,
    ability: { name: 'Earthquake', description: 'Damages and stuns its target for two seconds, and shields itself.', mana: 100, power: 250, kind: 'stun', stunSeconds: 2, selfShield: 500 } },
  { id: 'queen', name: 'Queen', cost: 5, traits: ['Mage', 'Frost'], hp: 1000, attack: 60, attackSpeed: 0.7, armor: 30, range: 3, magic: true,
    ability: { name: 'Blizzard', description: 'Freezes all enemies with heavy magic damage.', mana: 100, power: 320, kind: 'aoe' } },
  { id: 'wizard', name: 'Wizard', cost: 5, traits: ['Mage', 'Storm'], hp: 900, attack: 60, attackSpeed: 0.7, armor: 30, range: 4, magic: true,
    ability: { name: 'Meteor Storm', description: 'Rains meteors on all enemies.', mana: 100, power: 350, kind: 'aoe' } },
];

export const UNIT_BY_ID: Record<string, UnitDef> = Object.fromEntries(UNITS.map((u) => [u.id, u]));

/** How many copies of each cost tier exist in the shared pool. */
export const POOL_SIZE = [0, 22, 18, 14, 10, 8];

/** Words speech recognition often hears instead of a unit name. */
export const NAME_ALIASES: Record<string, string> = {
  night: 'knight', nite: 'knight', nights: 'knight', knights: 'knight',
  rocks: 'rock', rocky: 'rock', pixy: 'pixie', pixies: 'pixie', yetti: 'yeti', yetty: 'yeti',
  shamon: 'shaman', vikings: 'viking', tigers: 'tiger', giants: 'giant', monks: 'monk',
  generals: 'general', ghosts: 'ghost', snipers: 'sniper', dragons: 'dragon', titans: 'titan',
  wizards: 'wizard', queens: 'queen', ninjas: 'ninja', bandits: 'bandit', archers: 'archer', hunters: 'hunter',
  falcons: 'falcon', healers: 'healer', larva: 'lava', lover: 'lava', laba: 'lava', java: 'lava', phoenixes: 'phoenix', fenix: 'phoenix',
};

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

/** AI opponent difficulty. Raise these numbers to make opponents stronger. */
export const AI = {
  levelPerRound: 0.34, // AI level = 1 + round * this
  costTierEvery: 4.5,
  /** AI only uses cost tiers with at least this % shop odds at its level */
  minShopOdds: 15, // AI unlocks a new cost tier every N rounds
  twoStarPerRound: 0.025,
  twoStarMax: 0.55,
  threeStarFromRound: 20,
  threeStarPerRound: 0.03,
  /** damage when AI opponents fight each other */
  fightDamageBase: 3,
  fightDamagePerRound: 0.7,
};
