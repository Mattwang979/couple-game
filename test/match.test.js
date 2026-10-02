import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, matchAction, tickMatch, rolesFor } from '../js/match.js';
import { RULES } from '../js/data.js';

const rng = () => 0.5;
const tick = (m, s) => { for (let i = 0; i < Math.round(s * 30); i++) tickMatch(m, 1 / 30, rng); };

function toSelect() {
  const m = createMatch({ hostName: 'A', guestName: 'B' });
  matchAction(m, 'guest', { a: 'start' });
  assert.equal(m.screen, 'setup', '只有房主能開始');
  matchAction(m, 'host', { a: 'start' });
  matchAction(m, 'host', { a: 'rps', pick: 'rock' });
  matchAction(m, 'guest', { a: 'rps', pick: 'scissors' });
  assert.equal(m.rpsWinner, 'host');
  tick(m, 2.1);
  assert.equal(m.screen, 'select');
  assert.equal(m.firstFisher, 'host');
  return m;
}

test('猜拳平手會重猜', () => {
  const m = createMatch();
  matchAction(m, 'host', { a: 'start' });
  matchAction(m, 'host', { a: 'rps', pick: 'paper' });
  matchAction(m, 'guest', { a: 'rps', pick: 'paper' });
  assert.equal(m.rpsWinner, 'tie');
  tick(m, 2.1);
  assert.equal(m.screen, 'rps');
  assert.deepEqual(m.rps, { host: null, guest: null });
});

test('選角只能選自己身分的角色，兩人都選好才揭曉', () => {
  const m = toSelect();
  matchAction(m, 'host', { a: 'pick', id: 'carp' }); // 房主是漁夫，不能選魚
  assert.equal(m.picks.host, null);
  matchAction(m, 'host', { a: 'pick', id: 'pirate' });
  assert.equal(m.screen, 'select');
  matchAction(m, 'guest', { a: 'pick', id: 'shark' });
  assert.equal(m.screen, 'reveal');
  assert.equal(m.round.fisher, 'pirate');
  assert.equal(m.round.fish, 'shark');
  tick(m, 2.6);
  assert.equal(m.screen, 'play');
});

test('打完 6 局輪流當魚和漁夫，最後轉輪盤', () => {
  const m = toSelect();
  const fishers = [];
  for (let i = 0; i < RULES.totalRounds; i++) {
    const roles = rolesFor(m);
    fishers.push(roles.fisher);
    matchAction(m, roles.fisher, { a: 'pick', id: 'oldman' });
    matchAction(m, roles.fish, { a: 'pick', id: 'carp' });
    tick(m, 2.6 + RULES.lureTime + 2.2); // 讓魚餓暈
    assert.equal(m.screen, 'roundEnd');
    matchAction(m, 'host', { a: 'ready' });
    matchAction(m, 'guest', { a: 'ready' });
  }
  assert.deepEqual(fishers, ['host', 'guest', 'host', 'guest', 'host', 'guest']);
  assert.equal(m.screen, 'final');
  // 每局漁夫拿 50 分，最後一局 ×2 → guest 多 50
  assert.deepEqual(m.scores, { host: 150, guest: 200 });
  matchAction(m, 'guest', { a: 'spin' }, rng);
  assert.equal(m.wheel, null, '贏家不能轉');
  matchAction(m, 'host', { a: 'spin' }, rng);
  assert.equal(m.wheel.index, 3);
  matchAction(m, 'host', { a: 'rematch' });
  matchAction(m, 'guest', { a: 'rematch' });
  assert.equal(m.screen, 'rps');
  assert.deepEqual(m.scores, { host: 0, guest: 0 });
});

test('暫停時遊戲不會前進', () => {
  const m = toSelect();
  matchAction(m, 'host', { a: 'pick', id: 'oldman' });
  matchAction(m, 'guest', { a: 'pick', id: 'carp' });
  tick(m, 2.6);
  matchAction(m, 'guest', { a: 'pause' });
  const clock = m.round.clock;
  tick(m, 5);
  assert.equal(m.round.clock, clock);
  matchAction(m, 'host', { a: 'resume' });
  tick(m, 1);
  assert.ok(m.round.clock > clock);
});

test('懲罰清單會清理空白與過長項目', () => {
  const m = createMatch();
  matchAction(m, 'host', { a: 'penalties', list: ['  親一下 ', '', 'x'.repeat(50)] });
  assert.deepEqual(m.penalties, ['親一下', 'x'.repeat(30)]);
});
