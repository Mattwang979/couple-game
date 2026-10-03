import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRound, stepRound, applyInput, bobberDip, counterDir } from '../js/game.js';
import { RULES } from '../js/data.js';

const DT = 1 / 30;
const rng = () => 0.5;

function run(r, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepRound(r, DT, rng);
}

// 拋竿並讓魚游到浮標上
function lureReady(fish = 'carp', fisher = 'oldman') {
  const r = createRound({ fish, fisher });
  applyInput(r, 'fisher', { type: 'cast', x: 0.5, y: 0.5 });
  run(r, RULES.castFlight + 0.1);
  applyInput(r, 'fish', { type: 'move', x: 0.5, y: 0.5 });
  return r;
}

test('真咬時提竿會中魚並進入拔河', () => {
  const r = lureReady();
  applyInput(r, 'fish', { type: 'bite', mode: 'real' });
  run(r, 0.3);
  applyInput(r, 'fisher', { type: 'yank' });
  assert.equal(r.phase, 'hooked');
  run(r, RULES.hookedPause + 0.1);
  assert.equal(r.phase, 'fight');
});

test('剛放開真咬的寬限時間內提竿也算中魚', () => {
  const r = lureReady();
  applyInput(r, 'fish', { type: 'bite', mode: 'real' });
  run(r, 0.3);
  applyInput(r, 'fish', { type: 'bite', mode: 'none' });
  run(r, 0.1);
  applyInput(r, 'fisher', { type: 'yank' });
  assert.equal(r.phase, 'hooked');
});

test('假咬時提竿會損失一個餌', () => {
  const r = lureReady();
  applyInput(r, 'fish', { type: 'bite', mode: 'fake' });
  run(r, 0.3);
  applyInput(r, 'fisher', { type: 'yank' });
  assert.equal(r.phase, 'lure');
  assert.equal(r.lure.baits, 4);
  assert.equal(r.lure.bobber, null);
  assert.equal(r.events.at(-1).type, 'miss');
});

test('離餌太遠不能咬', () => {
  const r = lureReady();
  applyInput(r, 'fish', { type: 'move', x: 0.1, y: 0.1 });
  applyInput(r, 'fish', { type: 'bite', mode: 'real' });
  assert.equal(r.lure.bite, 'none');
});

test('吃掉 3 個餌魚就贏', () => {
  const r = createRound({ fish: 'carp', fisher: 'oldman' });
  for (let i = 0; i < 3; i++) {
    applyInput(r, 'fisher', { type: 'cast', x: 0.5, y: 0.5 });
    run(r, RULES.castFlight + 0.1);
    applyInput(r, 'fish', { type: 'move', x: 0.5, y: 0.5 });
    applyInput(r, 'fish', { type: 'bite', mode: 'real' });
    run(r, RULES.eatTime + 0.1);
    run(r, RULES.castCooldown);
  }
  assert.equal(r.phase, 'over');
  assert.deepEqual(r.result, { winner: 'fish', reason: 'ate', points: RULES.fishWinPoints });
});

test('河豚的真咬沒有破綻，其他魚會越沉越深', () => {
  for (const [fish, deeper] of [['carp', true], ['puffer', false]]) {
    const r = lureReady(fish);
    applyInput(r, 'fish', { type: 'bite', mode: 'real' });
    const first = bobberDip(r);
    run(r, 0.8);
    assert.equal(bobberDip(r) > first, deeper, fish);
  }
});

test('時間到魚餓暈，漁夫拿一半分數', () => {
  const r = createRound({ fish: 'shark', fisher: 'pirate' });
  run(r, RULES.lureTime + 0.1);
  assert.equal(r.result.winner, 'fisher');
  assert.equal(r.result.reason, 'starve');
  assert.equal(r.result.points, 75);
});

test('沒拋竿會自動拋竿', () => {
  const r = createRound({ fish: 'carp', fisher: 'oldman' });
  run(r, RULES.autoCastAfter + 0.1);
  assert.ok(r.lure.bobber);
});

