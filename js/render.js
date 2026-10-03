// 釣魚畫面（Canvas）：側面剖面圖。
// 上面是天空和左邊碼頭上的漁夫，中間是水面，下面是水底。
// 世界座標：x 0~1 是水平位置，y 0~1 是水深（0 = 水面、1 = 水底）。
//
// 效能：不會動的背景（天空、遠山、水體、沙地、裝飾、木樁）在 resize 時畫進離屏 canvas，
// 每幀只貼一次；所有 emoji 都走 sprites.js 的圖片快取；畫質分高 / 中 / 低三級。

import { FISH, FISHERS, RULES } from './data.js';
import { bobberDip, isFrozen, fishInAir } from './game.js';
import { setSpriteScale, drawSprite } from './sprites.js';
import { fisherPose, drawFisherman, drawFishChar, drawAura, drawReadyRing, drawBubble } from './characters.js';

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

// 畫質設定
export const QUALITY = {
  high: { dpr: 2, rays: 5, smallFish: true, seaweedSway: true, bubbles: 10, particles: 160 },
  medium: { dpr: 1.5, rays: 3, smallFish: false, seaweedSway: true, bubbles: 6, particles: 80 },
  low: { dpr: 1, rays: 0, smallFish: false, seaweedSway: false, bubbles: 4, particles: 40 },
};

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
    this.level = 'high';
    this.q = QUALITY.high;
    this.lastTip = null;
    this.resize();
  }

  setQuality(level) {
    if (!QUALITY[level] || level === this.level) return;
    this.level = level;
    this.q = QUALITY[level];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
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
    setSpriteScale(dpr);
    this.buildBackground();
    this.buildGradients();
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

  // ---------- 快取 ----------

  // 不會動的背景整張畫好存起來
  buildBackground() {
    const { w, h, sY, bY } = this;
    this.bg.width = Math.round(w * this.dpr);
    this.bg.height = Math.round(h * this.dpr);
    const c = this.bg.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const sky = c.createLinearGradient(0, 0, 0, sY);
    sky.addColorStop(0, '#6ec6ff');
    sky.addColorStop(0.7, '#bfe8ff');
    sky.addColorStop(1, '#fff1d6');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, sY + 8);
    // 太陽
    const sx = w * 0.82;
    const sunY = sY * 0.32;
    const glow = c.createRadialGradient(sx, sunY, 10, sx, sunY, 90);
    glow.addColorStop(0, 'rgba(255,240,170,0.9)');
    glow.addColorStop(1, 'rgba(255,240,170,0)');
    c.fillStyle = glow;
    c.fillRect(sx - 90, sunY - 90, 180, 180);
    c.fillStyle = '#ffe066';
    c.beginPath();
    c.arc(sx, sunY, 22, 0, Math.PI * 2);
    c.fill();
    // 遠山
    for (const hl of [{ color: '#9dd3c8', h: 0.22, f: 90, p: 0 }, { color: '#74bfa6', h: 0.13, f: 60, p: 2 }]) {
      c.fillStyle = hl.color;
      c.beginPath();
      c.moveTo(0, sY + 5);
      for (let x = 0; x <= w + 10; x += 10) c.lineTo(x, sY - sY * hl.h * (0.6 + 0.4 * Math.sin(x / hl.f + hl.p)));
      c.lineTo(w, sY + 5);
      c.fill();
    }
    // 水體（水面那條會動的波浪帶每幀另外畫）
    const water = c.createLinearGradient(0, sY, 0, bY);
    water.addColorStop(0, '#4cc3ee');
    water.addColorStop(0.5, '#1d8fcc');
    water.addColorStop(1, '#0d4f86');
    c.fillStyle = water;
    c.fillRect(0, sY + 5, w, h - sY);
    // 碼頭木樁
    c.fillStyle = '#6b4423';
    for (const px of [0.05, 0.16]) c.fillRect(w * px - 5, this.deckY, 10, bY - this.deckY + 20);
    // 沙地
    const sand = c.createLinearGradient(0, bY - 10, 0, h);
    sand.addColorStop(0, '#f2d49b');
    sand.addColorStop(1, '#c99a5b');
    c.fillStyle = sand;
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w + 10; x += 10) c.lineTo(x, bY + Math.sin(x / 37) * 6 + Math.sin(x / 11) * 2);
    c.lineTo(w, h);
    c.fill();
    for (const d of DECOR) drawSprite(c, d.e, d.x * w, bY - d.s * 0.35, d.s);
  }

  // 每幀會用到、但形狀不變的漸層先建好
  buildGradients() {
    const { ctx, w, h } = this;
    this.rayGrad = ctx.createLinearGradient(0, this.sY, 0, this.bY);
    this.rayGrad.addColorStop(0, 'rgba(255,255,230,0.14)');
    this.rayGrad.addColorStop(1, 'rgba(255,255,230,0)');
    this.dangerGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    this.dangerGrad.addColorStop(0, 'rgba(255,40,40,0)');
    this.dangerGrad.addColorStop(1, 'rgba(255,40,40,0.6)');
  }

  // ---------- 主繪圖 ----------

  draw(v) {
    const { ctx, w, h } = this;
    const r = v.round;
    const now = v.now;

    // 鏡頭：震動 + 中魚特寫放大
    const cam = this.camera(v);
    ctx.save();
    ctx.translate(cam.fx + (v.shake?.x || 0), cam.fy + (v.shake?.y || 0));
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.fx, -cam.fy);

    // 震動或放大時邊緣會露出來，先把底色鋪滿
    if (cam.zoom !== 1 || v.shake?.x) {
      ctx.fillStyle = '#1d8fcc';
      ctx.fillRect(-40, -40, w + 80, h + 80);
    }
    ctx.drawImage(this.bg, 0, 0, w, h);
    this.drawClouds(now);
    this.drawWaterBand(now);
    this.drawRays(now);
    this.drawSeaweed(now);
    this.drawAmbientBubbles(now);
    if (this.q.smallFish) this.drawSmallFish(now, v.side === 'fisher');

    if (r) {
      const scene = this.scene(v);
      this.drawUnderwater(v, scene);
      this.drawParticles(v.particles, now, false);
      this.drawSurfaceLine(now);
      this.drawAbove(v, scene);
      this.drawBubbles(v, scene);
    } else {
      this.drawSurfaceLine(now);
      this.drawDeck();
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

  // 算出這一幀的魚、浮標、魚鉤、魚線目標位置和漁夫姿勢
  scene(v) {
    const r = v.round;
    const now = v.now;
    const s = { fish: null, fishOpts: {}, bobber: null, hook: null, lineTo: null, bend: 0.08, taut: false, slack: false };
    const fishData = FISH[r.fish];
    const size = r.fish === 'shark' ? 58 : 48;
    let fisherState = { state: 'idle', t: 0 };

    if (r.phase === 'lure') {
      const L = r.lure;
      if (L.bobber) {
        const [bx] = this.toScreen(L.bobber.x, 0);
        const sy = this.waveY(bx, now);
        if (!L.bobber.landed) {
          const tip = this.lastTip || [this.pierW + 60, this.deckY - 90];
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
      s.fishOpts.chomp = L.bite !== 'none';
      if (v.castT < 0.5) fisherState = { state: 'cast', t: v.castT };
      else if (v.flickT < 0.35) fisherState = { state: 'yank', t: v.flickT };
    } else if (r.phase === 'hooked') {
      const [fx, fy] = this.toScreen(v.fishPos.x, v.fishPos.y);
      const shake = 6;
      s.fish = { x: fx + (Math.random() - 0.5) * shake, y: fy + (Math.random() - 0.5) * shake, dir: v.fishPos.dir, size: size * 1.15, rot: 0, scale: 1, wiggle: 0.5 };
      s.fishOpts.hookedMark = true;
      s.lineTo = [fx, fy];
      s.bend = 0.9;
      s.taut = true;
      fisherState = { state: 'hooked', t: v.phaseT };
    } else if (r.phase === 'fight' && r.fight) {
      const f = r.fight;
      const [fx, fy] = this.toScreen(v.fightPos.x, v.fightPos.y);
      const ratio = f.T / FISHERS[r.fisher].snapAt;
      s.fish = { x: fx, y: fy, dir: 1, size, rot: Math.sin(now * 14) * 0.15, scale: 1, wiggle: 0.3 };
      if (f.dash && !f.dash.resolved) {
        s.fish.wiggle = 0.6;
        const d = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] }[f.dash.dir];
        s.fishOpts.dash = { dx: d[0], dy: d[1] };
        s.fish.dir = d[0] < 0 ? -1 : 1;
      }
      s.fishOpts.angry = r.clock < r.effects.puff || !!s.fishOpts.dash;
      s.fishOpts.sweat = f.fishSt < 30;
      if (f.jump) {
        if (r.clock < f.jump.airAt) {
          s.fish.x += Math.sin(now * 60) * 4;
        } else {
          const p = clamp01((r.clock - f.jump.airAt) / RULES.jumpAir);
          const lift = Math.sin(p * Math.PI);
          s.fish.y = lerp(fy, this.sY - 120, lift);
          s.fish.rot = -0.8 + p * 1.6 + p * Math.PI * 2;
          s.fish.scale = 1 + lift * 0.4;
          s.inAir = true;
        }
      }
      s.lineTo = [s.fish.x, s.fish.y];
      s.slack = f.T <= RULES.slackLimit;
      s.taut = !s.slack;
      s.bend = s.slack ? 0.03 : clamp01(ratio);
      s.ratio = ratio;
      fisherState = { state: 'fight', t: v.phaseT, ratio, reeling: r.clock - f.lastReelAt < 0.3 };
      // 光環強度：漁夫跟連擊有關，魚衝刺時變強
      s.fisherAura = Math.min(1, 0.25 + f.combo / 30);
      s.fishAura = s.fishOpts.dash ? 1 : 0.35 + (1 - f.d / RULES.escapeDistance) * 0.2;
    } else if (r.phase === 'over') {
      fisherState = this.endScene(v, s, size);
    }
    s.fishEmoji = fishData.emoji;
    s.fisherPose = fisherPose({ ...fisherState, now });
    return s;
  }

  // 結局動畫，回傳漁夫該擺的姿勢
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
    const fisherWon = r.result?.winner === 'fisher';

    if (reason === 'caught') {
      const p = easeOut(t / 1.1);
      const tip = this.lastTip || [this.pierW + 60, this.deckY - 90];
      fish.x = lerp(start[0], tip[0] + 10, p);
      fish.y = lerp(start[1], this.deckY - 120, p) - Math.sin(p * Math.PI) * 80;
      fish.rot = t < 1.1 ? t * 12 : Math.sin(now * 6) * 0.2;
      fish.scale = 1 + p * 0.5;
      s.fishOpts.sweat = true;
      s.lineTo = [fish.x, fish.y];
      s.taut = true;
      s.bend = 0.5 * (1 - p) + 0.2;
    } else if (reason === 'snap') {
      fish.x = start[0] + t * this.w * 0.2;
      fish.dir = 1;
      fish.wiggle = 0.4;
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
    if (fisherWon) return { state: 'win', t };
    if (reason === 'ate' || reason === 'nobait') return { state: 'slump', t };
    return { state: 'lose', t };
  }

  // ---------- 會動的背景 ----------

  drawClouds(now) {
    const { ctx, w } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    for (const c of CLOUDS) {
      const x = (((now * c.speed + c.off) % 1.3) - 0.15) * w;
      const y = this.sY * c.y * 2;
      for (const [dx, dy, rr] of [[0, 0, 18], [20, -8, 22], [42, 0, 17], [20, 6, 18]]) {
        ctx.moveTo(x + dx * c.s + rr * c.s, y + dy * c.s);
        ctx.arc(x + dx * c.s, y + dy * c.s, rr * c.s, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  // 水面那條波浪：從波浪線填到水體快取的上緣
  drawWaterBand(now) {
    const { ctx, w } = this;
    ctx.fillStyle = '#4cc3ee';
    ctx.beginPath();
    ctx.moveTo(0, this.sY + 6);
    for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, this.waveY(x, now));
    ctx.lineTo(w, this.sY + 6);
    ctx.fill();
  }

  drawRays(now) {
    const n = this.q.rays;
    if (!n) return;
    const { ctx, w } = this;
    ctx.fillStyle = this.rayGrad;
    for (let i = 0; i < n; i++) {
      const x = w * (0.15 + i * (0.8 / n)) + Math.sin(now * 0.4 + i) * 20;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now * 0.8 + i * 1.7);
      ctx.beginPath();
      ctx.moveTo(x - 14, this.sY);
      ctx.lineTo(x + 14, this.sY);
      ctx.lineTo(x + 70, this.bY);
      ctx.lineTo(x + 10, this.bY);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawSeaweed(now) {
    const { ctx, w } = this;
    const sway = this.q.seaweedSway;
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = k ? '#3fae5a' : '#2d8a46';
      ctx.lineWidth = 6 - k * 2;
      ctx.beginPath();
      SEAWEED.forEach((sx, i) => {
        const x0 = sx * w + k * 8;
        const height = 50 + (i % 3) * 28;
        const s = sway ? Math.sin(now * 1.4 + i + k) * 14 : 6;
        ctx.moveTo(x0, this.bY + 6);
        ctx.bezierCurveTo(x0 + s, this.bY - height * 0.4, x0 - s, this.bY - height * 0.7, x0 + s * 1.3, this.bY - height);
      });
      ctx.stroke();
    }
  }

  drawAmbientBubbles(now) {
    const { ctx, w } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < this.q.bubbles; i++) {
      const p = (now * 0.07 + i * 0.137) % 1;
      const x = ((i * 0.618) % 1) * w + Math.sin(now * 2 + i) * 6;
      const y = lerp(this.bY, this.sY, p);
      const rr = 2 + (i % 3);
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, Math.PI * 2);
    }
    ctx.stroke();
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
        ctx.lineWidth = 3;
        for (let i = 0; i < 2; i++) {
          const rr = 20 + ((v.now * 70 + i * 35) % 70);
          ctx.strokeStyle = `rgba(90,255,140,${1 - rr / 90})`;
          ctx.beginPath();
          ctx.arc(s.fish.x, s.fish.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (isFish && v.inRange && r.phase === 'lure') {
        ctx.fillStyle = 'rgba(255,255,180,0.25)';
        ctx.beginPath();
        ctx.arc(s.fish.x, s.fish.y, 40, 0, Math.PI * 2);
        ctx.fill();
      }
      // 在水面以上的魚（跳躍、被釣起來）留給 drawAbove 畫
      if (!s.inAir && s.fish.y >= this.sY) {
        if (s.fishAura) drawAura(ctx, s.fish.x, s.fish.y + s.fish.size * 0.45, s.fish.size * 1.5, s.fish.size * 1.4, ['#ff5a1f', '#ffe066'], s.fishAura, v.now, this.level === 'low');
        if (v.ready?.fish) drawReadyRing(ctx, s.fish.x, s.fish.y, s.fish.size * 0.75, '#ffb347', v.now);
        drawFishChar(ctx, s.fishEmoji, s.fish, v.now, isFish || r.phase !== 'lure' ? s.fishOpts : {});
      }
    }
    if (isFrozen(r) && r.phase !== 'over') drawSprite(ctx, '🍚', s.fish.x, s.fish.y - 38, 26);
    if (s.dizzy) drawSprite(ctx, '💫', s.fish.x, s.fish.y - 30 + Math.sin(v.now * 5) * 3, 26);
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

  drawSurfaceLine(now) {
    const { ctx, w } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= w + 12; x += 12) {
      const y = this.waveY(x, now);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 水面閃光
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 0.173 + now * 0.02) % 1) * w;
      ctx.globalAlpha = Math.max(0, Math.sin(now * 3 + i * 2));
      ctx.fillRect(x, this.waveY(x, now) + 4, 10, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 水面以上 ----------

  drawDeck() {
    const { ctx } = this;
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, this.deckY, this.pierW + 6, 12);
    ctx.fillStyle = '#a8713d';
    ctx.fillRect(0, this.deckY, this.pierW + 6, 4);
    ctx.strokeStyle = 'rgba(60,30,10,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 14; x < this.pierW; x += 18) {
      ctx.moveTo(x, this.deckY);
      ctx.lineTo(x, this.deckY + 12);
    }
    ctx.stroke();
  }

  drawAbove(v, s) {
    const { ctx } = this;
    const r = v.round;
    const fisher = FISHERS[r.fisher];
    const now = v.now;
    // 跳出水面 / 被釣起來的魚
    if (s.fish && (s.inAir || s.fish.y < this.sY)) {
      drawFishChar(ctx, s.fishEmoji, s.fish, now, s.fishOpts);
    }

    this.drawDeck();
    const fx = this.pierW * 0.55;
    if (s.fisherAura) drawAura(ctx, fx, this.deckY, 70, 120, ['#2f8fff', '#c6f0ff'], s.fisherAura, now, this.level === 'low');
    if (v.ready?.fisher) drawReadyRing(ctx, fx, this.deckY - 40, 40, '#8e5cf7', now);
    // 漁夫放大 1.25 倍畫，以腳底為中心縮放
    const scale = 1.25;
    ctx.save();
    ctx.translate(fx, this.deckY);
    ctx.scale(scale, scale);
    const local = drawFisherman(ctx, fisher.look, s.fisherPose, 0, 0, now);
    ctx.restore();
    const toWorld = (p) => [fx + p[0] * scale, this.deckY + p[1] * scale];
    const body = { grip: toWorld(local.grip), head: toWorld(local.head) };
    this.fisherHead = body.head;

    const rod = this.rodGeom(body.grip, s.fisherPose.rodAngle, s.bend, s.lineTo);
    this.lastTip = rod.tip;
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
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(rod.base[0] + 4, rod.base[1] + 3, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 竿尖到浮標 / 魚的魚線
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
      ctx.quadraticCurveTo(rod.tip[0] + 10, rod.tip[1] + len * 0.6, rod.tip[0] + Math.sin(now * 4) * 8, rod.tip[1] + len);
      ctx.stroke();
    }

    if (s.bobber && r.phase === 'lure') this.drawBobber(s.bobber.x, s.bobber.y, 1 - s.bobber.dip * 0.35);
  }

  // 釣竿：根部在漁夫手上，往 angle 方向伸出；有拉力時往目標彎
  rodGeom(base, angle, bend, target) {
    const L = Math.min(this.w * 0.3, 130);
    const straight = [base[0] + Math.cos(angle) * L, base[1] + Math.sin(angle) * L];
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
    const ctrl = [base[0] + Math.cos(angle) * L * 0.55, base[1] + Math.sin(angle) * L * 0.55];
    return { base, tip, ctrl };
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

  // 角色喊話泡泡
  drawBubbles(v, s) {
    if (!v.bubbles) return;
    for (const b of v.bubbles) {
      const age = v.now - b.t0;
      if (age < 0 || age > 1.8) continue;
      const alpha = age < 1.4 ? 1 : 1 - (age - 1.4) / 0.4;
      if (b.who === 'fisher' && this.fisherHead) {
        drawBubble(this.ctx, b.text, this.fisherHead[0] + 20, this.fisherHead[1] - 14, alpha, '#1f6fb2');
      } else if (b.who === 'fish' && s.fish) {
        drawBubble(this.ctx, b.text, s.fish.x, s.fish.y - s.fish.size * 0.6, alpha, '#d35400');
      }
    }
  }

  // ---------- 粒子 ----------

  drawParticles(list, now, screen) {
    const { ctx } = this;
    for (const p of list) {
      if (!!p.screen !== screen) continue;
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
        // pop：一出現先放大再縮回
        const pop = p.pop ? 1 + 0.8 * Math.max(0, 1 - age / 0.15) : 1;
        ctx.font = `900 ${Math.round(p.size * pop)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1 - k * k;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(20,35,60,0.7)';
        const ty = y - k * (p.rise ?? 50);
        ctx.strokeText(p.text, x, ty);
        ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.text, x, ty);
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
      // 放射狀速度線
      const cx = w / 2;
      const cy = h / 2;
      const seed = Math.floor(now * 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + ((seed * 7 + i * 13) % 10) * 0.02;
        const r0 = Math.min(w, h) * (0.32 + ((seed + i * 3) % 5) * 0.03);
        const r1 = Math.max(w, h);
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
      const flash = Math.max(0, 1 - t / 0.25);
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.85})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (r.phase === 'fight' && r.fight) {
      const f = r.fight;
      // 連擊很高：畫面兩側出現速度線
      if (f.combo >= 30) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const y = ((i * 0.071 + now * 1.7) % 1) * h;
          const len = 30 + (i % 4) * 18;
          ctx.moveTo(0, y);
          ctx.lineTo(len, y);
          ctx.moveTo(w, (y + h * 0.37) % h);
          ctx.lineTo(w - len, (y + h * 0.37) % h);
        }
        ctx.stroke();
      }
      // 張力危險：四周閃紅框
      const ratio = f.T / FISHERS[r.fisher].snapAt;
      if (ratio > 0.85 || fishInAir(r)) {
        const a = 0.6 + 0.4 * Math.sin(now * 16);
        if (this.level === 'low') {
          ctx.strokeStyle = `rgba(255,40,40,${a * 0.7})`;
          ctx.lineWidth = 14;
          ctx.strokeRect(0, 0, w, h);
        } else {
          ctx.globalAlpha = a;
          ctx.fillStyle = this.dangerGrad;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
        }
      }
    }

    // 打擊停格的白光
    if (v.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${v.hitFlash * 0.55})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.drawParticles(v.particles, now, true);
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
