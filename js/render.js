// 釣魚畫面（Canvas）：側面剖面圖。
// 上面是天空和左邊碼頭上的漁夫，中間是水面，下面是水底。
// 世界座標：x 0~1 是水平位置，y 0~1 是水深（0 = 水面、1 = 水底）。

import { FISH, FISHERS, RULES } from './data.js';
import { bobberDip, isFrozen, fishInAir } from './game.js';

const SURFACE = 0.32; // 水面在畫面高度的比例
const BOTTOM = 0.82; // 水底
const PIER = 0.2; // 碼頭寬度（畫面寬度比例）

const SEAWEED = [0.08, 0.27, 0.33, 0.52, 0.71, 0.86, 0.93];
const DECOR = [
  { x: 0.42, e: '🪸', s: 30 },
  { x: 0.78, e: '🐚', s: 20 },
  { x: 0.62, e: '🪨', s: 26 },
  { x: 0.18, e: '🪨', s: 22 },
];
const SMALL_FISH = [
  { y: 0.25, speed: 0.035, off: 0.1, size: 7, color: '#ffb347' },
  { y: 0.6, speed: 0.025, off: 0.6, size: 9, color: '#7ee0c3' },
  { y: 0.78, speed: 0.045, off: 0.3, size: 6, color: '#ff8fab' },
  { y: 0.45, speed: 0.02, off: 0.85, size: 8, color: '#b7a6ff' },
];
const CLOUDS = [
  { y: 0.07, speed: 0.012, off: 0.1, s: 1 },
  { y: 0.15, speed: 0.008, off: 0.55, s: 0.75 },
  { y: 0.1, speed: 0.01, off: 0.9, s: 0.6 },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);