function fight(fish = 'carp', fisher = 'oldman') {
  const r = lureReady(fish, fisher);
  applyInput(r, 'fish', { type: 'bite', mode: 'real' });
  applyInput(r, 'fisher', { type: 'yank' });
  run(r, RULES.hookedPause + 0.05);
  assert.equal(r.phase, 'fight');
  return r;
}

test('一直不收線魚會游走', () => {
  const r = fight();
  run(r, RULES.fightTime + 1);
  assert.equal(r.result.winner, 'fish');
  assert.ok(['escape', 'timeout'].includes(r.result.reason));
});

test('穩定收線可以釣起魚', () => {
  const r = fight();
  for (let i = 0; i < 30 * 50 && r.phase === 'fight'; i++) {
    if (i % 4 === 0) applyInput(r, 'fisher', { type: 'reel' }); // 每秒 7.5 下
    stepRound(r, DT, rng);
  }
  assert.equal(r.result.winner, 'fisher');
  assert.equal(r.result.reason, 'caught');
  assert.equal(r.result.points, 100 + RULES.baitBonus * 5);
});

test('瘋狂連點會斷線', () => {
  const r = fight('carp', 'pirate');
  for (let i = 0; i < 30 * 10 && r.phase === 'fight'; i++) {
    applyInput(r, 'fisher', { type: 'reel' }); // 每秒 30 下
    stepRound(r, DT, rng);
  }
  assert.equal(r.result.reason, 'snap');
});

test('張力短暫爆表後馬上停手不會斷', () => {
  const r = fight('carp', 'pirate');
  r.fight.T = 110;
  stepRound(r, DT, rng);
  assert.ok(r.fight.overFor > 0);
  assert.equal(r.events.at(-1).type, 'overload');
  run(r, RULES.snapGrace + 0.5);
  assert.equal(r.phase, 'fight');
  assert.equal(r.fight.overFor, 0);
});

test('每秒穩定點 8 下，面對會掙扎的魚也釣得起來', () => {
  const r = fight('carp', 'scientist');
  const dirs = ['right', 'up', 'right', 'down'];
  let n = 0;
  for (let i = 0; i < 30 * 60 && r.phase === 'fight'; i++) {
    // 魚每 3 秒掙扎一次，漁夫擋下一半
    if (i % 90 === 0) {
      const dir = dirs[n++ % dirs.length];
      applyInput(r, 'fish', { type: 'swipe', dir });
      if (n % 2 === 0) applyInput(r, 'fisher', { type: 'swipe', dir: counterDir(dir) });
    }
    if (i % 4 === 0 || i % 15 === 0) applyInput(r, 'fisher', { type: 'reel' });
    stepRound(r, DT, rng);
  }
  assert.equal(r.result.reason, 'caught');
});

test('連續收線會累積連擊，停手或魚在空中時收線會中斷', () => {
  const r = fight('carp', 'oldman');
  for (let i = 0; i < 12; i++) {
    applyInput(r, 'fisher', { type: 'reel' });
    run(r, 0.2);
  }
  assert.equal(r.fight.combo, 12);
  assert.ok(r.events.some((e) => e.type === 'combo' && e.combo === 10));
  run(r, RULES.comboGap + 0.1);
  assert.equal(r.fight.combo, 0);
  applyInput(r, 'fisher', { type: 'reel' });
  applyInput(r, 'fisher', { type: 'reel' });
  assert.equal(r.fight.combo, 2);
  applyInput(r, 'fish', { type: 'jump' });
  run(r, RULES.jumpWarn + 0.05);
  applyInput(r, 'fisher', { type: 'reel' });
  assert.equal(r.fight.combo, 0);
});

test('張力爆表會中斷連擊', () => {
  const r = fight('carp', 'pirate');
  applyInput(r, 'fisher', { type: 'reel' });
  applyInput(r, 'fisher', { type: 'reel' });
  r.fight.T = 120;
  stepRound(r, DT, rng);
  assert.equal(r.fight.combo, 0);
});

