// 單局模擬：只有房主的手機在跑，結果再同步給對方。
// 純資料、沒有 DOM，可以直接用 node 測試。
// 座標是側面剖面：x 0~1 是水平位置（左邊是碼頭），y 0~1 是水深（0 是水面）。

import { RULES, FISH, FISHERS } from './data.js';

const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };
const DIRS = Object.keys(OPPOSITE);

export function createRound({ fish, fisher, multiplier = 1 }) {
  return {
    fish,
    fisher,
    multiplier,
    clock: 0,
    phase: 'lure', // lure → hooked → fight → over
    phaseStart: 0,
    phaseEnd: RULES.lureTime,
    fishPos: { x: 0.6, y: 0.45, dir: -1 },
    lure: {
      baits: FISHERS[fisher].baits,
      eaten: 0,
      progress: 0,
      bobber: null, // { x, y, landAt, landed }：x 是浮標位置，y 是魚鉤深度
      castAt: -99,
      readyAt: 0, // 下次可以拋竿的時間
      idleSince: 0, // 浮標不在水裡的起始時間
      bite: 'none', // none | fake | real
      biteStart: 0,
      lastRealEnd: -99,
    },
    fight: null,
    ult: { fish: { charge: 0, used: false }, fisher: { charge: 0, used: false } },
    effects: { ink: 0, sonar: 0, freeze: 0, steady: 0, puff: 0 }, // 各效果結束的時間
    result: null,
    events: [],
    eventSeq: 0,
  };
}

