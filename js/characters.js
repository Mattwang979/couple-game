// 角色繪圖：手繪身體 + emoji 頭的漁夫、會擺尾衝刺的魚、火焰光環、對話泡泡。
// 全部只用 Canvas 基本圖形 + emoji 圖片快取，不會每幀建立漸層。

import { sprite, drawSprite } from './sprites.js';

const SKIN = '#ffd2a8';
const PANTS = '#3b4a6b';
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 漁夫 ----------

// 姿勢參數：lean 身體後仰（弧度，正 = 往後仰）、crouch 蹲低 0~1、bounce 上下彈跳、
// rodAngle 釣竿基本角度、arms 'grip' | 'up' | 'down'、shake 發抖、sit 跌坐 0~1、crank 捲線器相位
export function fisherPose(s) {
  const p = { lean: 0, crouch: 0.1, bounce: 0, rodAngle: -0.85, arms: 'grip', shake: 0, sit: 0, crank: null, mood: null };
  const t = s.now;
  switch (s.state) {
    case 'cast': {
      // 先往後蓄力，再往前甩
      const k = clamp01(s.t / 0.5);
      const back = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
      p.lean = 0.25 * back - 0.15 * (1 - back) * (k > 0.4 ? 1 : 0);
      p.rodAngle = lerp(-0.85, -2.3, back) + (k > 0.4 ? 0.4 * (1 - back) : 0);
      p.crouch = 0.25;
      break;
    }
    case 'yank':
      p.lean = 0.35 * (1 - clamp01(s.t / 0.35));
      p.rodAngle = -1.55;
      p.crouch = 0.35;
      break;
    case 'hooked':
      p.lean = 0.4 + Math.sin(t * 30) * 0.03;
      p.rodAngle = -1.2;
      p.crouch = 0.6;
      p.shake = 2;
      p.mood = 'excited';
      break;
    case 'fight': {
      const r = s.ratio;
      p.lean = 0.12 + r * 0.35;
      p.crouch = 0.75;
      p.rodAngle = -0.9;
      p.shake = r > 0.75 ? (r - 0.75) * 10 : 0;
      p.crank = s.reeling ? t * 18 : null;
      p.mood = r > 0.85 ? 'danger' : r > 0.65 ? 'sweat' : null;
      // 對魚衝刺的反應：擋下時往後猛拉，被拖走時往前踉蹌
      if (s.react && s.react.t < 0.5) {
        const k = 1 - s.react.t / 0.5;
        if (s.react.kind === 'brace') {
          p.lean += 0.3 * k;
          p.crouch = 0.9;
          p.mood = 'excited';
        } else if (s.react.kind === 'stumble') {
          p.lean -= 0.45 * k;
          p.shake = Math.max(p.shake, 4 * k);
          p.mood = 'sweat';
        }
      }
      break;
    }
    case 'win':
      p.bounce = Math.abs(Math.sin(s.t * 7)) * 14 * Math.max(0, 1 - s.t / 2.5);
      p.arms = 'up';
      p.rodAngle = -1.5;
      p.lean = -0.05;
      p.mood = 'happy';
      break;
    case 'lose':
      p.sit = clamp01(s.t / 0.4);
      p.lean = 0.5 * p.sit;
      p.rodAngle = -0.3;
      p.arms = 'down';
      p.mood = 'cry';
      break;
    case 'slump':
      p.lean = -0.3;
      p.crouch = 0.3;
      p.rodAngle = -0.2;
      p.arms = 'down';
      p.mood = 'sad';
      break;
    default:
      // 等待：呼吸起伏
      p.bounce = Math.sin(t * 2.2) * 1.5;
      p.lean = Math.sin(t * 1.1) * 0.03;
  }
  return p;
}

function limb(ctx, a, b, c, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.lineTo(...c);
  ctx.stroke();
}