test('往上竄或下潛會改變魚的深度', () => {
  const r = fight();
  const y = r.fight.y;
  applyInput(r, 'fish', { type: 'swipe', dir: 'down' });
  run(r, 1);
  assert.ok(r.fight.y > y + 0.1);
});

test('魚掙扎時往反方向滑可以擋下', () => {
  const r = fight();
  const d = r.fight.d;
  applyInput(r, 'fish', { type: 'swipe', dir: 'left' });
  applyInput(r, 'fisher', { type: 'swipe', dir: 'right' });
  assert.equal(r.fight.dash.outcome, 'block');
  assert.ok(r.fight.d - d < 1);
});

test('沒反應過來魚就衝出去', () => {
  const r = fight();
  const d = r.fight.d;
  applyInput(r, 'fish', { type: 'swipe', dir: 'right' });
  run(r, RULES.dashWindow + 0.05);
  assert.equal(r.fight.dash.outcome, 'hit');
  assert.ok(r.fight.d - d > 6);
});

test('往漁夫衝會讓線變鬆，沒處理就脫鉤', () => {
  const r = fight();
  applyInput(r, 'fish', { type: 'swipe', dir: 'left' });
  run(r, RULES.dashWindow + 0.05);
  assert.ok(r.fight.T < RULES.slackLimit);
  run(r, RULES.slackTime);
  assert.equal(r.result.reason, 'unhook');
});

test('線鬆掉時趕快收線可以救回來', () => {
  const r = fight();
  applyInput(r, 'fish', { type: 'swipe', dir: 'left' });
  run(r, RULES.dashWindow + 0.05);
  applyInput(r, 'fisher', { type: 'reel' });
  applyInput(r, 'fisher', { type: 'reel' });
  run(r, RULES.slackTime + 0.5);
  assert.equal(r.phase, 'fight');
});

test('魚在空中時收線張力暴增', () => {
  const r = fight();
  applyInput(r, 'fish', { type: 'jump' });
  run(r, RULES.jumpWarn + 0.05);
  const T = r.fight.T;
  applyInput(r, 'fisher', { type: 'reel' });
  assert.equal(r.fight.T - T, RULES.jumpReelTension);
});

test('大招要集滿氣才能用，而且一局只能用一次', () => {
  const r = fight('shark', 'pirate');
  r.ult.fish.charge = 50;
  const T = r.fight.T;
  applyInput(r, 'fish', { type: 'ult' });
  assert.equal(r.fight.T, T);
  r.ult.fish.charge = 100;
  applyInput(r, 'fish', { type: 'ult' });
  assert.equal(r.fight.T, T + 55);
  assert.equal(r.ult.fish.used, true);
});

test('阿嬤大招讓魚不能動也不能咬', () => {
  const r = lureReady('carp', 'grandma');
  r.ult.fisher.charge = 100;
  applyInput(r, 'fisher', { type: 'ult' });
  applyInput(r, 'fish', { type: 'move', x: 0.2, y: 0.2 });
  applyInput(r, 'fish', { type: 'bite', mode: 'real' });
  assert.equal(r.fishPos.x, 0.5);
  assert.equal(r.lure.bite, 'none');
  run(r, 2.1);
  applyInput(r, 'fish', { type: 'move', x: 0.2, y: 0.2 });
  assert.equal(r.fishPos.x, 0.2);
});

test('鯉躍龍門連跳 3 次', () => {
  const r = fight('carp', 'oldman');
  r.ult.fish.charge = 100;
  applyInput(r, 'fish', { type: 'ult' });
  let jumps = 0;
  const seen = new Set();
  for (let i = 0; i < 30 * 6; i++) {
    stepRound(r, DT, rng);
    for (const e of r.events) if (e.type === 'jump' && !seen.has(e.id)) { seen.add(e.id); jumps++; }
  }
  assert.equal(jumps, 3);
});

test('最後一局分數加倍', () => {
  const r = createRound({ fish: 'carp', fisher: 'oldman', multiplier: 2 });
  run(r, RULES.lureTime + 0.1);
  assert.equal(r.result.points, 100);
});