// 拔河時魚的水平位置由距離決定：距離 0 在碼頭邊，越遠越右邊
export function fightX(d) {
  return 0.24 + (d / RULES.escapeDistance) * 0.74;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = dpr;
    this.w = rect.width || 1;
    this.h = rect.height || 1;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sY = this.h * SURFACE;
    this.bY = this.h * BOTTOM;
    this.pierW = this.w * PIER;
    this.deckY = this.sY - 16;
    this.buildBackground();
  }

  toScreen(x, d) {
    return [x * this.w, this.sY + d * (this.bY - this.sY)];
  }

  toWorld(px, py) {
    return [px / this.w, (py - this.sY) / (this.bY - this.sY)];
  }

  waveY(px, now) {
    return this.sY + Math.sin(px / 45 + now * 2) * 3 + Math.sin(px / 19 - now * 1.3) * 1.5;
  }

  // 不會動的天空和遠山先畫好存起來
  buildBackground() {
    const { w, sY } = this;
    this.bg.width = Math.round(w * this.dpr);
    this.bg.height = Math.round((sY + 10) * this.dpr);
    const c = this.bg.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = c.createLinearGradient(0, 0, 0, sY);
    sky.addColorStop(0, '#6ec6ff');
    sky.addColorStop(0.7, '#bfe8ff');
    sky.addColorStop(1, '#fff1d6');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, sY + 10);
    // 太陽
    const sx = w * 0.82;
    const sy = sY * 0.32;
    const glow = c.createRadialGradient(sx, sy, 10, sx, sy, 90);
    glow.addColorStop(0, 'rgba(255,240,170,0.9)');
    glow.addColorStop(1, 'rgba(255,240,170,0)');
    c.fillStyle = glow;
    c.fillRect(sx - 90, sy - 90, 180, 180);
    c.fillStyle = '#ffe066';
    c.beginPath();
    c.arc(sx, sy, 22, 0, Math.PI * 2);
    c.fill();
    // 遠山
    const hills = [
      { color: '#9dd3c8', h: 0.22, f: 90, p: 0 },
      { color: '#74bfa6', h: 0.13, f: 60, p: 2 },
    ];
    for (const hl of hills) {
      c.fillStyle = hl.color;
      c.beginPath();
      c.moveTo(0, sY + 5);
      for (let x = 0; x <= w + 10; x += 10) {
        c.lineTo(x, sY - sY * hl.h * (0.6 + 0.4 * Math.sin(x / hl.f + hl.p)));
      }
      c.lineTo(w, sY + 5);
      c.fill();
    }
  }

  // ---------- 主繪圖 ----------

  draw(v) {
    const { ctx, w, h } = this;
    const r = v.round;
    const now = v.now;
    ctx.clearRect(0, 0, w, h);

    // 鏡頭：震動 + 中魚特寫放大
    const cam = this.camera(v);
    ctx.save();
    ctx.translate(cam.fx + (v.shake?.x || 0), cam.fy + (v.shake?.y || 0));
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.fx, -cam.fy);

    this.drawSky(now);
    this.drawWater(now);
    this.drawSeabed(now);
    this.drawSmallFish(now, v.side === 'fisher');

    if (r) {
      const scene = this.scene(v);
      this.drawUnderwater(v, scene);
      this.drawParticles(v.particles, now);
      this.drawSurfaceLine(now);
      this.drawAbove(v, scene);
    } else {
      this.drawSurfaceLine(now);
      this.drawPier(now, '🧑', { bend: 0, target: null });
    }
    if (v.joy) this.drawJoystick(v.joy);
    ctx.restore();

    if (r) this.drawOverlay(v);
  }

  camera(v) {
    const r = v.round;
    const cam = { zoom: 1, fx: this.w / 2, fy: this.h / 2 };
    if (r && r.phase === 'hooked') {
      const t = v.phaseT;
      const zin = easeOut(t / 0.35);
      const zout = easeOut((t - (RULES.hookedPause - 0.35)) / 0.35);
      cam.zoom = 1 + 0.7 * zin * (1 - zout);
      const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
      cam.fx = fx;
      cam.fy = fy;
    }
    return cam;
  }

  // 算出這一幀的魚、浮標、魚鉤、魚線目標位置
  scene(v) {
    const r = v.round;
    const now = v.now;
    const s = { fish: null, bobber: null, hook: null, lineTo: null, bend: 0.08, taut: false, slack: false, fishAlpha: 1 };
    const fishData = FISH[r.fish];
    const size = r.fish === 'shark' ? 58 : 48;

    if (r.phase === 'lure') {
      const L = r.lure;
      if (L.bobber) {
        const [bx] = this.toScreen(L.bobber.x, 0);
        const sy = this.waveY(bx, now);
        if (!L.bobber.landed) {
          const tip = this.rodGeom(now, 0.05, null, v.flick).tip;
          const p = clamp01(1 - (L.bobber.landAt - r.clock) / RULES.castFlight);
          s.bobber = { x: lerp(tip[0], bx, p), y: lerp(tip[1], sy, p) - Math.sin(p * Math.PI) * 90, dip: 0, flying: true };
        } else {
          const dip = bobberDip(r);
          s.bobber = { x: bx, y: sy - 3 + dip * 12 + (dip ? Math.sin(now * 30) * 2 * dip : 0), dip };
          const sink = easeOut((r.clock - L.bobber.landAt) / 0.5);
          const [, hy] = this.toScreen(L.bobber.x, L.bobber.y * sink);
          s.hook = { x: bx, y: hy + (dip ? dip * 6 : 0) };
          s.bend = 0.08 + dip * 0.25;
        }
        s.lineTo = [s.bobber.x, s.bobber.y];
      }
      const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
      s.fish = { x: fx, y: fy + Math.sin(now * 3) * 3, dir: v.fishPos.dir, size, rot: 0, scale: 1, wiggle: 0.12 };
    } else if (r.phase === 'hooked') {
      const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
      const shake = 6;
      s.fish = { x: fx + (Math.random() - 0.5) * shake, y: fy + (Math.random() - 0.5) * shake, dir: v.fishPos.dir, size: size * 1.15, rot: 0, scale: 1, wiggle: 0.5 };
      s.lineTo = [fx, fy];
      s.bend = 0.9;
      s.taut = true;
    } else if (r.phase === 'fight' && r.fight) {
      const f = r.fight;
      const [fx, fy] = this.toScreen(v.fightPos.x, v.fightPos.y);
      const ratio = f.T / FISHERS[r.fisher].snapAt;
      s.fish = { x: fx, y: fy, dir: 1, size, rot: Math.sin(now * 14) * 0.15, scale: 1, wiggle: 0.3 };
      if (f.dash && !f.dash.resolved) s.fish.wiggle = 0.6;
      if (f.jump) {
        if (r.clock < f.jump.airAt) {
          s.fish.x += Math.sin(now * 60) * 4;
        } else {
          const p = clamp01((r.clock - f.jump.airAt) / RULES.jumpAir);
          const lift = Math.sin(p * Math.PI);
          s.fish.y = lerp(fy, this.sY - 120, lift);
          s.fish.rot = -0.8 + p * 1.6;
          s.fish.scale = 1 + lift * 0.4;
          s.inAir = true;
        }
      }
      s.lineTo = [s.fish.x, s.fish.y];
      s.slack = f.T <= RULES.slackLimit;
      s.taut = !s.slack;
      s.bend = s.slack ? 0.03 : clamp01(ratio);
      s.ratio = ratio;
    } else if (r.phase === 'over') {
      this.endScene(v, s, size);
    }
    s.fishEmoji = fishData.emoji;
    return s;
  }

  // 結局動畫
  endScene(v, s, size) {
    const r = v.round;
    const t = v.phaseT;
    const reason = r.result?.reason;
    const now = v.now;
    let start;
    if (r.fight) start = this.toScreen(v.fightPos.x, v.fightPos.y);
    else start = this.toScreen(v.fishPos.x, v.fishPos.y);
    const fish = { x: start[0], y: start[1], dir: r.fight ? 1 : v.fishPos.dir, size, rot: 0, scale: 1, wiggle: 0.15 };
    s.fish = fish;

    if (reason === 'caught') {
      const p = easeOut(t / 1.1);
      const rod = this.rodGeom(now, 0.3, null, 0);
      const endX = rod.tip[0] + 10;
      const endY = this.deckY - 110;
      fish.x = lerp(start[0], endX, p);
      fish.y = lerp(start[1], endY, p) - Math.sin(p * Math.PI) * 80;
      fish.rot = t < 1.1 ? t * 12 : Math.sin(now * 6) * 0.2;
      fish.scale = 1 + p * 0.5;
      s.lineTo = [fish.x, fish.y];
      s.taut = true;
      s.bend = 0.5 * (1 - p) + 0.2;
    } else if (reason === 'snap') {
      fish.x = start[0] + t * this.w * 0.2;
      fish.dir = 1;
      fish.wiggle = 0.4;
      // 斷掉的線頭往回彈
      s.brokenLine = clamp01(t / 0.4);
      s.bend = 0;
    } else if (reason === 'escape' || reason === 'timeout' || reason === 'unhook') {
      fish.x = start[0] + t * this.w * 0.16;
      fish.dir = 1;
      fish.wiggle = 0.35;
      s.brokenLine = 1;
    } else if (reason === 'starve') {
      fish.y = lerp(start[1], this.sY + 8, easeOut(t / 2));
      fish.rot = Math.PI;
      fish.wiggle = 0.02;
      s.dizzy = true;
    } else {
      // 吃光餌：打嗝
      fish.scale = 1 + Math.max(0, Math.sin(t * 6)) * 0.15 * Math.max(0, 1 - t / 2);
    }
  }

  // ---------- 背景 ----------

  drawSky(now) {
    const { ctx, w } = this;
    ctx.drawImage(this.bg, 0, 0, w, this.sY + 10);
    for (const c of CLOUDS) {
      const x = (((now * c.speed + c.off) % 1.3) - 0.15) * w;
      const y = this.sY * c.y * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      for (const [dx, dy, rr] of [[0, 0, 18], [20, -8, 22], [42, 0, 17], [20, 6, 18]]) {
        ctx.moveTo(x + dx * c.s + rr * c.s, y + dy * c.s);
        ctx.arc(x + dx * c.s, y + dy * c.s, rr * c.s, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  drawWater(now) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, this.sY, 0, this.bY);
    g.addColorStop(0, '#4cc3ee');
    g.addColorStop(0.5, '#1d8fcc');
    g.addColorStop(1, '#0d4f86');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, this.waveY(x, now));
    ctx.lineTo(w, h);
    ctx.fill();

    // 光束
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = w * (0.15 + i * 0.2) + Math.sin(now * 0.4 + i) * 20;
      const a = 0.05 + 0.04 * Math.sin(now * 0.8 + i * 1.7);
      const lg = ctx.createLinearGradient(0, this.sY, 0, this.bY);
      lg.addColorStop(0, `rgba(255,255,230,${a})`);
      lg.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x - 14, this.sY);
      ctx.lineTo(x + 14, this.sY);
      ctx.lineTo(x + 70, this.bY);
      ctx.lineTo(x + 10, this.bY);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSeabed(now) {
    const { ctx, w, h } = this;
    // 碼頭木樁
    ctx.fillStyle = '#6b4423';
    for (const px of [0.05, 0.16]) ctx.fillRect(w * px - 5, this.deckY, 10, this.bY - this.deckY + 20);

    // 水草
    ctx.lineCap = 'round';
    SEAWEED.forEach((sx, i) => {
      const x0 = sx * w;
      const height = 50 + (i % 3) * 28;
      for (let k = 0; k < 2; k++) {
        const sway = Math.sin(now * 1.4 + i + k) * 14;
        ctx.strokeStyle = k ? '#3fae5a' : '#2d8a46';
        ctx.lineWidth = 6 - k * 2;
        ctx.beginPath();
        ctx.moveTo(x0 + k * 8, this.bY + 10);
        ctx.bezierCurveTo(x0 + k * 8 + sway, this.bY - height * 0.4, x0 + k * 8 - sway, this.bY - height * 0.7, x0 + k * 8 + sway * 1.3, this.bY - height);
        ctx.stroke();
      }
    });

    // 沙地
    const g = ctx.createLinearGradient(0, this.bY - 10, 0, h);
    g.addColorStop(0, '#f2d49b');
    g.addColorStop(1, '#c99a5b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, this.bY + Math.sin(x / 37) * 6 + Math.sin(x / 11) * 2);
    ctx.lineTo(w, h);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000';
    for (const d of DECOR) {
      ctx.font = `${d.s}px serif`;
      ctx.fillText(d.e, d.x * w, this.bY + 8);
    }

    // 往上冒的氣泡
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      const p = (now * 0.07 + i * 0.137) % 1;
      const x = ((i * 0.618) % 1) * w + Math.sin(now * 2 + i) * 6;
      const y = lerp(this.bY, this.sY, p);
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawSmallFish(now, murky) {
    const { ctx, w } = this;
    for (const f of SMALL_FISH) {
      const x = (((now * f.speed + f.off) % 1.4) - 0.2) * w;
      const [, y] = this.toScreen(0, f.y + Math.sin(now + f.off * 10) * 0.03);
      ctx.fillStyle = murky ? 'rgba(10,30,60,0.35)' : f.color;
      ctx.beginPath();
      ctx.ellipse(x, y, f.size * 1.6, f.size, 0, 0, Math.PI * 2);
      ctx.moveTo(x - f.size * 1.4, y);
      ctx.lineTo(x - f.size * 2.6, y - f.size);
      ctx.lineTo(x - f.size * 2.6, y + f.size);
      ctx.fill();
    }
  }

  // ---------- 水下 ----------

  drawUnderwater(v, s) {
    const { ctx } = this;
    const r = v.round;
    const isFish = v.side === 'fish';
    const fishData = FISH[r.fish];

    // 浮標到魚鉤的線、魚鉤、蚯蚓
    if (s.hook && s.bobber) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.bobber.x, s.bobber.y + 6);
      ctx.lineTo(s.hook.x, s.hook.y);
      ctx.stroke();
      this.drawHook(s.hook.x, s.hook.y, v.now);
      if (isFish && r.lure.bobber?.landed) {
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = v.inRange ? 'rgba(130,255,150,0.95)' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = v.inRange ? 3 : 2;
        ctx.beginPath();
        ctx.ellipse(s.hook.x, s.hook.y, fishData.biteRange * this.w, fishData.biteRange * (this.bY - this.sY), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const murky = !isFish && (r.phase === 'lure' || (r.phase === 'over' && !r.fight && r.result?.reason !== 'starve'));
    if (!isFish) {
      // 漁夫看不清水下：蓋一層混濁
      ctx.fillStyle = murky ? 'rgba(6,28,52,0.62)' : 'rgba(6,28,52,0.2)';
      ctx.fillRect(0, this.sY + 4, this.w, this.bY - this.sY - 6);
    }

    if (!s.fish) return;
    const sonar = r.clock < r.effects.sonar && r.phase === 'lure';
    if (murky && !sonar) {
      const alpha = fishData.shadow + FISHERS[r.fisher].shadowBonus;
      const k = r.fish === 'shark' ? 1.6 : 1;
      ctx.fillStyle = `rgba(0,10,25,${alpha + 0.1})`;
      ctx.beginPath();
      ctx.ellipse(s.fish.x, s.fish.y, 24 * k, 11 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      if (sonar) {
        for (let i = 0; i < 2; i++) {
          const rr = 20 + ((v.now * 70 + i * 35) % 70);
          ctx.strokeStyle = `rgba(90,255,140,${1 - rr / 90})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(s.fish.x, s.fish.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (isFish && v.inRange && r.phase === 'lure') {
        const glow = ctx.createRadialGradient(s.fish.x, s.fish.y, 4, s.fish.x, s.fish.y, 46);
        glow.addColorStop(0, 'rgba(255,255,180,0.55)');
        glow.addColorStop(1, 'rgba(255,255,180,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(s.fish.x - 46, s.fish.y - 46, 92, 92);
      }
      // 在水面以上的魚（跳躍、被釣起來）留給 drawAbove 畫
      if (!s.inAir && s.fish.y >= this.sY) this.drawFish(s.fishEmoji, s.fish, v.now);
    }
    if (isFrozen(r) && r.phase !== 'over') this.label('🍚', s.fish.x, s.fish.y - 38, 26);
    if (r.clock < r.effects.puff && r.phase === 'fight') this.label('💢', s.fish.x + 30, s.fish.y - 26, 22);
    if (s.dizzy) this.label('💫', s.fish.x, s.fish.y - 30 + Math.sin(v.now * 5) * 3, 26);
  }

  drawHook(x, y, now) {
    const { ctx } = this;
    ctx.strokeStyle = '#d9dde3';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 12);
    ctx.arc(x - 5, y + 12, 5, 0, Math.PI, false);
    ctx.stroke();
    // 扭來扭去的蚯蚓
    ctx.strokeStyle = '#ff7aa2';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const px = x - 6 + Math.sin(now * 6 + t * 6) * 4;
      const py = y + 4 + t * 18;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  drawFish(emoji, f, now) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(Math.sin(now * 8) * f.wiggle + f.rot);
    // emoji 魚預設面向左；dir = 1 代表往右
    ctx.scale(-f.dir * f.scale, f.scale);
    ctx.fillStyle = '#000'; // emoji 會吃到 fillStyle 的透明度，要設成不透明
    ctx.font = `${f.size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  }

  label(text, x, y, size) {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  drawSurfaceLine(now) {
    const { ctx, w } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= w + 8; x += 8) {
      const y = this.waveY(x, now);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 水面閃光
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 0.173 + now * 0.02) % 1) * w;
      const a = Math.max(0, Math.sin(now * 3 + i * 2));
      ctx.globalAlpha = a;
      ctx.fillRect(x, this.waveY(x, now) + 4, 10, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 水面以上 ----------

  drawAbove(v, s) {
    const r = v.round;
    const fisher = FISHERS[r.fisher];
    // 跳出水面的魚
    if (s.inAir) {
      this.drawFish(s.fishEmoji, s.fish, v.now);
    }
    // 被釣起來的魚
    if (r.phase === 'over' && r.result?.reason === 'caught' && s.fish && s.fish.y < this.sY) {
      this.drawFish(s.fishEmoji, s.fish, v.now);
    }

    const rod = this.drawPier(v.now, fisher.emoji, { bend: s.bend, target: s.lineTo, flick: v.flick });

    // 竿尖到浮標 / 魚的魚線
    const { ctx } = this;
    if (s.lineTo && !s.brokenLine) {
      let color = 'rgba(255,255,255,0.85)';
      if (s.ratio !== undefined) color = s.slack ? 'rgba(255,255,255,0.6)' : s.ratio > 0.85 ? '#ff4d4f' : s.ratio > 0.6 ? '#ffd84d' : '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = s.taut ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(...rod.tip);
      const mx = (rod.tip[0] + s.lineTo[0]) / 2;
      const my = (rod.tip[1] + s.lineTo[1]) / 2;
      const sag = s.taut ? 0 : s.slack ? 70 : 25;
      const jitter = s.ratio > 0.85 ? (Math.random() - 0.5) * 6 : 0;
      ctx.quadraticCurveTo(mx + jitter, my + sag + jitter, s.lineTo[0], s.lineTo[1]);
      ctx.stroke();
    } else if (s.brokenLine) {
      // 斷線：剩一小段線在竿尖晃
      const len = 60 * (1 - s.brokenLine * 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...rod.tip);
      ctx.quadraticCurveTo(rod.tip[0] + 10, rod.tip[1] + len * 0.6, rod.tip[0] + Math.sin(v.now * 4) * 8, rod.tip[1] + len);
      ctx.stroke();
    }

    if (s.bobber && r.phase === 'lure') this.drawBobber(s.bobber.x, s.bobber.y, 1 - s.bobber.dip * 0.35);
  }

  rodGeom(now, bend, target, flick = 0) {
    const base = [this.pierW * 0.5 + 16, this.deckY - 30];
    const L = Math.min(this.w * 0.3, 130);
    const ang = -0.85 - 0.5 * flick;
    const straight = [base[0] + Math.cos(ang) * L, base[1] + Math.sin(ang) * L];
    let tip = straight;
    const b = clamp01(bend) * 0.7;
    if (target && b > 0) {
      const dx = target[0] - base[0];
      const dy = target[1] - base[1];
      const dl = Math.hypot(dx, dy) || 1;
      const toward = [base[0] + (dx / dl) * L * 0.9, base[1] + (dy / dl) * L * 0.9];
      tip = [lerp(straight[0], toward[0], b), lerp(straight[1], toward[1], b)];
      if (bend > 0.85) {
        tip[0] += (Math.random() - 0.5) * 3;
        tip[1] += (Math.random() - 0.5) * 3;
      }
    }
    const ctrl = [base[0] + Math.cos(ang) * L * 0.55, base[1] + Math.sin(ang) * L * 0.55];
    return { base, tip, ctrl };
  }

  drawPier(now, emoji, { bend, target, flick = 0 }) {
    const { ctx } = this;
    // 碼頭木板
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, this.deckY, this.pierW + 6, 12);
    ctx.fillStyle = '#a8713d';
    ctx.fillRect(0, this.deckY, this.pierW + 6, 4);
    ctx.strokeStyle = 'rgba(60,30,10,0.4)';
    ctx.lineWidth = 1;
    for (let x = 14; x < this.pierW; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, this.deckY);
      ctx.lineTo(x, this.deckY + 12);
      ctx.stroke();
    }
    // 漁夫
    this.label(emoji, this.pierW * 0.5, this.deckY - 24, 44);
    // 釣竿
    const rod = this.rodGeom(now, bend, target, flick);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(...rod.base);
    ctx.quadraticCurveTo(...rod.ctrl, ...rod.tip);
    ctx.stroke();
    ctx.strokeStyle = '#c98b4a';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 捲線器
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(rod.base[0] + 6, rod.base[1] - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    return rod;
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
    ctx.fillStyle = '#333';
    ctx.fillRect(x - 1, y - s - 6, 2, 6);
  }

  // ---------- 粒子 ----------

  drawParticles(list, now) {
    const { ctx } = this;
    for (const p of list) {
      const age = now - p.t0;
      const k = age / p.dur;
      if (k < 0 || k > 1) continue;
      if (p.kind === 'ripple') {
        const x = p.x * this.w;
        const y = this.waveY(x, now);
        const rr = 6 + k * p.size;
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * p.alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'bubble') {
        const [x0, y0] = this.toScreen(p.x, p.y);
        const y = y0 - age * 70;
        if (y < this.sY + 4) continue;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x0 + Math.sin(age * 8 + p.x * 50) * 4, y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'drop') {
        const x = p.x * this.w + p.vx * age * 60;
        const y = this.waveY(p.x * this.w, now) + p.vy * age * 60 + 260 * age * age;
        ctx.fillStyle = `rgba(220,245,255,${1 - k})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size || 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'confetti') {
        const x = p.px + p.vx * age;
        const y = p.py + p.vy * age + 300 * age * age;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(age * p.spin);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - k * k;
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();
      } else if (p.kind === 'text') {
        const [x, y] = p.screen ? [p.px, p.py] : this.toScreen(p.x, p.y);
        ctx.font = `bold ${p.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1 - k * k;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(20,35,60,0.6)';
        ctx.strokeText(p.text, x, y - k * 50);
        ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.text, x, y - k * 50);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- 鏡頭外的特效 ----------

  drawOverlay(v) {
    const { ctx, w, h } = this;
    const r = v.round;
    const now = v.now;

    if (r.phase === 'hooked') {
      const t = v.phaseT;
      // 白色閃光
      const flash = Math.max(0, 1 - t / 0.25);
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.85})`;
        ctx.fillRect(0, 0, w, h);
      }
      // 放射狀速度線
      const cx = w / 2;
      const cy = h / 2;
      const seed = Math.floor(now * 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + ((seed * 7 + i * 13) % 10) * 0.02;
        const r0 = Math.min(w, h) * (0.32 + ((seed + i * 3) % 5) * 0.03);
        const r1 = Math.max(w, h);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
    }

    // 張力危險：四周閃紅框
    if (r.phase === 'fight' && r.fight) {
      const ratio = r.fight.T / FISHERS[r.fisher].snapAt;
      if (ratio > 0.85 || fishInAir(r)) {
        const a = 0.35 + 0.25 * Math.sin(now * 16);
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
        g.addColorStop(0, 'rgba(255,40,40,0)');
        g.addColorStop(1, `rgba(255,40,40,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
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
