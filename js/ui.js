// 對戰以外的畫面：賭注設定、猜拳、選角、揭曉、單局結算、總結算與懲罰輪盤。

import { FISH, FISHERS, REASONS } from './data.js';
import { rolesFor, sideOf, other, loserOf } from './match.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const RPS_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const WHEEL_COLORS = ['#ffb3c6', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];

function charLine(data) {
  return `${data.emoji} ${esc(data.name)}`;
}

export class Screens {
  constructor({ send, me }) {
    this.send = send;
    this.me = me;
    this.keys = {};
    this.selected = null;
    this.selectRound = -1;
    this.wheelShown = 0;
    this.wheelAngle = 0;
    this.bind();
  }

  // 只有內容真的改變時才重畫，避免輸入框被清掉
  paint(id, key, html) {
    if (this.keys[id] === key) return false;
    this.keys[id] = key;
    $(id).innerHTML = html;
    return true;
  }

  render(m) {
    this.match = m;
    if (m.screen !== 'final') this.finalCheered = false;
    const fn = {
      setup: this.setup,
      rps: this.rps,
      select: this.select,
      reveal: this.reveal,
      roundEnd: this.roundEnd,
      final: this.final,
    }[m.screen];
    if (fn) fn.call(this, m);
  }

  // ---------- 賭注設定 ----------

  setup(m) {
    const isHost = this.me === 'host';
    const items = m.penalties
      .map((p, i) => `<li><span>${esc(p)}</span>${isHost ? `<button class="x" data-act="del-penalty" data-i="${i}" aria-label="刪除">✕</button>` : ''}</li>`)
      .join('');
    const key = JSON.stringify([m.penalties, m.names]);
    this.paint('s-setup', key, `
      <div class="panel">
        <div class="vs-names">💑 ${esc(m.names.host)} vs ${esc(m.names.guest)}</div>
        <h2>🎡 輸的人要…</h2>
        <p class="hint">${isHost ? '設定懲罰輪盤，最後輸的人要轉！' : '房主正在設定懲罰輪盤…'}</p>
        <ul class="penalty-list">${items || '<li><span class="hint">沒有懲罰，純比賽！</span></li>'}</ul>
        ${isHost ? `
          <div class="add-row">
            <input id="penalty-input" maxlength="30" placeholder="自己加一個懲罰">
            <button class="btn" data-act="add-penalty">新增</button>
          </div>
          <button class="btn big primary" data-act="start">開始對戰！</button>` : '<p class="hint">等房主按開始…</p>'}
      </div>`);
  }

  // ---------- 猜拳 ----------

  rps(m) {
    const mine = m.rps[this.me];
    const op = other(this.me);
    const key = JSON.stringify([m.rps, m.rpsWinner]);
    let body;
    if (m.rpsWinner) {
      const text = m.rpsWinner === 'tie' ? '平手！再一次' : m.rpsWinner === this.me ? '你贏了！你先當漁夫 🎣' : `${esc(m.names[op])} 先當漁夫，你先當魚 🐟`;
      body = `
        <div class="rps-result">${RPS_EMOJI[m.rps[this.me]]} vs ${RPS_EMOJI[m.rps[op]]}</div>
        <h2>${text}</h2>`;
    } else {
      body = `
        <div class="rps-row">
          ${Object.keys(RPS_EMOJI).map((k) => `<button class="rps-btn ${mine === k ? 'chosen' : ''}" data-act="rps" data-pick="${k}" ${mine ? 'disabled' : ''}>${RPS_EMOJI[k]}</button>`).join('')}
        </div>
        <p class="hint">${mine ? `你出了 ${RPS_EMOJI[mine]}，等對方…` : '贏的人先當漁夫'}</p>`;
    }
    if (this.paint('s-rps', key, `<div class="panel"><h2>✊ 猜拳！</h2>${body}</div>`) && m.rpsWinner) sfx(m.rpsWinner === this.me ? 'win' : 'tap');
  }

  // ---------- 選角 ----------

