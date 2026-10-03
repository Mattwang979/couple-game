// 用 WebAudio 即時合成的小音效，不需要音檔。

let ctx = null;
let muted = false;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) ctx = new AC();
}

export function setMuted(v) {
  muted = v;
}

function tone({ freq = 440, to = freq, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.25, vol = 0.25, freq = 1200, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
}

const SOUNDS = {
  tap: () => tone({ freq: 660, dur: 0.06, vol: 0.1 }),
  cast: () => tone({ freq: 900, to: 300, dur: 0.35, type: 'triangle', vol: 0.12 }),
  splash: () => noise({ dur: 0.3, freq: 900 }),
  plop: () => tone({ freq: 300, to: 120, dur: 0.12, vol: 0.25 }),
  hooked: () => {
    tone({ freq: 300, to: 900, dur: 0.25, type: 'square', vol: 0.12 });
    noise({ dur: 0.4, freq: 1500, delay: 0.05 });
  },
  miss: () => tone({ freq: 400, to: 150, dur: 0.35, type: 'sawtooth', vol: 0.1 }),
  eaten: () => {
    tone({ freq: 500, dur: 0.07, type: 'square', vol: 0.1 });
    tone({ freq: 700, dur: 0.07, type: 'square', vol: 0.1, delay: 0.09 });
  },
  reel: () => tone({ freq: 1400 + Math.random() * 200, dur: 0.03, type: 'square', vol: 0.04 }),
  dash: () => noise({ dur: 0.25, freq: 2500, vol: 0.18 }),
  block: () => tone({ freq: 1200, to: 800, dur: 0.15, type: 'triangle', vol: 0.18 }),
  hit: () => tone({ freq: 200, to: 80, dur: 0.25, type: 'sawtooth', vol: 0.15 }),
  jump: () => noise({ dur: 0.5, freq: 1800, vol: 0.25 }),
  snap: () => {
    tone({ freq: 2000, to: 100, dur: 0.3, type: 'sawtooth', vol: 0.2 });
    noise({ dur: 0.2, freq: 4000, vol: 0.2 });
  },
  ult: () => [0, 0.08, 0.16, 0.24].forEach((d, i) => tone({ freq: 600 + i * 200, dur: 0.12, type: 'triangle', vol: 0.12, delay: d })),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.15, delay: i * 0.12 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.15, delay: i * 0.18 })),
  tick: () => tone({ freq: 1000, dur: 0.04, vol: 0.06 }),
  creak: () => [0, 0.07, 0.14].forEach((d) => tone({ freq: 180, to: 120, dur: 0.06, type: 'sawtooth', vol: 0.12, delay: d })),
};

export function sfx(name) {
  try {
    SOUNDS[name]?.();
  } catch {}
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
