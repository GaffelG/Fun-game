import { it } from 'vitest';
import { Game } from '../src/game/engine';
import { UNIT_BY_ID } from '../src/game/config';
it('sim', () => {
  const rounds: number[] = []; let wins = 0; const wr: number[][] = [];
  for (let n = 0; n < 60; n++) {
    const g = new Game();
    while (g.phase !== 'gameover' && g.round < 60) {
      const owned = new Set([...g.board, ...g.bench].filter(Boolean).map((u) => u!.defId));
      const traits = new Set([...owned].flatMap((id) => UNIT_BY_ID[id].traits));
      // level on a human-like schedule
      const target = [0,1,2,3,4,4,5,5,6,6,6,7,7,7,8,8,8,8,9][Math.min(18, g.round)] ?? 9;
      while (g.level < target && g.gold >= 4) g.buyXp();
      for (let i = 1; i <= 5; i++) {
        const id = g.shop[i - 1]; if (!id) continue;
        const good = owned.has(id) || UNIT_BY_ID[id].traits.some((t) => traits.has(t)) || g.board.length < g.maxUnits;
        if (good && g.gold - UNIT_BY_ID[id].cost >= (g.round > 4 ? 10 : 0)) { g.buy(i); owned.add(id); }
      }
      // sell bench units that are not part of a pair
      for (const u of g.bench) if (u) {
        const copies = [...g.board, ...g.bench].filter((x) => x && x.defId === u.defId && x.stars === u.stars).length;
        if (copies < 2) g.sell(UNIT_BY_ID[u.defId].name);
      }
      if (g.gold >= 30) g.refresh();
      g.fillBoard();
      // swap weakest board unit for a stronger benched one
      for (const u of g.bench) if (u) {
        const power = (x: {defId:string;stars:number}) => UNIT_BY_ID[x.defId].cost * (x.stars === 1 ? 1 : x.stars === 2 ? 3 : 9);
        const weakest = [...g.board].sort((a, b) => power(a) - power(b))[0];
        if (weakest && power(u) > power(weakest)) g.place(UNIT_BY_ID[u.defId].name, weakest.row, weakest.col);
      }
      g.startBattle();
      (wr[g.round] ??= []).push(g.lastBattle!.winner === 0 ? 1 : 0);
      g.finishBattle();
    }
    rounds.push(g.round); if (g.hp > 0) wins++;
  }
  rounds.sort((a,b)=>a-b);
  console.log('rounds median', rounds[30], 'min', rounds[0], 'max', rounds[59], 'wins', wins, '/60');
  console.log('winrate by round', wr.map((a, i) => a && `${i}:${Math.round(100 * a.reduce((x, y) => x + y, 0) / a.length)}`).filter(Boolean).join(' '));
});