  select(m) {
    if (this.selectRound !== m.roundNo + m.roundSerial * 100) {
      this.selectRound = m.roundNo + m.roundSerial * 100;
      this.selected = null;
    }
    const side = sideOf(m, this.me);
    const table = side === 'fisher' ? FISHERS : FISH;
    const picked = m.picks[this.me];
    const opReady = !!m.picks[other(this.me)];
    const last = m.roundNo === m.totalRounds - 1;
    const sel = picked || this.selected;
    const key = JSON.stringify([m.roundNo, m.roundSerial, side, picked, opReady, this.selected]);
    const cards = Object.values(table).map((c) => `
      <button class="card ${sel === c.id ? 'selected' : ''}" data-act="card" data-id="${c.id}" ${picked ? 'disabled' : ''}>
        <div class="emoji">${c.emoji}</div>
        <div class="name">${esc(c.name)}</div>
        <div class="tag">${esc(c.tag)}${side === 'fish' ? ` · ${c.weight} 分` : ''}</div>
        <div class="line"><b>被動</b> ${esc(c.passive)}</div>
        <div class="line"><b>大招・${esc(c.ult.name)}</b> ${esc(c.ult.desc)}</div>
      </button>`).join('');
    const foot = picked
      ? `<p>已選 <b>${charLine(table[picked])}</b>，等對方選…${opReady ? '' : '（對方看不到你選什麼）'}</p>
         <button class="btn ghost" data-act="unpick">改選</button>`
      : `<button class="btn big primary block" data-act="confirm" ${this.selected ? '' : 'disabled'}>就決定是你了！</button>`;
    this.paint('s-select', key, `
      <div class="select-head">
        <div class="hint">第 ${m.roundNo + 1} / ${m.totalRounds} 局${last ? '<span class="x2">最後一局 分數 ×2！</span>' : ''}</div>
        <h2>這局你是 <span class="role-badge ${side}">${side === 'fisher' ? '🎣 漁夫' : '🐟 魚'}</span></h2>
        <div class="hint">對方：${opReady ? '選好了 ✅' : '還在選…'}</div>
      </div>
      <div class="cards">${cards}</div>
      <div class="select-foot">${foot}</div>`);
  }

  // ---------- 揭曉 ----------

  reveal(m) {
    const r = m.round;
    const roles = rolesFor(m);
    const P = FISHERS[r.fisher];
    const F = FISH[r.fish];
    const key = `${r.serial}`;
    if (this.paint('s-reveal', key, `
      <div class="reveal">
        <div class="side">
          <div class="big-emoji">${P.emoji}</div>
          <h2>${esc(P.name)}</h2>
          <div>🎣 ${esc(m.names[roles.fisher])}</div>
          <div class="ult">大招：${esc(P.ult.name)}</div>
        </div>
        <div class="vs">VS</div>
        <div class="side">
          <div class="big-emoji">${F.emoji}</div>
          <h2>${esc(F.name)}</h2>
          <div>🐟 ${esc(m.names[roles.fish])}</div>
          <div class="ult">大招：${esc(F.ult.name)}</div>
        </div>
      </div>`)) sfx('ult');
  }

  // ---------- 單局結算 ----------

  scoreBoard(m) {
    const op = other(this.me);
    return `
      <div class="big-score">
        <div class="me">${esc(m.names[this.me])}<b>${m.scores[this.me]}</b></div>
        <div>:</div>
        <div>${esc(m.names[op])}<b>${m.scores[op]}</b></div>
      </div>`;
  }

  describe(m, h) {
    const P = FISHERS[h.fisher];
    const F = FISH[h.fish];
    if (h.winnerSide === 'fisher') {
      return h.reason === 'caught'
        ? `${P.emoji} ${esc(m.names[h.fisherId])} 釣到了 ${F.emoji}${esc(F.name)}`
        : `${F.emoji} ${esc(m.names[h.fishId])} 餓暈被撈走`;
    }
    return `${F.emoji} ${esc(m.names[h.fishId])} 逃走：${esc(REASONS[h.reason])}`;
  }

  roundEnd(m) {
    const h = m.history[m.history.length - 1];
    const iWin = h.winnerId === this.me;
    const key = JSON.stringify([m.roundNo, m.roundSerial, m.ready]);
    const lastRound = m.roundNo + 1 >= m.totalRounds;
    this.paint('s-roundEnd', key, `
      <div class="panel">
        <div class="result-emoji">${iWin ? '🎉' : '😭'}</div>
        <h2>${iWin ? '這局你贏了！' : '這局輸了…'}</h2>
        <p>${this.describe(m, h)}</p>
        <p class="hint">${esc(REASONS[h.reason])}</p>
        <div class="points">${esc(m.names[h.winnerId])} +${h.points}</div>
        ${this.scoreBoard(m)}
        ${m.ready[this.me]
          ? `<p class="hint">等對方準備…</p>`
          : `<button class="btn big primary" data-act="ready">${lastRound ? '看總結算 🏆' : '下一局（交換角色）'}</button>`}
        ${m.ready[other(this.me)] && !m.ready[this.me] ? '<p class="hint">對方已經準備好了！</p>' : ''}
      </div>`);
  }

  // ---------- 總結算 ----------

