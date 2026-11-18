import { STAR_MULT, TRAITS, Trait, UNIT_BY_ID } from './config';

export interface BoardUnit {
  uid: number;
  defId: string;
  stars: number;
  row: number; // 0 = front
  col: number;
}

interface Fighter {
  side: 0 | 1;
  name: string;
  defId: string;
  stars: number;
  row: number;
  col: number;
  maxHp: number;
  hp: number;
  shield: number;
  attack: number;
  attackSpeed: number;
  armor: number;
  magic: boolean;
  mana: number;
  maxMana: number;
  abilityPower: number;
  cooldown: number;
  stunned: number;
  assassin: boolean;
  dmgMult: number;
}

export interface BattleEvent {
  t: number;
  text: string;
  important: boolean;
}

export interface BattleResult {
  winner: 0 | 1 | 'draw';
  survivors: { side: 0 | 1; name: string; stars: number }[];
  events: BattleEvent[];
  duration: number;
}

export function activeTraits(units: { defId: string }[]): { trait: Trait; count: number; tier: number }[] {
  const seen = new Set<string>();
  const counts: Partial<Record<Trait, number>> = {};
  for (const u of units) {
    if (seen.has(u.defId)) continue; // duplicates don't stack
    seen.add(u.defId);
    for (const t of UNIT_BY_ID[u.defId].traits) counts[t] = (counts[t] ?? 0) + 1;
  }
  return TRAITS.map((td) => {
    const count = counts[td.name] ?? 0;
    const tier = td.thresholds.filter((th) => count >= th).length;
    return { trait: td.name, count, tier };
  }).filter((x) => x.count > 0);
}

function buildFighters(units: BoardUnit[], side: 0 | 1): Fighter[] {
  const traits = activeTraits(units);
  const tier = (t: Trait) => traits.find((x) => x.trait === t)?.tier ?? 0;
  const guardianArmor = [0, 20, 50][tier('Guardian')];
  return units.map((u) => {
    const d = UNIT_BY_ID[u.defId];
    const m = STAR_MULT[u.stars];
    const has = (t: Trait) => d.traits.includes(t);
    let hp = d.hp * m;
    let attack = d.attack * m;
    let as = d.attackSpeed;
    let ap = 1;
    let mana = 0;
    let dmgMult = 1;
    if (has('Warrior')) attack *= [1, 1.25, 1.6][tier('Warrior')];
    if (has('Mage')) ap *= [1, 1.4, 1.9][tier('Mage')];
    if (has('Ranger')) as *= [1, 1.4][tier('Ranger')];
    if (has('Assassin')) dmgMult *= [1, 1.35][tier('Assassin')];
    if (has('Fire')) as *= [1, 1.2, 1.45][tier('Fire')];
    if (has('Frost')) hp *= [1, 1.2, 1.45][tier('Frost')];
    if (has('Storm')) mana = [0, 25, 50][tier('Storm')];
    return {
      side, name: d.name, defId: d.id, stars: u.stars, row: u.row, col: u.col,
      maxHp: hp, hp, shield: 0, attack, attackSpeed: as, armor: d.armor + guardianArmor, magic: d.magic,
      mana, maxMana: d.ability.mana, abilityPower: ap * m, cooldown: 0.5 + Math.random() * 0.3, stunned: 0,
      assassin: has('Assassin'), dmgMult,
    };
  });
}

function distance(a: Fighter, b: Fighter) {
  return a.row + b.row + 1 + Math.abs(a.col - (3 - b.col)) * 0.5;
}

function dealDamage(target: Fighter, raw: number, magic: boolean) {
  let dmg = magic ? raw : raw * (100 / (100 + target.armor));
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
}

export function simulateBattle(playerUnits: BoardUnit[], enemyUnits: BoardUnit[], enemyLabel = 'Enemy'): BattleResult {
  const fighters = [...buildFighters(playerUnits, 0), ...buildFighters(enemyUnits, 1)];
  const events: BattleEvent[] = [];
  const dt = 0.1;
  let t = 0;
  const label = (f: Fighter) => (f.side === 0 ? `Your ${f.name}` : `${enemyLabel} ${f.name}`);
  let firstBlood = false;

  const alive = (side: 0 | 1) => fighters.filter((f) => f.side === side && f.hp > 0);

  while (t < 45 && alive(0).length > 0 && alive(1).length > 0) {
    t += dt;
    for (const f of fighters) {
      if (f.hp <= 0) continue;
      if (f.stunned > 0) { f.stunned -= dt; continue; }
      f.cooldown -= dt;
      if (f.cooldown > 0) continue;
      const enemies = alive(f.side === 0 ? 1 : 0);
      if (enemies.length === 0) break;
      // Target selection: assassins dive the back line, everyone else hits the closest enemy.
      const sorted = [...enemies].sort((a, b) => distance(f, a) - distance(f, b));
      const target = f.assassin ? sorted[sorted.length - 1] : sorted[0];

      if (f.mana >= f.maxMana) {
        f.mana = 0;
        const ab = UNIT_BY_ID[f.defId].ability;
        const power = ab.power * f.abilityPower * f.dmgMult;
        if (ab.kind === 'nuke') dealDamage(target, power, true);
        else if (ab.kind === 'aoe') enemies.forEach((e) => dealDamage(e, power, true));
        else if (ab.kind === 'stun') { dealDamage(target, power, true); target.stunned = 1.5; }
        else if (ab.kind === 'shield') f.shield += power;
        else if (ab.kind === 'heal') {
          const ally = alive(f.side).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          ally.hp = Math.min(ally.maxHp, ally.hp + power);
        }
        if (f.stars >= 2 || ab.kind === 'aoe') {
          events.push({ t, text: `${label(f)} casts ${ab.name}.`, important: false });
        }
      } else {
        dealDamage(target, f.attack * f.dmgMult, f.magic);
        f.mana += 10;
      }
      f.cooldown = 1 / f.attackSpeed;

      for (const e of enemies) {
        if (e.hp <= 0 && !(e as Fighter & { reported?: boolean }).reported) {
          (e as Fighter & { reported?: boolean }).reported = true;
          if (!firstBlood) {
            firstBlood = true;
            events.push({ t, text: `First blood. ${label(e)} falls.`, important: true });
          } else {
            events.push({ t, text: `${label(e)} is down.`, important: false });
          }
        }
      }
      // Mana from taking hits
      if (target.hp > 0) target.mana += 5;
    }
  }

  const a0 = alive(0), a1 = alive(1);
  const winner: 0 | 1 | 'draw' = a0.length > 0 && a1.length === 0 ? 0 : a1.length > 0 && a0.length === 0 ? 1 : 'draw';
  return {
    winner,
    survivors: [...a0, ...a1].map((f) => ({ side: f.side, name: f.name, stars: f.stars })),
    events,
    duration: t,
  };
}