// 畫漁夫，回傳握竿位置給釣竿用。(x, footY) 是雙腳中心
export function drawFisherman(ctx, look, pose, x, footY, now) {
  const sx = pose.shake ? (Math.random() - 0.5) * pose.shake : 0;
  const sy = pose.shake ? (Math.random() - 0.5) * pose.shake : 0;
  const legLen = 24;
  let hipY = footY - legLen * (1 - pose.crouch * 0.35) - pose.bounce;
  const hipX = x + sx;
  if (pose.sit) hipY = lerp(hipY, footY - 6, pose.sit);
  hipY += sy;
  const lean = pose.lean;
  const torso = 24;
  const neck = [hipX - Math.sin(lean) * torso, hipY - Math.cos(lean) * torso];
  const head = [neck[0] - Math.sin(lean) * 15, neck[1] - Math.cos(lean) * 15];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 腳
  const spread = 8 + pose.crouch * 7;
  const footL = [x - spread + (pose.sit ? 10 * pose.sit : 0), footY - (pose.sit ? 4 * pose.sit : 0)];
  const footR = [x + spread + (pose.sit ? 18 * pose.sit : 0), footY - (pose.sit ? 8 * pose.sit : 0)];
  const kneeOut = 4 + pose.crouch * 8;
  const kneeL = [(hipX + footL[0]) / 2 - kneeOut, (hipY + footL[1]) / 2 - pose.sit * 6];
  const kneeR = [(hipX + footR[0]) / 2 + kneeOut, (hipY + footR[1]) / 2 - pose.sit * 6];
  limb(ctx, [hipX - 3, hipY], kneeL, footL, PANTS, 7);
  limb(ctx, [hipX + 3, hipY], kneeR, footR, PANTS, 7);
  ctx.fillStyle = '#5a3a1a';
  ctx.beginPath();
  ctx.ellipse(footL[0] - 2, footL[1] + 1, 6, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(footR[0] + 2, footR[1] + 1, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // 身體
  ctx.strokeStyle = look.body;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(neck[0], neck[1]);
  ctx.stroke();
  ctx.strokeStyle = look.trim;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(hipX - 7, hipY - 3);
  ctx.lineTo(hipX + 7, hipY - 3);
  ctx.stroke();

  // 手：握竿位置在胸前
  const shoulder = [neck[0] + Math.sin(lean) * -4, neck[1] + 5];
  let grip;
  let hand2;
  if (pose.arms === 'up') {
    grip = [shoulder[0] + 4, shoulder[1] - 24];
    hand2 = [shoulder[0] - 10, shoulder[1] - 22];
  } else if (pose.arms === 'down') {
    grip = [shoulder[0] + 14, shoulder[1] + 16];
    hand2 = [shoulder[0] - 6, shoulder[1] + 20];
  } else {
    grip = [hipX + 14 - Math.sin(lean) * 12, hipY - 12 - Math.cos(lean) * 2];
    hand2 = pose.crank !== null
      ? [grip[0] + 4 + Math.cos(pose.crank) * 5, grip[1] + 6 + Math.sin(pose.crank) * 5]
      : [grip[0] - 4, grip[1] + 7];
  }
  const armColor = look.body === '#f4f7fb' ? '#dfe6ee' : look.body;
  for (const hand of [hand2, grip]) {
    const el = [(shoulder[0] + hand[0]) / 2 - 3, Math.max(shoulder[1], hand[1]) + 4];
    limb(ctx, shoulder, el, hand, armColor, 6);
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(hand[0], hand[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 頭
  ctx.save();
  ctx.translate(head[0], head[1]);
  ctx.rotate(-lean * 0.6);
  drawSprite(ctx, look.head, 0, 0, 34);
  drawHat(ctx, look.hat);
  ctx.restore();

  // 表情符號
  if (pose.mood === 'sweat' || pose.mood === 'danger') {
    const k = (now * 1.5) % 1;
    drawSprite(ctx, '💦', head[0] - 18, head[1] - 8 + k * 12, 14);
  }
  if (pose.mood === 'danger') drawSprite(ctx, '💢', head[0] + 15, head[1] - 16, 16);
  if (pose.mood === 'cry') drawSprite(ctx, '💧', head[0] + 12, head[1] + 2 + ((now * 1.2) % 1) * 10, 12);
  if (pose.mood === 'happy') drawSprite(ctx, '✨', head[0] + 18, head[1] - 18 + Math.sin(now * 6) * 3, 16);
  if (pose.mood === 'sad') drawSprite(ctx, '💧', head[0] + 14, head[1] - 4, 12);
  if (pose.mood === 'excited') drawSprite(ctx, '❗', head[0] + 16, head[1] - 22, 18);

  return { grip, head };
}

function drawHat(ctx, hat) {
  if (hat === 'straw') {
    ctx.fillStyle = '#e8c36a';
    ctx.beginPath();
    ctx.ellipse(0, -12, 21, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -16, 11, 7, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-11, -14, 22, 3);
  } else if (hat === 'pirate') {
    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath();
    ctx.moveTo(-20, -11);
    ctx.quadraticCurveTo(0, -30, 20, -11);
    ctx.quadraticCurveTo(0, -16, -20, -11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, -19, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // 眼罩
    ctx.strokeStyle = '#1d1d1d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-13, -9);
    ctx.lineTo(13, 2);
    ctx.stroke();
    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath();
    ctx.ellipse(6, -2, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (hat === 'scarf') {
    ctx.fillStyle = '#7e57c2';
    ctx.beginPath();
    ctx.moveTo(-15, -6);
    ctx.quadraticCurveTo(0, -24, 15, -6);
    ctx.lineTo(9, -3);
    ctx.quadraticCurveTo(0, -12, -9, -3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-14, -3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- 魚 ----------

// f: { x, y, dir, size, rot, scale, wiggle }，opts: { chomp, dash: {dx, dy}, angry, sweat, hookedMark }
export function drawFishChar(ctx, emoji, f, now, opts = {}) {
  const tail = 1 + Math.sin(now * 12) * 0.06;
  let sx = tail;
  let sy = 1;
  if (opts.chomp) {
    const c = Math.abs(Math.sin(now * 14)) * 0.12;
    sx += c;
    sy += c;
  }
  const img = sprite(emoji, f.size);
  const side = img.cssSize;

  // 衝刺殘影
  if (opts.dash) {
    sx *= 1.3;
    sy *= 0.82;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.12 * (4 - i);
      drawOriented(ctx, img, side, f.x - opts.dash.dx * i * 14, f.y - opts.dash.dy * i * 14, f, sx, sy, now);
    }
    ctx.globalAlpha = 1;
    // 速度線
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 9;
      const len = 26 + ((now * 90 + i * 17) % 20);
      ctx.beginPath();
      ctx.moveTo(f.x - opts.dash.dx * 30 - opts.dash.dy * off, f.y - opts.dash.dy * 30 + opts.dash.dx * off);
      ctx.lineTo(f.x - opts.dash.dx * (30 + len) - opts.dash.dy * off, f.y - opts.dash.dy * (30 + len) + opts.dash.dx * off);
      ctx.stroke();
    }
  }
  drawOriented(ctx, img, side, f.x, f.y, f, sx, sy, now);

  if (opts.angry) drawSprite(ctx, '💢', f.x + 14, f.y - f.size * 0.55, 16);
  if (opts.sweat) drawSprite(ctx, '💦', f.x - 16, f.y - f.size * 0.4 + ((now * 1.6) % 1) * 10, 13);
  if (opts.hookedMark) drawSprite(ctx, '⁉️', f.x, f.y - f.size * 0.75, 22);
}

function drawOriented(ctx, img, side, x, y, f, sx, sy, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(now * 8) * f.wiggle + f.rot);
  // emoji 魚預設面向左；dir = 1 代表往右
  ctx.scale(-f.dir * f.scale * sx, f.scale * sy);
  ctx.drawImage(img, -side / 2, -side / 2, side, side);
  ctx.restore();
}

// ---------- 光環 ----------

// 火焰光環：intensity 0~1；low 畫質只畫一圈光暈
export function drawAura(ctx, x, y, w, h, colors, intensity, now, low) {
  if (intensity <= 0.02) return;
  if (low) {
    ctx.globalAlpha = 0.35 * intensity;
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.4, w * 0.6, h * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const n = 7;
  for (let layer = 0; layer < 2; layer++) {
    ctx.fillStyle = colors[layer];
    ctx.globalAlpha = (layer ? 0.85 : 0.6) * Math.min(1, intensity + 0.3);
    const scale = layer ? 0.6 : 1;
    for (let i = 0; i < n; i++) {
      const bx = x + (i / (n - 1) - 0.5) * w * scale;
      const flick = 0.6 + 0.4 * Math.sin(now * 9 + i * 1.7 + layer);
      const fh = h * scale * flick * (0.5 + intensity * 0.5) * (1 - Math.abs(i / (n - 1) - 0.5) * 0.9);
      const bw = (w / n) * 0.9 * scale;
      ctx.beginPath();
      ctx.moveTo(bx - bw, y);
      ctx.quadraticCurveTo(bx - bw * 0.8, y - fh * 0.6, bx + Math.sin(now * 6 + i) * 3, y - fh);
      ctx.quadraticCurveTo(bx + bw * 0.8, y - fh * 0.6, bx + bw, y);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// 大招集滿：外圈發光
export function drawReadyRing(ctx, x, y, r, color, now) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5 + 0.4 * Math.sin(now * 8);
  ctx.beginPath();
  ctx.arc(x, y, r + Math.sin(now * 8) * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ---------- 對話泡泡 ----------

const widths = new Map();
export function drawBubble(ctx, text, x, y, alpha, color = '#23324a') {
  if (alpha <= 0) return;
  ctx.font = 'bold 13px sans-serif';
  let w = widths.get(text);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    widths.set(text, w);
  }
  const pad = 8;
  const bw = w + pad * 2;
  const bh = 24;
  const bx = Math.max(4, Math.min(ctx.canvas.clientWidth - bw - 4, x - bw / 2));
  const by = y - bh - 10;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10);
  else ctx.rect(bx, by, bw, bh);
  ctx.moveTo(x - 5, by + bh);
  ctx.lineTo(x, by + bh + 8);
  ctx.lineTo(x + 5, by + bh);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + pad, by + bh / 2 + 1);
  ctx.globalAlpha = 1;
}
