// 對戰畫面：操作輸入、HUD、特效、事件回饋。

import { FISH, FISHERS, RULES, SHOUTS } from './data.js';
import { canUlt, fishInRange, counterDir, isFrozen } from './game.js';
import { sideOf, other } from './match.js';
import { Renderer, fightX, QUALITY } from './render.js';
import { sfx, vibrate, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const ARROW = { left: '⬅', right: '➡', up: '⬆', down: '⬇' };
const CONFETTI = ['#ff6f91', '#ffd84d', '#4fb8e8', '#7ee0c3', '#b7a6ff', '#ff9f43'];
const QUALITY_KEY = 'couple-fishing-quality';
const QUALITY_ORDER = ['high', 'medium', 'low'];
const QUALITY_LABEL = { auto: '自動', high: '高', low: '低' };

function loadQualityMode() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === 'auto' || v === 'high' || v === 'low') return v;
  } catch {}
  return 'auto';
}

export class PlayScreen {
  // send(action)：送出玩家動作；getMatch()：最新比賽狀態；me：'host' | 'guest'
  // stateAge()：距離上次拿到新狀態過了幾毫秒（拿來推估時間，讓動畫連續）
  constructor({ send, getMatch, me, stateAge = () => 0 }) {
    this.send = send;
    this.getMatch = getMatch;
    this.me = me;
    this.stateAge = stateAge;
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
    this.inDanger = false;
    this.lastDangerBuzz = 0;
    this.joy = null;
    this.keys = new Set();
    this.bite = 'none';
    this.lastMoveSent = 0;
    this.lastRipple = 0;
    this.lastBubble = 0;
    this.prevPos = null;
    this.inkWiped = 0;
    this.running = false;
    this.animClock = 0; // 動畫用的時間；打擊停格時會暫停
    this.hitStopUntil = 0;
    this.hitFlash = 0;
    this.castAt = -9;
    this.shouts = []; // { who, text, t0 }
    this.hud = new Map(); // 上次寫進 DOM 的值，沒變就不寫
    this.lastCombo = 0;
    this.quality = { mode: loadQualityMode(), level: 'high', ema: 16, badSince: 0 };
    this.applyQuality();
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
      const raw = t - this.lastFrame;
      const dt = Math.min(0.1, raw / 1000);
      this.lastFrame = t;
      this.monitorQuality(raw, t / 1000);
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

  frame(dt, realNow) {
    const m = this.getMatch();
    let r = m?.round;
    if (!r) return;

    // 打擊停格：動畫時間暫停一下（遊戲模擬照常跑）
    this.realNow = realNow;
    if (realNow >= this.hitStopUntil) this.animClock += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    const now = this.animClock;

    // 狀態每 25～50ms 才更新一次；用經過的時間推估 clock，跳躍、拋竿等動畫才會連續
    if (!m.paused && r.phase !== 'over') {
      const ext = Math.min(0.1, this.stateAge() / 1000);
      if (ext > 0) r = { ...r, clock: r.clock + ext };
    }

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
    const cap = QUALITY[this.renderer.level].particles;
    if (this.particles.length > cap) this.particles.splice(0, this.particles.length - cap);
    this.shouts = this.shouts.filter((b) => now - b.t0 < 1.8);

    this.renderer.draw({
      round: r,
      side,
      fishPos: this.displayPos,
      fightPos: this.fightPos,
      phaseT: now - this.phaseSeenAt,
      shake,
      flickT: now - this.flickAt,
      castT: now - this.castAt,
      ready: { fish: canUlt(r, 'fish'), fisher: canUlt(r, 'fisher') },
      bubbles: this.shouts,
      hitFlash: this.hitFlash,
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
        screen: true,
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

  // 跳出彈跳放大的大字（BLOCK!、+7m! 之類）
  impact(text, color, now) {
    this.addParticle({ kind: 'text', screen: true, px: this.renderer.w / 2, py: this.renderer.h * 0.44, text, size: 38, color, pop: true, rise: 30, dur: 0.9 }, now);
  }

  // 打擊停格 + 白光
  hitStop(sec) {
    this.hitStopUntil = (this.realNow || 0) + sec;
    this.hitFlash = 1;
  }

  // 角色喊話：用事件 id 挑台詞，雙方看到同一句；有時候換成角色的個人台詞
  shout(who, kind, e, charId, now) {
    const pool = SHOUTS[who]?.[kind];
    const personal = SHOUTS[charId];
    let lines = pool;
    if (personal && (kind === 'ult' || e.id % 3 === 0)) lines = personal;
    if (!lines || !lines.length) return;
    const text = lines[e.id % lines.length];
    this.shouts = this.shouts.filter((b) => b.who !== who);
    this.shouts.push({ who, text, t0: now });
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
          this.castAt = now;
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
          this.hitStop(0.12);
          this.shout('fisher', 'hooked', e, r.fisher, now);
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
          if (e.id % 2 === 0) this.shout('fish', 'dash', e, r.fish, now);
          this.bubbles(this.fightPos.x, this.fightPos.y, now, 8);
          if (isFisher) vibrate(80);
          break;
        case 'block':
          sfx('block');
          this.banner(isFisher ? '擋下了！💪' : '被擋住了！');
          this.impact('BLOCK!', '#7ecbff', now);
          this.hitStop(0.08);
          this.shout('fisher', 'block', e, r.fisher, now);
          break;
        case 'dashHit':
          sfx('hit');
          this.impulse = 16;
          this.impact({ right: '+7m!', left: '鬆線!', up: '+5m!', down: '+5m!' }[e.dir], '#ff6b6b', now);
          this.hitStop(0.08);
          this.shout('fish', 'hit', e, r.fish, now);
          if (e.dir === 'left') this.banner(isFisher ? '線鬆了！快收線！' : '衝向漁夫！線鬆了！');
          else this.banner(isFisher ? '被拖走了！' : '衝啊！🌊');
          break;
        case 'jump':
          sfx('jump');
          vibrate([50, 50, 50]);
          setTimeout(() => this.splash(this.fightPos.x, this.animClock, 14, 1.2), RULES.jumpWarn * 1000);
          this.shout('fish', 'jump', e, r.fish, now);
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
            this.banner('魚在空中！別收線！⚠️', '#ff4d4f');
          }
          break;
        case 'overload':
          // 張力超過上限，寬限時間內停手還來得及
          this.impulse = Math.max(this.impulse, 14);
          if (isFisher) {
            sfx('creak');
            vibrate(150);
          }
          this.impact('危險!', '#ff4d4f', now);
          this.shout('fisher', 'danger', e, r.fisher, now);
          break;
        case 'combo':
          this.impact(`${e.combo} COMBO!`, e.combo >= 30 ? '#ff6b3d' : '#ffd84d', now);
          if (e.combo >= 20) this.shout('fisher', 'combo', e, r.fisher, now);
          break;
        case 'ult': {
          sfx('ult');
          vibrate(100);
          const mine = e.side === side;
          const data = e.side === 'fish' ? FISH[r.fish] : FISHERS[r.fisher];
          this.cutIn(e.side, data.emoji, e.name, mine);
          this.impulse = 10;
          if (e.char === 'octopus' && isFisher) this.inkWiped = 0;
          this.shout(e.side, 'ult', e, e.char, now);
          break;
        }
        case 'end': {
          const iWin = e.winner === side;
          sfx(e.reason === 'snap' ? 'snap' : iWin ? 'win' : 'lose');
          vibrate(iWin ? [80, 40, 80] : 300);
          const head = e.reason === 'caught' ? `釣到${fishData.name}了！` : e.reason === 'snap' ? '啪！線斷了！' : e.winner === 'fish' ? `${fishData.emoji} 逃走了！` : '魚餓暈了！';
          this.banner(`${head} ${iWin ? '🎉' : '😭'}`, iWin ? '#ffd84d' : '#fff');
          const loserSide = e.winner === 'fish' ? 'fisher' : 'fish';
          this.shout(e.winner, 'win', e, e.winner === 'fish' ? r.fish : r.fisher, now);
          this.shout(loserSide, 'lose', { id: e.id + 1 }, loserSide === 'fish' ? r.fish : r.fisher, now + 0.6);
          if (e.reason === 'caught') this.hitStop(0.15);
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
        hint.textContent = '穩穩點收線，張力變紅就停手 · 魚掙扎時往箭頭方向滑';
        break;
      default:
        el.innerHTML = '';
        hint.textContent = '';
    }
  }

  // HUD 只在值改變時才寫 DOM（每幀都寫會一直觸發重排，舊手機會掉幀）
  text(id, v) {
    const k = `t:${id}`;
    if (this.hud.get(k) === v) return;
    this.hud.set(k, v);
    $(id).textContent = v;
  }

  html(id, v) {
    const k = `h:${id}`;
    if (this.hud.get(k) === v) return;
    this.hud.set(k, v);
    $(id).innerHTML = v;
  }

  style(id, prop, v) {
    const k = `s:${id}:${prop}`;
    if (this.hud.get(k) === v) return;
    this.hud.set(k, v);
    if (prop.startsWith('--')) $(id).style.setProperty(prop, v);
    else $(id).style[prop] = v;
  }

  hide(id, hidden) {
    const k = `v:${id}`;
    if (this.hud.get(k) === hidden) return;
    this.hud.set(k, hidden);
    $(id).hidden = hidden;
  }

  cls(id, name, on) {
    const k = `c:${id}:${name}`;
    if (this.hud.get(k) === on) return;
    this.hud.set(k, on);
    $(id).classList.toggle(name, on);
  }

  bar(id, frac) {
    this.style(id, 'transform', `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`);
  }

  updateHud(m, r, side) {
    const mode = this.modeFor(r, side);
    if (mode !== this.mode) {
      this.mode = mode;
      this.buildControls(mode, r);
      // 按鈕重建了，清掉跟按鈕有關的快取
      for (const k of [...this.hud.keys()]) if (k.includes('ctl-')) this.hud.delete(k);
    }

    const op = other(this.me);
    this.text('h-me', m.names[this.me]);
    this.text('h-op', m.names[op]);
    this.text('h-score-me', String(m.scores[this.me]));
    this.text('h-score-op', String(m.scores[op]));
    this.text('h-round', `第 ${m.roundNo + 1}/${m.totalRounds} 局${r.multiplier > 1 ? ' ×2' : ''} · ${side === 'fish' ? FISH[r.fish].emoji + '魚' : '🎣漁夫'}`);

    const timed = r.phase === 'lure' || r.phase === 'fight';
    this.hide('h-timer', !timed);
    if (timed) {
      const left = Math.max(0, r.phaseEnd - r.clock);
      this.text('h-timer', `⏱ ${Math.ceil(left)}`);
      this.cls('h-timer', 'low', left < 10);
    }

    const L = r.lure;
    const baits = `<span class="pill">🪱 ×${L.baits}</span>`;
    const eaten = `<span class="pill">🍽 ${L.eaten}/${RULES.eatToWin}</span>`;
    this.html('h-status', r.phase === 'lure' || r.phase === 'hooked' ? baits + eaten : baits);

    // 吃餌進度只有魚看得到
    const showEat = side === 'fish' && r.phase === 'lure';
    this.hide('eat-bar', !showEat);
    if (showEat) this.bar('eat-fill', L.progress);

    // 拔河儀表
    const fighting = r.phase === 'fight' && !!r.fight;
    this.hide('fight-hud', !fighting);
    let danger = false;
    if (fighting) {
      const f = r.fight;
      const snapAt = FISHERS[r.fisher].snapAt;
      const distFrac = Math.min(1, f.d / RULES.escapeDistance);
      this.bar('h-dist-fill', 1 - distFrac);
      this.style('h-dist-fish', 'left', `${((1 - distFrac) * 100).toFixed(1)}%`);
      this.text('h-dist-fish', FISH[r.fish].emoji);
      this.text('h-dist', `${f.d.toFixed(1)}m`);
      const tFrac = Math.min(1, f.T / snapAt);
      this.bar('h-tension-fill', tFrac);
      const slack = f.T <= RULES.slackLimit;
      this.style('h-tension-fill', 'background', slack ? '#9aa3b5' : tFrac > 0.85 ? 'var(--bad)' : tFrac > 0.6 ? 'var(--warn)' : 'var(--good)');
      this.style('h-tension-danger', 'width', '15%');
      this.text('h-tension', slack ? '鬆！' : `${Math.round(f.T)}`);
      this.bar('h-stamina-fill', (side === 'fish' ? f.fishSt : f.fisherSt) / 100);

      // 張力進入危險區：漁夫的手機一直震、張力條閃紅，進入時提醒一次
      danger = tFrac >= 0.85;
      if (side === 'fisher') {
        const t = performance.now();
        if (danger && !this.inDanger) this.banner('快斷了！先停手！✋', '#ff4d4f');
        if (danger && t - this.lastDangerBuzz > 400) {
          this.lastDangerBuzz = t;
          vibrate(60);
        }
      }
    }
    this.inDanger = danger;
    this.cls('h-tension-bar', 'danger-on', danger);

    // 收線連擊
    const combo = fighting ? r.fight.combo : 0;
    this.hide('combo', combo < 3);
    if (combo >= 3) {
      const fire = combo >= 30 ? ' 🔥🔥' : combo >= 10 ? ' 🔥' : '';
      this.html('combo', `${side === 'fisher' ? '' : '<small>對方</small>'}連擊 <b>×${combo}</b>${fire}`);
      this.cls('combo', 'hot', combo >= 10);
      this.cls('combo', 'fire', combo >= 30);
      if (combo > this.lastCombo) {
        const el = $('combo');
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    }
    this.lastCombo = combo;

    // 反應提示：漁夫看到要往哪滑
    const dash = r.fight?.dash;
    const showCounter = side === 'fisher' && r.phase === 'fight' && dash && !dash.resolved;
    this.hide('counter', !showCounter);
    if (showCounter) {
      this.html('counter-arrow', `${ARROW[counterDir(dash.dir)]}<small>往這邊滑！</small>`);
      const total = RULES.dashWindow * (r.clock < r.effects.sonar ? 2 : 1);
      this.bar('counter-fill', (dash.deadline - r.clock) / total);
    }

    // 墨汁
    const inked = side === 'fisher' && r.clock < r.effects.ink && !m.paused;
    this.hide('ink', !inked);
    if (inked) this.style('ink', 'opacity', Math.max(0, 1 - this.inkWiped).toFixed(2));

    // 按鈕狀態
    const ultBtn = $('controls').querySelector('[data-ctl="ult"]');
    if (ultBtn) {
      const u = r.ult[side];
      const ready = canUlt(r, side);
      const key = `${u.used ? 0 : Math.round(u.charge)}|${ready}|${u.used}`;
      if (this.hud.get('ctl-ult') !== key) {
        this.hud.set('ctl-ult', key);
        ultBtn.style.setProperty('--p', u.used ? 0 : Math.round(u.charge));
        ultBtn.classList.toggle('ready', ready);
        ultBtn.classList.toggle('used', u.used);
        ultBtn.disabled = !ready;
      }
    }
    if (mode === 'fish-lure') {
      const ok = this.inRange(r) && !isFrozen(r);
      if (this.hud.get('ctl-bite') !== ok) {
        this.hud.set('ctl-bite', ok);
        for (const b of $('controls').querySelectorAll('.fake, .real')) b.disabled = !ok;
      }
    }
    if (mode === 'fisher-lure') {
      const yankBtn = $('controls').querySelector('[data-ctl="yank"]');
      const can = !!(L.bobber && L.bobber.landed);
      if (yankBtn && this.hud.get('ctl-yank') !== can) {
        this.hud.set('ctl-yank', can);
        yankBtn.disabled = !can;
      }
      this.text('hint', !L.bobber ? (r.clock < L.readyAt ? '換餌中…' : '點水面拋竿！') : '點水面可以換位置 · 魚真咬時提竿');
    }
    if (mode === 'fish-fight') {
      const f = r.fight;
      const jumpBtn = $('controls').querySelector('[data-ctl="jump"]');
      const off = !!(f.jump || f.dash || isFrozen(r) || r.clock < f.jumpReadyAt || f.fishSt < RULES.jumpCost);
      if (jumpBtn && this.hud.get('ctl-jump') !== off) {
        this.hud.set('ctl-jump', off);
        jumpBtn.disabled = off;
      }
    }

    this.hide('pause-overlay', !m.paused);
    if (m.paused) this.text('btn-quality', `畫質：${QUALITY_LABEL[this.quality.mode]}${this.quality.mode === 'auto' ? `（${{ high: '高', medium: '中', low: '低' }[this.quality.level]}）` : ''}`);
  }

  // ---------- 畫質 ----------

  applyQuality() {
    const q = this.quality;
    if (q.mode === 'high') q.level = 'high';
    else if (q.mode === 'low') q.level = 'low';
    this.renderer.setQuality(q.level);
  }

  // 自動模式：最近的幀時間太長就降一級（不自動升級，避免忽高忽低）
  monitorQuality(rawMs, t) {
    const q = this.quality;
    if (q.mode !== 'auto' || rawMs > 500) return; // 切出去回來的大間隔不算
    q.ema = q.ema * 0.92 + rawMs * 0.08;
    if (q.ema > 24) {
      if (!q.badSince) q.badSince = t;
      if (t - q.badSince > 2) {
        const i = QUALITY_ORDER.indexOf(q.level);
        if (i < QUALITY_ORDER.length - 1) {
          q.level = QUALITY_ORDER[i + 1];
          this.renderer.setQuality(q.level);
        }
        q.badSince = 0;
        q.ema = 16;
      }
    } else {
      q.badSince = 0;
    }
  }

  cycleQuality() {
    const order = ['auto', 'high', 'low'];
    const q = this.quality;
    q.mode = order[(order.indexOf(q.mode) + 1) % order.length];
    if (q.mode === 'auto') q.level = 'high';
    try {
      localStorage.setItem(QUALITY_KEY, q.mode);
    } catch {}
    this.applyQuality();
    this.hud.delete('t:btn-quality');
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
    $('btn-quality')?.addEventListener('click', () => this.cycleQuality());
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
