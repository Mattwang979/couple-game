// 對戰畫面：操作輸入、HUD、特效、事件回饋。

import { FISH, FISHERS, RULES } from './data.js';
import { canUlt, fishInRange, counterDir, isFrozen } from './game.js';
import { sideOf, other } from './match.js';
import { Renderer, fightX } from './render.js';
import { sfx, vibrate, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const ARROW = { left: '⬅', right: '➡', up: '⬆', down: '⬇' };
const CONFETTI = ['#ff6f91', '#ffd84d', '#4fb8e8', '#7ee0c3', '#b7a6ff', '#ff9f43'];

export class PlayScreen {
  // send(action)：送出玩家動作；getMatch()：最新比賽狀態；me：'host' | 'guest'
  constructor({ send, getMatch, me }) {
    this.send = send;
    this.getMatch = getMatch;
    this.me = me;
    this.canvas = $('pond');
    this.renderer = new Renderer(this.canvas);
    this.particles = [];
    this.serial = null;
    this.lastEventId = 0;
    this.mode = null;
    this.fishPos = { x: 0.6, y: 0.45, dir: -1 };
    this.displayPos = { x: 0.6, y: 0.45, dir: -1 };
    this.fightPos = { x: 0.7, y: 0.45 };
    this.phase = null;
    this.phaseSeenAt = 0;
    this.impulse = 0; // 事件造成的畫面震動，會慢慢衰減
    this.flickAt = -9;
    this.joy = null;
    this.keys = new Set();
    this.bite = 'none';
    this.lastMoveSent = 0;
    this.lastRipple = 0;
    this.lastBubble = 0;
    this.prevPos = null;
    this.inkWiped = 0;
    this.inkUntil = 0;
    this.running = false;
    this.bindInput();
    addEventListener('resize', () => this.renderer.resize());
  }

  input(input) {
    this.send({ a: 'input', input });
  }

  get round() {
    return this.getMatch()?.round;
  }

  get side() {
    const m = this.getMatch();
    return m ? sideOf(m, this.me) : 'fish';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.renderer.resize();
    this.lastFrame = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
      this.lastFrame = t;
      this.frame(dt, t / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.setBite('none');
    this.joy = null;
  }

  // ---------- 每一幀 ----------

  frame(dt, now) {
    const m = this.getMatch();
    const r = m?.round;
    if (!r) return;

    if (r.serial !== this.serial) {
      this.serial = r.serial;
      this.lastEventId = 0;
      this.particles = [];
      this.fishPos = { ...r.fishPos };
      this.displayPos = { ...r.fishPos };
      this.inkWiped = 0;
      this.bite = 'none';
      this.impulse = 0;
    }
    if (r.phase !== this.phase) {
      this.phase = r.phase;
      this.phaseSeenAt = now;
      if (r.phase === 'fight' && r.fight) this.fightPos = { x: this.displayPos.x, y: this.displayPos.y };
    }

    const side = this.side;
    const paused = m.paused;

    // 自己是魚：本地移動，定時回報位置
    if (side === 'fish' && r.phase === 'lure' && !paused && !isFrozen(r)) {
      const v = this.moveVector();
      const speed = FISH[r.fish].speed;
      if (v.x || v.y) {
        this.fishPos.x = Math.max(0.04, Math.min(0.96, this.fishPos.x + v.x * speed * dt));
        this.fishPos.y = Math.max(0.06, Math.min(0.92, this.fishPos.y + v.y * speed * dt * 1.2));
        if (Math.abs(v.x) > 0.15) this.fishPos.dir = v.x > 0 ? 1 : -1;
      }
      if (now - this.lastMoveSent > 0.05) {
        this.lastMoveSent = now;
        this.input({ type: 'move', x: this.fishPos.x, y: this.fishPos.y, dir: this.fishPos.dir });
      }
      this.displayPos = { ...this.fishPos };
    } else {
      const target = r.fishPos;
      const k = 1 - Math.exp(-15 * dt);
      this.displayPos.x += (target.x - this.displayPos.x) * k;
      this.displayPos.y += (target.y - this.displayPos.y) * k;
      this.displayPos.dir = target.dir;
      if (side === 'fish') this.fishPos = { ...r.fishPos };
    }

    // 魚游動會冒氣泡、靠近水面會起漣漪（漁夫找魚的線索）
    if (r.phase === 'lure') {
      const p = this.displayPos;
      if (this.prevPos) {
        const speed = Math.hypot(p.x - this.prevPos.x, p.y - this.prevPos.y) / Math.max(dt, 0.001);
        if (speed > 0.1 && now - this.lastBubble > 0.18) {
          this.lastBubble = now;
          this.addParticle({ kind: 'bubble', x: p.x - p.dir * 0.03, y: p.y, size: 2 + Math.random() * 3, dur: 1.6 }, now);
        }
        if (speed > 0.1 && p.y < 0.22 && now - this.lastRipple > 0.4) {
          this.lastRipple = now;
          this.addParticle({ kind: 'ripple', x: p.x, dur: 1.2, size: 30, alpha: 0.8 }, now);
        }
      }
      this.prevPos = { ...p };
      if (r.lure.bite !== 'none' && r.lure.bobber && now - this.lastRipple > 0.25) {
        this.lastRipple = now;
        this.addParticle({ kind: 'ripple', x: r.lure.bobber.x, dur: 0.8, size: 24, alpha: 0.9 }, now);
      }
    }

    // 拔河時魚的位置平滑移動
    if (r.fight && (r.phase === 'fight' || r.phase === 'over')) {
      const k = 1 - Math.exp(-6 * dt);
      const tx = r.phase === 'over' ? this.fightPos.x : fightX(r.fight.d);
      this.fightPos.x += (tx - this.fightPos.x) * k;
      this.fightPos.y += (r.fight.y - this.fightPos.y) * k;
      if (r.phase === 'fight' && now - this.lastBubble > 0.25) {
        this.lastBubble = now;
        this.addParticle({ kind: 'bubble', x: this.fightPos.x + 0.03, y: this.fightPos.y, size: 3, dur: 1.2 }, now);
      }
    }

    // 畫面震動：事件衝擊 + 張力越高越晃
    this.impulse *= Math.exp(-6 * dt);
    let shakeAmp = this.impulse;
    if (r.phase === 'fight' && r.fight) {
      const ratio = r.fight.T / FISHERS[r.fisher].snapAt;
      shakeAmp += Math.max(0, ratio - 0.6) * 22;
    }
    if (r.phase === 'hooked') shakeAmp += 5;
    const shake = { x: (Math.random() - 0.5) * shakeAmp, y: (Math.random() - 0.5) * shakeAmp };

    // 範圍外自動放開咬餌
    if (side === 'fish' && this.bite !== 'none' && r.phase === 'lure' && !this.inRange(r)) this.setBite('none');

    this.handleEvents(r, now);
    this.particles = this.particles.filter((p) => now - p.t0 < p.dur);

    this.renderer.draw({
      round: r,
      side,
      fishPos: this.displayPos,
      fightPos: this.fightPos,
      phaseT: now - this.phaseSeenAt,
      shake,
      flick: Math.max(0, 1 - (now - this.flickAt) / 0.35),
      now,
      particles: this.particles,
      joy: side === 'fish' && r.phase === 'lure' ? this.joy : null,
      inRange: side === 'fish' && this.inRange(r),
    });
    this.updateHud(m, r, side);
  }

  inRange(r) {
    // 用本地的魚位置判斷，手感比較即時
    return fishInRange({ ...r, fishPos: this.fishPos });
  }

  moveVector() {
    let x = 0;
    let y = 0;
    if (this.joy) {
      x = this.joy.dx;
      y = this.joy.dy;
    }
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('a')) x -= 1;
    if (k.has('ArrowRight') || k.has('d')) x += 1;
    if (k.has('ArrowUp') || k.has('w')) y -= 1;
    if (k.has('ArrowDown') || k.has('s')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  addParticle(p, now) {
    this.particles.push({ t0: now, ...p });
  }

  // 水面水花（x 是水平位置）
  splash(x, now, n = 10, power = 1) {
    this.addParticle({ kind: 'ripple', x, dur: 1, size: 44 * power, alpha: 1 }, now);
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * 3 * power;
      const vy = -(2 + Math.random() * 3) * power;
      this.addParticle({ kind: 'drop', x, vx, vy, size: 2 + Math.random() * 2.5, dur: 0.5 + Math.random() * 0.4 }, now);
    }
  }

  bubbles(x, y, now, n) {
    for (let i = 0; i < n; i++) {
      this.addParticle({ kind: 'bubble', x: x + (Math.random() - 0.5) * 0.06, y: y + Math.random() * 0.05, size: 2 + Math.random() * 4, dur: 1 + Math.random() }, now);
    }
  }

  confetti(now) {
    const w = this.renderer.w;
    for (let i = 0; i < 70; i++) {
      this.addParticle({
        kind: 'confetti',
        px: w * (0.2 + Math.random() * 0.6),
        py: this.renderer.h * 0.2,
        vx: (Math.random() - 0.5) * 380,
        vy: -150 - Math.random() * 350,
        spin: (Math.random() - 0.5) * 20,
        color: CONFETTI[i % CONFETTI.length],
        dur: 2 + Math.random(),
      }, now);
    }
  }

  floatText(text, now, opts = {}) {
    this.addParticle({ kind: 'text', screen: true, px: this.renderer.w / 2, py: this.renderer.h * 0.25, size: 34, color: '#ffd84d', dur: 1.6, text, ...opts }, now);
  }

  // 大招 cut-in
  cutIn(side, emoji, name, mine) {
    const el = $('cutin');
    el.className = `cutin ${side}`;
    el.innerHTML = `<div class="band"><span class="face">${emoji}</span><span class="txt"><small>${mine ? '大招！' : '對方的大招！'}</small>${name}</span></div>`;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.cutinTimer);
    this.cutinTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  // ---------- 事件回饋 ----------

  banner(text, color) {
    const el = $('banner');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  handleEvents(r, now) {
    const side = this.side;
    const isFisher = side === 'fisher';
    for (const e of r.events) {
      if (e.id <= this.lastEventId) continue;
      this.lastEventId = e.id;
      // 太舊的事件（例如重新連上）就不播
      if (r.clock - e.at > 1.5) continue;
      const fishData = FISH[r.fish];
      switch (e.type) {
        case 'cast':
          sfx('cast');
          break;
        case 'splash':
          sfx('splash');
          this.splash(e.x, now, 8, 0.7);
          break;
        case 'dip':
          if (isFisher) {
            sfx('plop');
            vibrate(40);
          }
          break;
        case 'hooked':
          sfx('hooked');
          vibrate([120, 60, 220]);
          this.flickAt = now;
          this.impulse = 18;
          this.splash(r.fishPos.x, now, 16, 1.3);
          this.bubbles(r.fishPos.x, r.fishPos.y, now, 12);
          this.banner(isFisher ? '中魚了！🎣' : '被釣到了！😱', '#ffd84d');
          this.setBite('none');
          break;
        case 'fight':
          this.banner(isFisher ? '收線！別拉斷！' : '快掙扎逃走！');
          break;
        case 'miss':
          sfx('miss');
          this.flickAt = now;
          if (isFisher) this.banner(e.wasFake ? '被騙了！🪱 -1' : '落空！🪱 -1');
          else this.banner(e.wasFake ? '騙到了！😏' : '嚇我一跳！');
          break;
        case 'eaten':
          sfx('eaten');
          vibrate(60);
          this.banner(isFisher ? `餌被吃掉了！(${e.eaten}/${RULES.eatToWin})` : `好吃！🍽 ${e.eaten}/${RULES.eatToWin}`);
          this.bubbles(this.displayPos.x, this.displayPos.y, now, 6);
          break;
        case 'dash':
          sfx('dash');
          this.impulse = Math.max(this.impulse, 6);
          this.bubbles(this.fightPos.x, this.fightPos.y, now, 8);
          if (isFisher) vibrate(80);
          break;
        case 'block':
          sfx('block');
          this.banner(isFisher ? '擋下了！💪' : '被擋住了！');
          break;
        case 'dashHit':
          sfx('hit');
          this.impulse = 16;
          if (e.dir === 'left') this.banner(isFisher ? '線鬆了！快收線！' : '衝向漁夫！線鬆了！');
          else this.banner(isFisher ? '被拖走了！' : '衝啊！🌊');
          break;
        case 'jump':
          sfx('jump');
          vibrate([50, 50, 50]);
          setTimeout(() => this.splash(this.fightPos.x, performance.now() / 1000, 14, 1.2), RULES.jumpWarn * 1000);
          this.banner(isFisher ? '跳起來了！放手！✋' : '飛起來！🐬', '#ffd84d');
          break;
        case 'land':
          this.splash(this.fightPos.x, now, 18, 1.4);
          this.impulse = 12;
          sfx('splash');
          break;
        case 'reelAir':
          if (isFisher) {
            vibrate(30);
            this.banner('張力爆表！⚠️', '#ff4d4f');
          }
          break;
        case 'ult': {
          sfx('ult');
          vibrate(100);
          const mine = e.side === side;
          const data = e.side === 'fish' ? FISH[r.fish] : FISHERS[r.fisher];
          this.cutIn(e.side, data.emoji, e.name, mine);
          this.impulse = 10;
          if (e.char === 'octopus' && isFisher) this.inkWiped = 0;
          break;
        }
        case 'end': {
          const iWin = e.winner === side;
          sfx(e.reason === 'snap' ? 'snap' : iWin ? 'win' : 'lose');
          vibrate(iWin ? [80, 40, 80] : 300);
          const head = e.reason === 'caught' ? `釣到${fishData.name}了！` : e.reason === 'snap' ? '啪！線斷了！' : e.winner === 'fish' ? `${fishData.emoji} 逃走了！` : '魚餓暈了！';
          this.banner(`${head} ${iWin ? '🎉' : '😭'}`, iWin ? '#ffd84d' : '#fff');
          if (e.reason === 'caught') {
            this.flickAt = now;
            this.splash(this.fightPos.x, now, 20, 1.5);
            this.confetti(now);
            this.floatText(`+${e.points}`, now, { py: this.renderer.h * 0.3, size: 44, dur: 2.4 });
          } else if (e.reason === 'snap') {
            this.impulse = 24;
          } else if (e.reason === 'ate' || e.reason === 'nobait') {
            this.bubbles(this.displayPos.x, this.displayPos.y, now, 16);
            this.addParticle({ kind: 'text', x: this.displayPos.x, y: this.displayPos.y - 0.08, text: '嗝～', size: 26, dur: 1.6 }, now);
          } else if (e.reason === 'starve') {
            this.addParticle({ kind: 'text', x: this.displayPos.x, y: this.displayPos.y - 0.08, text: '餓…', size: 24, dur: 1.6 }, now);
          }
          if (iWin && e.reason !== 'caught') this.confetti(now);
          break;
        }
      }
    }
  }

  // ---------- HUD 與按鈕 ----------

  modeFor(r, side) {
    if (r.phase === 'lure') return `${side}-lure`;
    if (r.phase === 'fight') return `${side}-fight`;
    return 'none';
  }

  buildControls(mode, r) {
    const el = $('controls');
    const side = mode.split('-')[0];
    const ultData = side === 'fish' ? FISH[r.fish].ult : FISHERS[r.fisher].ult;
    const ult = ultData.phases.includes(mode.split('-')[1])
      ? `<button class="ctl ult" data-ctl="ult"><span class="e">✨</span>${ultData.name}</button>`
      : '';
    const hint = $('hint');
    switch (mode) {
      case 'fish-lure':
        el.innerHTML = `
          <button class="ctl fake" data-ctl="fake"><span class="e">🫧</span>假咬</button>
          <button class="ctl real" data-ctl="real"><span class="e">😋</span>真咬</button>
          ${ult}`;
        hint.textContent = '拖曳畫面游動 · 游到魚鉤旁按住咬餌';
        break;
      case 'fisher-lure':
        el.innerHTML = `${ult}<button class="ctl main" data-ctl="yank"><span class="e">🎣</span>提竿！</button>`;
        hint.textContent = '點水裡拋竿（點多深鉤子就沉多深）· 魚真咬時提竿';
        break;
      case 'fish-fight':
        el.innerHTML = `<button class="ctl main" data-ctl="jump"><span class="e">🐬</span>跳！</button>${ult}`;
        hint.textContent = '滑動掙扎：➡ 往外衝 · ⬅ 衝向漁夫（線會鬆）· ⬆⬇ 竄游';
        break;
      case 'fisher-fight':
        el.innerHTML = `${ult}<button class="ctl main" data-ctl="reel"><span class="e">🌀</span>收線</button>`;
        hint.textContent = '狂點收線 · 魚掙扎時往箭頭方向滑';
        break;
      default:
        el.innerHTML = '';
        hint.textContent = '';
    }
  }

  updateHud(m, r, side) {
    const mode = this.modeFor(r, side);
    if (mode !== this.mode) {
      this.mode = mode;
      this.buildControls(mode, r);
    }

    const op = other(this.me);
    $('h-me').textContent = m.names[this.me];
    $('h-op').textContent = m.names[op];
    $('h-score-me').textContent = m.scores[this.me];
    $('h-score-op').textContent = m.scores[op];
    $('h-round').textContent = `第 ${m.roundNo + 1}/${m.totalRounds} 局${r.multiplier > 1 ? ' ×2' : ''} · ${side === 'fish' ? FISH[r.fish].emoji + '魚' : '🎣漁夫'}`;

    const timerEl = $('h-timer');
    if (r.phase === 'lure' || r.phase === 'fight') {
      const left = Math.max(0, r.phaseEnd - r.clock);
      timerEl.textContent = `⏱ ${Math.ceil(left)}`;
      timerEl.classList.toggle('low', left < 10);
      timerEl.hidden = false;
    } else timerEl.hidden = true;

    const L = r.lure;
    const status = $('h-status');
    const baits = `<span class="pill">🪱 ×${L.baits}</span>`;
    const eaten = `<span class="pill">🍽 ${L.eaten}/${RULES.eatToWin}</span>`;
    const statusHtml = r.phase === 'lure' || r.phase === 'hooked' ? baits + eaten : baits;
    if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;

    // 吃餌進度只有魚看得到
    const eatBar = $('eat-bar');
    eatBar.hidden = !(side === 'fish' && r.phase === 'lure');
    if (!eatBar.hidden) $('eat-fill').style.width = `${L.progress * 100}%`;

    // 拔河儀表
    const fh = $('fight-hud');
    fh.hidden = r.phase !== 'fight' || !r.fight;
    if (!fh.hidden) {
      const f = r.fight;
      const snapAt = FISHERS[r.fisher].snapAt;
      const distPct = Math.min(100, (f.d / RULES.escapeDistance) * 100);
      $('h-dist-fill').style.width = `${100 - distPct}%`;
      $('h-dist-fish').style.left = `${100 - distPct}%`;
      $('h-dist-fish').textContent = FISH[r.fish].emoji;
      $('h-dist').textContent = `${f.d.toFixed(1)}m`;
      const tPct = Math.min(100, (f.T / snapAt) * 100);
      const tFill = $('h-tension-fill');
      tFill.style.width = `${tPct}%`;
      const slack = f.T <= RULES.slackLimit;
      tFill.style.background = slack ? '#9aa3b5' : tPct > 85 ? 'var(--bad)' : tPct > 60 ? 'var(--warn)' : 'var(--good)';
      $('h-tension-danger').style.width = '15%';
      $('h-tension').textContent = slack ? '鬆！' : `${Math.round(f.T)}`;
      const st = side === 'fish' ? f.fishSt : f.fisherSt;
      $('h-stamina-fill').style.width = `${st}%`;
    }

    // 反應提示：漁夫看到要往哪滑
    const counter = $('counter');
    const dash = r.fight?.dash;
    const showCounter = side === 'fisher' && r.phase === 'fight' && dash && !dash.resolved;
    counter.hidden = !showCounter;
    if (showCounter) {
      const arrow = $('counter-arrow');
      const html = `${ARROW[counterDir(dash.dir)]}<small>往這邊滑！</small>`;
      if (arrow.innerHTML !== html) arrow.innerHTML = html;
      const total = RULES.dashWindow * (r.clock < r.effects.sonar ? 2 : 1);
      $('counter-fill').style.width = `${Math.max(0, (dash.deadline - r.clock) / total) * 100}%`;
    }

    // 墨汁
    const ink = $('ink');
    const inked = side === 'fisher' && r.clock < r.effects.ink && !m.paused;
    ink.hidden = !inked;
    if (inked) ink.style.opacity = String(Math.max(0, 1 - this.inkWiped));

    // 按鈕狀態
    const ultBtn = $('controls').querySelector('[data-ctl="ult"]');
    if (ultBtn) {
      const u = r.ult[side];
      ultBtn.style.setProperty('--p', u.used ? 0 : u.charge);
      const ready = canUlt(r, side);
      ultBtn.classList.toggle('ready', ready);
      ultBtn.classList.toggle('used', u.used);
      ultBtn.disabled = !ready;
    }
    if (mode === 'fish-lure') {
      const ok = this.inRange(r) && !isFrozen(r);
      for (const b of $('controls').querySelectorAll('.fake, .real')) b.disabled = !ok;
    }
    if (mode === 'fisher-lure') {
      const yankBtn = $('controls').querySelector('[data-ctl="yank"]');
      if (yankBtn) yankBtn.disabled = !(L.bobber && L.bobber.landed);
      const hint = $('hint');
      const txt = !L.bobber ? (r.clock < L.readyAt ? '換餌中…' : '點水面拋竿！') : '點水面可以換位置 · 魚真咬時提竿';
      if (hint.textContent !== txt) hint.textContent = txt;
    }
    if (mode === 'fish-fight') {
      const f = r.fight;
      const jumpBtn = $('controls').querySelector('[data-ctl="jump"]');
      if (jumpBtn) jumpBtn.disabled = !!(f.jump || f.dash || isFrozen(r) || r.clock < f.jumpReadyAt || f.fishSt < RULES.jumpCost);
    }

    $('pause-overlay').hidden = !m.paused;
  }

  // ---------- 輸入 ----------

  setBite(mode) {
    if (this.bite === mode) return;
    this.bite = mode;
    for (const b of document.querySelectorAll('#controls .fake, #controls .real')) {
      b.classList.toggle('pressed', b.dataset.ctl === mode);
    }
    if (this.getMatch()?.round) this.input({ type: 'bite', mode });
  }

  control(name, down) {
    const r = this.round;
    if (!r || this.getMatch().paused) return;
    unlockAudio();
    if (name === 'fake' || name === 'real') {
      if (down) this.setBite(name);
      else if (this.bite === name) this.setBite('none');
      return;
    }
    if (!down) return;
    if (name === 'ult') this.input({ type: 'ult' });
    else if (name === 'yank') this.input({ type: 'yank' });
    else if (name === 'jump') this.input({ type: 'jump' });
    else if (name === 'reel') {
      sfx('reel');
      this.input({ type: 'reel' });
    }
  }

  swipe(dir) {
    const r = this.round;
    if (!r || r.phase !== 'fight' || this.getMatch().paused) return;
    this.input({ type: 'swipe', dir });
  }

  bindInput() {
    const controls = $('controls');
    const pressed = new Map(); // pointerId → 控制名稱
    controls.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-ctl]');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      pressed.set(e.pointerId, btn.dataset.ctl);
      try { btn.setPointerCapture(e.pointerId); } catch {}
      this.control(btn.dataset.ctl, true);
    });
    const release = (e) => {
      const name = pressed.get(e.pointerId);
      if (!name) return;
      pressed.delete(e.pointerId);
      this.control(name, false);
    };
    controls.addEventListener('pointerup', release);
    controls.addEventListener('pointercancel', release);
    controls.addEventListener('contextmenu', (e) => e.preventDefault());

    // 畫面：魚的搖桿 / 漁夫拋竿 / 拔河滑動
    const c = this.canvas;
    let gesture = null;
    c.addEventListener('pointerdown', (e) => {
      const r = this.round;
      if (!r || this.getMatch().paused) return;
      unlockAudio();
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch {}
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      gesture = { id: e.pointerId, x0: x, y0: y, t0: performance.now(), done: false };
      if (this.side === 'fish' && r.phase === 'lure') this.joy = { ox: x, oy: y, dx: 0, dy: 0 };
    });
    c.addEventListener('pointermove', (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - gesture.x0;
      const dy = y - gesture.y0;
      if (this.joy) {
        const len = Math.hypot(dx, dy);
        const k = len > 50 ? 50 / len : 1;
        this.joy.dx = (dx * k) / 50;
        this.joy.dy = (dy * k) / 50;
      } else if (!gesture.done && Math.hypot(dx, dy) > 40 && this.round?.phase === 'fight') {
        gesture.done = true;
        this.swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      }
    });
    const end = (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const r = this.round;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const moved = Math.hypot(x - gesture.x0, y - gesture.y0);
      if (r && !this.joy && !gesture.done && e.type === 'pointerup' && moved < 15
        && this.side === 'fisher' && r.phase === 'lure' && y < this.renderer.bY && x > this.renderer.pierW) {
        let [wx, wy] = this.renderer.toWorld(x, y);
        if (wy < 0.05) wy = 0.4; // 點到天空就用預設深度
        this.input({ type: 'cast', x: wx, y: wy });
      }
      this.joy = null;
      gesture = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    // 擦墨汁
    const ink = $('ink');
    let last = null;
    ink.addEventListener('pointerdown', (e) => {
      last = [e.clientX, e.clientY];
    });
    ink.addEventListener('pointermove', (e) => {
      if (!last) return;
      this.inkWiped += Math.hypot(e.clientX - last[0], e.clientY - last[1]) / 1200;
      last = [e.clientX, e.clientY];
    });
    ink.addEventListener('pointerup', () => {
      last = null;
    });

    // 鍵盤（電腦測試用）
    const SWIPE_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    addEventListener('keydown', (e) => {
      if (!$('s-play').classList.contains('active') || e.target.tagName === 'INPUT') return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const r = this.round;
      if (!r) return;
      const side = this.side;
      if (SWIPE_KEYS[key] || key === ' ') e.preventDefault();
      if (e.repeat && key !== ' ') return;
      if (r.phase === 'lure' && side === 'fish') {
        if (SWIPE_KEYS[key]) this.keys.add(key);
        if (key === 'j' && !e.repeat) this.control('fake', true);
        if (key === 'k' && !e.repeat) this.control('real', true);
      } else if (r.phase === 'fight' && SWIPE_KEYS[key] && !e.repeat) {
        this.swipe(SWIPE_KEYS[key]);
      }
      if (e.repeat) return;
      if (key === 'u') this.control('ult', true);
      if (key === ' ') {
        if (side === 'fisher') this.control(r.phase === 'fight' ? 'reel' : 'yank', true);
        else if (r.phase === 'fight') this.control('jump', true);
      }
    });
    addEventListener('keyup', (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(key);
      if (key === 'j') this.control('fake', false);
      if (key === 'k') this.control('real', false);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.setBite('none');
    });
  }
}