function emit(r, type, data = {}) {
  r.events.push({ id: ++r.eventSeq, type, at: r.clock, ...data });
  if (r.events.length > 30) r.events.shift();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const active = (r, effect) => r.clock < r.effects[effect];

export function isFrozen(r) {
  return active(r, 'freeze');
}

function bobberReady(r) {
  const b = r.lure.bobber;
  return !!b && b.landed;
}

export function fishInRange(r) {
  if (!bobberReady(r)) return false;
  const b = r.lure.bobber;
  const dx = r.fishPos.x - b.x;
  const dy = r.fishPos.y - b.y;
  return Math.hypot(dx, dy) <= FISH[r.fish].biteRange;
}

// 浮標下沉程度 0~1，給畫面用。有「破綻」的魚，真咬會越沉越深。
export function bobberDip(r) {
  const L = r.lure;
  if (L.bite === 'none') return 0;
  if (L.bite === 'real' && FISH[r.fish].tell) {
    return 0.55 + 0.45 * Math.min(1, (r.clock - L.biteStart) / 1.0);
  }
  return 0.55;
}

function addCharge(r, side, amount) {
  const u = r.ult[side];
  if (!u.used) u.charge = Math.min(100, u.charge + amount);
}

function end(r, winner, reason) {
  if (r.phase === 'over') return;
  const fishData = FISH[r.fish];
  let points;
  if (winner === 'fisher') {
    points = reason === 'starve'
      ? Math.round(fishData.weight * RULES.starveRatio)
      : fishData.weight + RULES.baitBonus * r.lure.baits;
  } else {
    points = RULES.fishWinPoints;
  }
  points *= r.multiplier;
  r.phase = 'over';
  r.phaseStart = r.clock;
  r.result = { winner, reason, points };
  emit(r, 'end', { winner, reason, points });
}

// ---------- 階段一：暗流試探 ----------

function endBite(r) {
  const L = r.lure;
  if (L.bite === 'real') L.lastRealEnd = r.clock;
  if (L.bite !== 'none') emit(r, 'biteEnd');
  L.bite = 'none';
}

function removeBobber(r, recastDelay) {
  const L = r.lure;
  L.bite = 'none';
  L.lastRealEnd = -99;
  L.progress = 0;
  L.bobber = null;
  L.idleSince = r.clock;
  L.readyAt = r.clock + recastDelay;
}

function cast(r, x, y) {
  const L = r.lure;
  endBite(r);
  L.lastRealEnd = -99;
  L.bobber = {
    x: clamp(x, 0.25, 0.94),
    y: clamp(y, 0.12, 0.88),
    landAt: r.clock + RULES.castFlight,
    landed: false,
  };
  L.castAt = r.clock;
  L.readyAt = r.clock + RULES.castCooldown;
  emit(r, 'cast', { x: L.bobber.x, y: L.bobber.y });
}

function eatBait(r) {
  const L = r.lure;
  L.eaten += 1;
  L.baits -= 1;
  removeBobber(r, 0);
  addCharge(r, 'fish', RULES.chargeOnEat);
  emit(r, 'eaten', { eaten: L.eaten });
  if (L.eaten >= RULES.eatToWin) end(r, 'fish', 'ate');
  else if (L.baits <= 0) end(r, 'fish', 'nobait');
}

function yank(r) {
  const L = r.lure;
  if (!bobberReady(r)) return;
  const hookable = L.bite === 'real' || r.clock - L.lastRealEnd <= RULES.hookGrace;
  if (hookable) {
    L.bite = 'none';
    r.phase = 'hooked';
    r.phaseStart = r.clock;
    emit(r, 'hooked');
    return;
  }
  const wasFake = L.bite === 'fake';
  L.baits -= 1;
  removeBobber(r, RULES.missRecast);
  addCharge(r, 'fish', RULES.chargeOnMiss);
  emit(r, 'miss', { wasFake });
  if (L.baits <= 0) end(r, 'fish', 'nobait');
}

function stepLure(r, rng) {
  const L = r.lure;
  if (isFrozen(r) && L.bite !== 'none') endBite(r);

  if (!L.bobber && r.clock - L.idleSince >= RULES.autoCastAfter && r.clock >= L.readyAt) {
    cast(r, 0.35 + rng() * 0.5, 0.25 + rng() * 0.5);
  }
  if (L.bobber && !L.bobber.landed && r.clock >= L.bobber.landAt) {
    L.bobber.landed = true;
    emit(r, 'splash', { x: L.bobber.x, y: L.bobber.y });
  }
  if (L.bite !== 'none' && !fishInRange(r)) endBite(r);
  if (L.bite === 'real') {
    L.progress += (1 / RULES.eatTime) * r.dt;
    if (L.progress >= 1) {
      eatBait(r);
      return;
    }
  }
  if (r.clock >= r.phaseEnd) end(r, 'fisher', 'starve');
}

// ---------- 階段二：熱血拔河 ----------

function startFight(r) {
  r.phase = 'fight';
  r.phaseStart = r.clock;
  r.phaseEnd = r.clock + RULES.fightTime;
  r.fight = {
    d: RULES.startDistance,
    T: RULES.tensionBase,
    slackFor: 0,
    overFor: 0, // 張力超過上限多久了
    fishSt: 100,
    fisherSt: 100,
    y: r.fishPos.y, // 魚的深度；水平位置由距離 d 決定
    targetY: r.fishPos.y,
    dash: null, // { dir, deadline, resolved, outcome, showUntil }
    dashReadyAt: r.clock,
    jump: null, // { airAt, landAt }
    jumpReadyAt: r.clock,
    jumpsQueued: 0,
    nextJumpAt: 0,
  };
  emit(r, 'fight');
}

function startJump(r, free) {
  const f = r.fight;
  if (!free) f.fishSt -= RULES.jumpCost;
  const airAt = r.clock + RULES.jumpWarn;
  f.jump = { airAt, landAt: airAt + RULES.jumpAir };
  f.jumpReadyAt = f.jump.landAt + RULES.jumpCooldown;
  emit(r, 'jump');
}

export function fishInAir(r) {
  const f = r.fight;
  return !!(f && f.jump && r.clock >= f.jump.airAt);
}

function dashFail(r) {
  const f = r.fight;
  const dir = f.dash.dir;
  f.dash.resolved = true;
  f.dash.outcome = 'hit';
  f.dash.showUntil = r.clock + 0.6;
  if (dir === 'right') {
    // 往外衝
    f.d += 7;
    f.T += 25;
  } else if (dir === 'left') {
    // 往漁夫衝 → 線突然變鬆
    f.d -= 3;
    f.T -= 40;
  } else {
    // 往上竄或往下潛
    f.d += 5;
    f.T += 18;
  }
  emit(r, 'dashHit', { dir });
}

function stepFight(r) {
  const f = r.fight;
  const dt = r.dt;
  const fishData = FISH[r.fish];
  const fisherData = FISHERS[r.fisher];
  const frozen = isFrozen(r);

  f.fishSt = Math.min(100, f.fishSt + RULES.fishRegen * dt);
  f.fisherSt = Math.min(100, f.fisherSt + RULES.fisherRegen * dt);

  if (f.jump && r.clock >= f.jump.landAt) {
    f.jump = null;
    f.d += 2;
    emit(r, 'land');
    if (f.jumpsQueued > 0) f.nextJumpAt = r.clock + RULES.jumpGap;
  }
  if (!f.jump && f.jumpsQueued > 0 && r.clock >= f.nextJumpAt) {
    f.jumpsQueued -= 1;
    startJump(r, true);
  }

  if (f.dash && !f.dash.resolved && r.clock >= f.dash.deadline) dashFail(r);
  if (f.dash && f.dash.resolved && r.clock >= f.dash.showUntil) f.dash = null;

  if (!frozen) {
    f.d += RULES.fishPull * fishData.pull * (0.4 + 0.6 * (f.fishSt / 100)) * dt;
  }
  // 線鬆掉時不會自己繃緊，只能靠收線拉回來
  if (f.T > RULES.slackLimit) f.T += (RULES.tensionBase - f.T) * Math.min(1, RULES.tensionRelax * dt);
  // 上限：爆表時只要馬上停手，寬限時間內就降得回來
  f.T = Math.max(0, Math.min(fisherData.snapAt + 30, f.T));
  f.y += (f.targetY - f.y) * Math.min(1, 2.5 * dt);

  const steady = active(r, 'steady');
  if (steady) f.T = 50;
  f.d = Math.max(0, f.d);

  if (f.T >= fisherData.snapAt) {
    if (f.overFor === 0) emit(r, 'overload');
    f.overFor += dt;
    if (f.overFor >= RULES.snapGrace) return end(r, 'fish', 'snap');
  } else {
    f.overFor = 0;
  }
  if (!steady && f.T <= RULES.slackLimit) f.slackFor += dt;
  else f.slackFor = 0;
  if (f.slackFor >= RULES.slackTime) return end(r, 'fish', 'unhook');
  if (f.d >= RULES.escapeDistance) return end(r, 'fish', 'escape');
  if (f.d <= 0) return end(r, 'fisher', 'caught');
  if (r.clock >= r.phaseEnd) return end(r, 'fish', 'timeout');
}

function reel(r) {
  const f = r.fight;
  if (fishInAir(r)) {
    f.T += RULES.jumpReelTension;
    emit(r, 'reelAir');
    return;
  }
  if (active(r, 'puff')) {
    f.T += 2;
    return;
  }
  const fisherData = FISHERS[r.fisher];
  const tired = f.fisherSt < 20 ? RULES.tiredReel : 1;
  f.d = Math.max(0, f.d - RULES.reelDistance * fisherData.reel * tired);
  f.T += RULES.reelTension;
  f.fisherSt = Math.max(0, f.fisherSt - RULES.reelCost);
  if (f.d <= 0) end(r, 'fisher', 'caught');
}

function fishSwipe(r, dir) {
  const f = r.fight;
  if (isFrozen(r) || f.dash || f.jump || f.jumpsQueued > 0) return;
  if (r.clock < f.dashReadyAt || f.fishSt < RULES.dashCost) return;
  const window = RULES.dashWindow * (active(r, 'sonar') ? 2 : 1);
  f.fishSt -= RULES.dashCost;
  f.dash = { dir, deadline: r.clock + window, resolved: false, outcome: null, showUntil: 0 };
  f.dashReadyAt = r.clock + window + RULES.dashCooldown;
  if (dir === 'up') f.targetY = clamp(f.y - 0.3, 0.08, 0.9);
  if (dir === 'down') f.targetY = clamp(f.y + 0.3, 0.08, 0.9);
  emit(r, 'dash', { dir });
}

function fisherSwipe(r, dir) {
  const f = r.fight;
  if (!f.dash || f.dash.resolved) return;
  if (dir === OPPOSITE[f.dash.dir]) {
    f.dash.resolved = true;
    f.dash.outcome = 'block';
    f.dash.showUntil = r.clock + 0.6;
    f.fishSt = Math.max(0, f.fishSt - 10);
    f.T += 5;
    addCharge(r, 'fisher', RULES.chargeOnBlock);
    emit(r, 'block', { dir: f.dash.dir });
  } else {
    dashFail(r);
  }
}

export function counterDir(dir) {
  return OPPOSITE[dir];
}

// ---------- 大招 ----------

export function canUlt(r, side) {
  const u = r.ult[side];
  if (u.used || u.charge < 100) return false;
  const data = side === 'fish' ? FISH[r.fish] : FISHERS[r.fisher];
  if (!data.ult.phases.includes(r.phase)) return false;
  if (side === 'fish' && isFrozen(r)) return false;
  return true;
}

function useUlt(r, side) {
  if (!canUlt(r, side)) return;
  r.ult[side].used = true;
  const c = r.clock;
  const f = r.fight;
  const id = side === 'fish' ? r.fish : r.fisher;
  switch (id) {
    case 'carp':
      if (f.jump) f.jumpsQueued = 3;
      else {
        f.jumpsQueued = 2;
        startJump(r, true);
      }
      break;
    case 'shark':
      f.T += 55;
      break;
    case 'puffer':
      r.effects.puff = c + 3;
      break;
    case 'octopus':
      r.effects.ink = c + 3;
      break;
    case 'oldman':
      r.effects.steady = c + 3;
      f.T = 50;
      break;
    case 'pirate':
      f.d = Math.max(0, f.d - 12);
      f.T += 10;
      break;
    case 'scientist':
      r.effects.sonar = c + (r.phase === 'fight' ? 4 : 3);
      break;
    case 'grandma':
      r.effects.freeze = c + 2;
      if (r.phase === 'lure') endBite(r);
      break;
  }
  const data = side === 'fish' ? FISH[r.fish] : FISHERS[r.fisher];
  emit(r, 'ult', { side, char: id, name: data.ult.name });
}

// ---------- 對外介面 ----------

export function stepRound(r, dt, rng = Math.random) {
  r.dt = dt;
  r.clock += dt;
  if (r.phase === 'over') return;
  addCharge(r, 'fish', RULES.chargeRate * dt);
  addCharge(r, 'fisher', RULES.chargeRate * dt);
  if (r.phase === 'lure') stepLure(r, rng);
  else if (r.phase === 'hooked') {
    if (r.clock >= r.phaseStart + RULES.hookedPause) startFight(r);
  } else if (r.phase === 'fight') stepFight(r);
}

// side: 'fish' | 'fisher'
export function applyInput(r, side, input) {
  if (!input || r.phase === 'over') return;
  const t = input.type;
  if (t === 'ult') return useUlt(r, side);

  if (r.phase === 'lure') {
    const L = r.lure;
    if (side === 'fish') {
      if (t === 'move' && !isFrozen(r)) {
        const x = Number(input.x);
        const y = Number(input.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        r.fishPos.x = clamp(x, 0.04, 0.96);
        r.fishPos.y = clamp(y, 0.06, 0.92);
        if (input.dir === 1 || input.dir === -1) r.fishPos.dir = input.dir;
      } else if (t === 'bite') {
        const mode = input.mode;
        if (mode === 'none') endBite(r);
        else if ((mode === 'fake' || mode === 'real') && !isFrozen(r) && fishInRange(r) && L.bite !== mode) {
          endBite(r);
          L.bite = mode;
          L.biteStart = r.clock;
          emit(r, 'dip');
        }
      }
    } else if (side === 'fisher') {
      if (t === 'cast' && r.clock >= L.readyAt) cast(r, Number(input.x) || 0.5, Number(input.y) || 0.5);
      else if (t === 'yank') yank(r);
    }
    return;
  }

  if (r.phase === 'fight') {
    const dir = DIRS.includes(input.dir) ? input.dir : null;
    if (side === 'fish') {
      if (t === 'swipe' && dir) fishSwipe(r, dir);
      else if (t === 'jump' && !isFrozen(r) && !r.fight.jump && !r.fight.dash
        && r.fight.jumpsQueued === 0 && r.clock >= r.fight.jumpReadyAt && r.fight.fishSt >= RULES.jumpCost) {
        startJump(r, false);
      }
    } else if (side === 'fisher') {
      if (t === 'reel') reel(r);
      else if (t === 'swipe' && dir) fisherSwipe(r, dir);
    }
  }
}
