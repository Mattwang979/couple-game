// 池塘畫面（Canvas）。俯視角：上面是水，下面是岸邊的漁夫。
// 世界座標 x、y 都是 0~1，y 越大越靠近岸邊。

import { FISH, FISHERS, RULES } from './data.js';
import { bobberDip, isFrozen, fishInAir } from './game.js';

const DECOR = [
  { x: 0.12, y: 0.18, e: '🪷', s: 30 },
  { x: 0.86, y: 0.12, e: '🍃', s: 26 },
  { x: 0.78, y: 0.62, e: '🪷', s: 26 },
  { x: 0.08, y: 0.55, e: '🍃', s: 22 },
  { x: 0.45, y: 0.05, e: '🍃', s: 20 },
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.pondTop = this.h * 0.13;
    this.shoreY = this.h * 0.76;
    this.pondH = this.shoreY - this.pondTop;
  }

  toScreen(x, y) {
    return [x * this.w, this.pondTop + y * this.pondH];
  }

  toWorld(px, py) {
    return [px / this.w, (py - this.pondTop) / this.pondH];
  }

  rodTip() {
    return [this.w * 0.5 + 22, this.shoreY + 4];
  }

  draw(v) {
    const { ctx } = this;
    const r = v.round;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawWater(v.now);
    this.drawShore(r);
    if (!r) return;

    this.drawParticles(v.particles, v.now);
    if (r.phase === 'lure') this.drawLure(v);
    else this.drawFight(v);
    if (v.joy) this.drawJoystick(v.joy);
  }

  drawWater(now) {
    const { ctx, w } = this;
    const g = ctx.createLinearGradient(0, 0, 0, this.shoreY);
    g.addColorStop(0, '#2a8fd0');
    g.addColorStop(1, '#7fd3f5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, this.shoreY + 10);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = (i / 9) * this.shoreY + 20;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const yy = y + Math.sin(x / 40 + now * 1.4 + i) * 4;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now + i);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of DECOR) {
      const [x, y] = this.toScreen(d.x, d.y);
      ctx.font = `${d.s}px serif`;
      ctx.fillText(d.e, x + Math.sin(now * 0.8 + d.x * 10) * 2, y);
    }
  }

  drawShore(r) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, this.shoreY, 0, h);
    g.addColorStop(0, '#f6dc9c');
    g.addColorStop(1, '#e8c070');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, this.shoreY + 8);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, this.shoreY + Math.sin(x / 30) * 5);
    ctx.lineTo(w, this.shoreY + Math.sin(w / 30) * 5);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();

    ctx.font = '28px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌾', 18, this.shoreY - 4);
    ctx.fillText('🌾', w - 18, this.shoreY - 4);

    const emoji = r ? FISHERS[r.fisher].emoji : '🧑';
    ctx.font = '40px serif';
    ctx.fillText(emoji, w * 0.5, this.shoreY + 30);
    // 釣竿
    ctx.strokeStyle = '#7a4a1e';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + 10, this.shoreY + 36);
    ctx.lineTo(...this.rodTip());
    ctx.stroke();
  }

  line(from, to, color, sag = 0, shake = 0) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(...from);
    const mx = (from[0] + to[0]) / 2 + (Math.random() - 0.5) * shake;
    const my = (from[1] + to[1]) / 2 + sag + (Math.random() - 0.5) * shake;
    ctx.quadraticCurveTo(mx, my, to[0], to[1]);
    ctx.stroke();
  }

  drawLure(v) {
    const { ctx } = this;
    const r = v.round;
    const L = r.lure;
    const fish = FISH[r.fish];
    const isFish = v.side === 'fish';
    const tip = this.rodTip();

    // 浮標
    if (L.bobber) {
      let [bx, by] = this.toScreen(L.bobber.x, L.bobber.y);
      if (!L.bobber.landed) {
        const p = Math.min(1, 1 - (L.bobber.landAt - r.clock) / RULES.castFlight);
        const ex = bx;
        const ey = by;
        bx = tip[0] + (ex - tip[0]) * p;
        by = tip[1] + (ey - tip[1]) * p - Math.sin(p * Math.PI) * 80;
      }
      this.line(tip, [bx, by], 'rgba(255,255,255,0.8)', 20);
      if (L.bobber.landed) {
        if (isFish) {
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = v.inRange ? 'rgba(120,255,140,0.9)' : 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(bx, by, fish.biteRange * this.w, fish.biteRange * this.pondH, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '22px serif';
          ctx.fillText('🪱', bx + 4, by + 18);
        }
        const dip = bobberDip(r);
        const wob = dip > 0 ? Math.sin(v.now * 30) * 2 * dip : Math.sin(v.now * 2) * 1.5;
        this.drawBobber(bx, by + wob + dip * 6, 1 - dip * 0.55);
      } else {
        this.drawBobber(bx, by, 1);
      }
    }

    // 魚
    const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
    const sonar = r.clock < r.effects.sonar;
    if (isFish || sonar) {
      if (sonar) {
        const rr = 20 + ((v.now * 60) % 40);
        ctx.strokeStyle = `rgba(80,255,120,${1 - rr / 60})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx, fy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.drawFish(fish.emoji, fx, fy, v.fishPos.dir, r.fish === 'shark' ? 52 : 42, v.now);
    } else {
      const alpha = fish.shadow + FISHERS[r.fisher].shadowBonus;
      const size = r.fish === 'shark' ? 1.6 : 1;
      ctx.fillStyle = `rgba(10,30,60,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 22 * size, 11 * size, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (isFrozen(r)) {
      ctx.font = '26px serif';
      ctx.fillText('🍚', fx, fy - 34);
    }
  }

  drawBobber(x, y, scale) {
    const { ctx } = this;
    const s = 9 * scale;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff4d4f';
    ctx.beginPath();
    ctx.arc(x, y, s, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawFish(emoji, x, y, dir, size, now, extraScale = 1, wiggle = 0.1) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(now * 8) * wiggle);
    // emoji 魚預設面向左邊
    ctx.scale(-dir * extraScale, extraScale);
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  }

  fightFishScreen(r) {
    const f = r.fight;
    const y = 0.92 - (f.d / RULES.escapeDistance) * 0.88;
    return this.toScreen(f.x, Math.max(0.02, y));
  }

  drawFight(v) {
    const { ctx } = this;
    const r = v.round;
    const fish = FISH[r.fish];
    const tip = this.rodTip();
    const size = r.fish === 'shark' ? 56 : 46;

    if (r.phase === 'hooked' || !r.fight) {
      const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
      this.line(tip, [fx, fy], '#fff', 0, 6);
      this.drawFish(fish.emoji, fx, fy, v.fishPos.dir, size, v.now, 1, 0.5);
      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = '#ffd84d';
      ctx.fillText('!', fx, fy - 40);
      return;
    }

    const f = r.fight;
    let [fx, fy] = this.fightFishScreen(r);
    const ratio = f.T / FISHERS[r.fisher].snapAt;
    const slack = f.T <= RULES.slackLimit;
    const color = slack ? 'rgba(255,255,255,0.6)' : ratio > 0.85 ? '#ff4d4f' : ratio > 0.6 ? '#ffd84d' : '#fff';

    // 水花
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const rr = 18 + ((v.now * 50 + i * 20) % 30);
      ctx.globalAlpha = 1 - (rr - 18) / 30;
      ctx.beginPath();
      ctx.ellipse(fx, fy + 6, rr * 1.4, rr * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    let scale = 1;
    if (f.jump) {
      if (r.clock < f.jump.airAt) {
        fx += Math.sin(v.now * 60) * 4;
      } else {
        const p = (r.clock - f.jump.airAt) / RULES.jumpAir;
        const lift = Math.sin(Math.min(1, p) * Math.PI);
        ctx.fillStyle = 'rgba(10,30,60,0.25)';
        ctx.beginPath();
        ctx.ellipse(fx, fy + 10, 26, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        fy -= lift * 90;
        scale = 1 + lift * 0.6;
      }
    }

    this.line(tip, [fx, fy], color, slack ? 60 : 0, ratio > 0.85 ? 8 : 0);
    const dir = f.targetX < f.x - 0.01 ? 1 : f.targetX > f.x + 0.01 ? -1 : v.fishPos.dir;
    this.drawFish(fish.emoji, fx, fy, dir, size, v.now, scale, fishInAir(r) ? 0.6 : 0.25);
    if (r.clock < r.effects.puff) {
      ctx.font = '22px serif';
      ctx.fillText('💢', fx + 28, fy - 26);
    }
    if (isFrozen(r)) {
      ctx.font = '26px serif';
      ctx.fillText('🍚', fx, fy - 38);
    }
    if (r.clock < r.effects.steady) {
      ctx.font = '24px serif';
      ctx.fillText('🛡️', tip[0] + 18, tip[1] - 20);
    }
  }

  drawParticles(list, now) {
    const { ctx } = this;
    for (const p of list) {
      const age = now - p.t0;
      const k = age / p.dur;
      if (k < 0 || k > 1) continue;
      const [x, y] = this.toScreen(p.x, p.y);
      if (p.kind === 'ripple') {
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * p.alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + k * p.size, (6 + k * p.size) * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'drop') {
        ctx.fillStyle = `rgba(255,255,255,${1 - k})`;
        ctx.beginPath();
        ctx.arc(x + p.vx * age * 60, y + p.vy * age * 60 + 120 * age * age, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'text') {
        ctx.font = `${p.size}px serif`;
        ctx.globalAlpha = 1 - k;
        ctx.fillText(p.text, x, y - k * 40);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawJoystick(j) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(j.ox, j.oy, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(j.ox + j.dx * 50, j.oy + j.dy * 50, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}
