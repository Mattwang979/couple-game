// 整場比賽的流程：設定賭注 → 猜拳 → (選角 → 揭曉 → 對戰 → 結算) × 6 → 總結算與懲罰輪盤。
// 一樣只在房主手機上跑；玩家 id 固定是 'host' / 'guest'。

import { RULES, FISH, FISHERS, DEFAULT_PENALTIES } from './data.js';
import { createRound, stepRound, applyInput } from './game.js';

export const PLAYERS = ['host', 'guest'];
const RPS = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export const other = (id) => (id === 'host' ? 'guest' : 'host');

export function createMatch({ hostName = '房主', guestName = '對手' } = {}) {
  return {
    screen: 'setup', // setup | rps | select | reveal | play | roundEnd | final
    names: { host: hostName, guest: guestName },
    penalties: DEFAULT_PENALTIES.slice(),
    totalRounds: RULES.totalRounds,
    roundNo: 0,
    firstFisher: null,
    scores: { host: 0, guest: 0 },
    rps: { host: null, guest: null },
    rpsWinner: null, // 'host' | 'guest' | 'tie' | null
    picks: { host: null, guest: null },
    round: null,
    ready: { host: false, guest: false },
    history: [],
    wheel: null, // { index, spin }
    paused: false,
    timer: 0,
    spinCount: 0,
    roundSerial: 0,
  };
}

export function rolesFor(m, roundNo = m.roundNo) {
  const fisher = roundNo % 2 === 0 ? m.firstFisher : other(m.firstFisher);
  return { fisher, fish: other(fisher) };
}

export function sideOf(m, id) {
  return rolesFor(m).fisher === id ? 'fisher' : 'fish';
}

export function loserOf(m) {
  if (m.scores.host === m.scores.guest) return null;
  return m.scores.host < m.scores.guest ? 'host' : 'guest';
}

function startSelect(m) {
  m.screen = 'select';
  m.picks = { host: null, guest: null };
}

function resetRps(m) {
  m.screen = 'rps';
  m.rps = { host: null, guest: null };
  m.rpsWinner = null;
}

function finishRound(m) {
  const r = m.round;
  const roles = rolesFor(m);
  const winnerId = r.result.winner === 'fisher' ? roles.fisher : roles.fish;
  m.scores[winnerId] += r.result.points;
  m.history.push({
    roundNo: m.roundNo,
    fisherId: roles.fisher,
    fishId: roles.fish,
    fisher: r.fisher,
    fish: r.fish,
    winnerId,
    winnerSide: r.result.winner,
    reason: r.result.reason,
    points: r.result.points,
  });
  m.screen = 'roundEnd';
  m.paused = false;
  m.ready = { host: false, guest: false };
}

function cleanPenalties(list) {
  if (!Array.isArray(list)) return null;
  return list
    .map((s) => String(s).trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 12);
}

export function matchAction(m, who, action, rng = Math.random) {
  if (!PLAYERS.includes(who) || !action) return;
  const a = action.a;

  if (a === 'penalties' && who === 'host' && m.screen === 'setup') {
    const list = cleanPenalties(action.list);
    if (list) m.penalties = list;
    return;
  }
  if (a === 'start' && who === 'host' && m.screen === 'setup') {
    resetRps(m);
    return;
  }
  if (a === 'rps' && m.screen === 'rps' && !m.rpsWinner && RPS.includes(action.pick)) {
    m.rps[who] = action.pick;
    const { host, guest } = m.rps;
    if (host && guest) {
      if (host === guest) m.rpsWinner = 'tie';
      else m.rpsWinner = BEATS[host] === guest ? 'host' : 'guest';
      m.timer = 2;
    }
    return;
  }
  if (a === 'pick' && m.screen === 'select') {
    const side = sideOf(m, who);
    const table = side === 'fisher' ? FISHERS : FISH;
    if (!Object.hasOwn(table, action.id)) return;
    m.picks[who] = action.id;
    if (m.picks.host && m.picks.guest) {
      const roles = rolesFor(m);
      const last = m.roundNo === m.totalRounds - 1;
      m.round = createRound({
        fisher: m.picks[roles.fisher],
        fish: m.picks[roles.fish],
        multiplier: last ? RULES.lastRoundMultiplier : 1,
      });
      m.roundSerial += 1;
      m.round.serial = m.roundSerial;
      m.screen = 'reveal';
      m.timer = 2.5;
    }
    return;
  }
  if (a === 'unpick' && m.screen === 'select') {
    m.picks[who] = null;
    return;
  }
  if (a === 'input' && m.screen === 'play' && !m.paused && m.round) {
    applyInput(m.round, sideOf(m, who), action.input);
    return;
  }
  if (a === 'pause' && m.screen === 'play') {
    m.paused = true;
    return;
  }
  if (a === 'resume' && m.screen === 'play') {
    m.paused = false;
    return;
  }
  if (a === 'ready' && m.screen === 'roundEnd') {
    m.ready[who] = true;
    if (m.ready.host && m.ready.guest) {
      m.roundNo += 1;
      m.round = null;
      if (m.roundNo >= m.totalRounds) {
        m.screen = 'final';
        m.wheel = null;
        m.ready = { host: false, guest: false };
      } else startSelect(m);
    }
    return;
  }
  if (a === 'spin' && m.screen === 'final' && !m.wheel && m.penalties.length) {
    const loser = loserOf(m);
    if (loser && loser !== who) return;
    m.spinCount += 1;
    m.wheel = { index: Math.floor(rng() * m.penalties.length), spin: m.spinCount };
    return;
  }
  if (a === 'rematch' && m.screen === 'final') {
    m.ready[who] = true;
    if (m.ready.host && m.ready.guest) {
      m.scores = { host: 0, guest: 0 };
      m.history = [];
      m.roundNo = 0;
      m.round = null;
      m.wheel = null;
      m.ready = { host: false, guest: false };
      resetRps(m);
    }
  }
}

export function tickMatch(m, dt, rng = Math.random) {
  if (m.screen === 'rps' && m.rpsWinner) {
    m.timer -= dt;
    if (m.timer <= 0) {
      if (m.rpsWinner === 'tie') resetRps(m);
      else {
        m.firstFisher = m.rpsWinner;
        startSelect(m);
      }
    }
  } else if (m.screen === 'reveal') {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.screen = 'play';
      m.paused = false;
    }
  } else if (m.screen === 'play' && !m.paused && m.round) {
    stepRound(m.round, dt, rng);
    if (m.round.phase === 'over' && m.round.clock - m.round.phaseStart >= RULES.endShowTime) finishRound(m);
  }
}