  final(m) {
    const loser = loserOf(m);
    const op = other(this.me);
    const canSpin = !m.wheel && m.penalties.length && (!loser || loser === this.me);
    const key = JSON.stringify([m.scores, m.wheel, m.ready, m.penalties]);
    const title = !loser ? '平手！🤝' : loser === this.me ? `${esc(m.names[op])} 贏了！😭` : '你贏了！🏆';
    const history = m.history.map((h) => `
      <li class="${h.winnerId === this.me ? 'win' : ''}">
        <span class="r">${h.roundNo + 1}</span>
        <span class="desc">${this.describe(m, h)}</span>
        <b>+${h.points}</b>
      </li>`).join('');
    let wheel = '';
    if (m.penalties.length) {
      const who = loser ? (loser === this.me ? '你' : esc(m.names[loser])) : '你們兩個';
      wheel = `
        <h3>🎡 懲罰輪盤：${who}要轉！</h3>
        <div class="wheel-wrap"><canvas id="wheel" width="520" height="520"></canvas><div class="pointer">🔻</div></div>
        <div class="penalty-result" id="penalty-result"></div>
        ${canSpin ? '<button class="btn big primary" data-act="spin">轉！</button>' : m.wheel ? '' : `<p class="hint">等 ${esc(m.names[loser])} 轉輪盤…</p>`}`;
    }
    const painted = this.paint('s-final', key, `
      <div class="panel">
        <h2>${title}</h2>
        ${this.scoreBoard(m)}
        <ul class="history">${history}</ul>
        ${wheel}
        ${m.ready[this.me]
          ? '<p class="hint">等對方…</p>'
          : '<button class="btn big" data-act="rematch">再來一場 🔁</button>'}
        <button class="btn ghost" data-act="home">回首頁</button>
      </div>`);
    if (!painted) return;
    if (m.penalties.length) {
      this.drawWheel(m.penalties, this.wheelAngle);
      if (m.wheel && m.wheel.spin !== this.wheelShown) {
        this.wheelShown = m.wheel.spin;
        this.spinWheel(m.penalties, m.wheel.index);
      } else if (m.wheel) {
        $('penalty-result').textContent = `👉 ${m.penalties[m.wheel.index]}`;
      }
    }
    if (!this.finalCheered) {
      this.finalCheered = true;
      sfx(loser === this.me ? 'lose' : 'win');
    }
  }

  drawWheel(items, angle) {
    const c = $('wheel');
    if (!c) return;
    const ctx = c.getContext('2d');
    const R = c.width / 2;
    const n = items.length;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(angle);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R - 4, a0, a1);
      ctx.fill();
      ctx.save();
      ctx.rotate((a0 + a1) / 2);
      ctx.fillStyle = '#23324a';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const label = items[i].length > 8 ? items[i].slice(0, 8) + '…' : items[i];
      ctx.fillText(label, R - 20, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(R, R, 28, 0, Math.PI * 2);
    ctx.fill();
  }

  spinWheel(items, index) {
    const n = items.length;
    // 讓第 index 格的中間停在正上方
    const target = -((index + 0.5) / n) * Math.PI * 2;
    const start = this.wheelAngle % (Math.PI * 2);
    const end = target - Math.PI * 2 * 6;
    const t0 = performance.now();
    const dur = 3500;
    let lastTick = -1;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      this.wheelAngle = start + (end - start) * ease;
      this.drawWheel(items, this.wheelAngle);
      const seg = Math.floor((-this.wheelAngle / (Math.PI * 2)) * n);
      if (seg !== lastTick) {
        lastTick = seg;
        sfx('tick');
      }
      if (p < 1) requestAnimationFrame(step);
      else {
        const el = $('penalty-result');
        if (el) el.textContent = `👉 ${items[index]}`;
        sfx('win');
      }
    };
    requestAnimationFrame(step);
  }

  // ---------- 點擊 ----------

  bind() {
    document.getElementById('app').addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const act = el.dataset.act;
      const m = this.match;
      switch (act) {
        case 'add-penalty': {
          const input = $('penalty-input');
          const v = input.value.trim();
          if (!v || !m) return;
          this.send({ a: 'penalties', list: [...m.penalties, v] });
          break;
        }
        case 'del-penalty':
          if (m) this.send({ a: 'penalties', list: m.penalties.filter((_, i) => i !== Number(el.dataset.i)) });
          break;
        case 'start':
          this.send({ a: 'start' });
          break;
        case 'rps':
          sfx('tap');
          this.send({ a: 'rps', pick: el.dataset.pick });
          break;
        case 'card':
          sfx('tap');
          this.selected = el.dataset.id;
          if (m) this.select(m);
          break;
        case 'confirm':
          if (this.selected) this.send({ a: 'pick', id: this.selected });
          break;
        case 'unpick':
          this.send({ a: 'unpick' });
          break;
        case 'ready':
          this.send({ a: 'ready' });
          break;
        case 'spin':
          this.send({ a: 'spin' });
          break;
        case 'rematch':
          this.send({ a: 'rematch' });
          break;
        case 'resume':
          this.send({ a: 'resume' });
          break;
      }
    });
    document.getElementById('app').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'penalty-input') {
        e.preventDefault();
        document.querySelector('[data-act="add-penalty"]')?.click();
      }
    });
  }
}
