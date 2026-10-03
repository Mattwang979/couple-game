// 進入點：首頁、開房／加入、房主主迴圈與狀態同步。
// 房主手機負責所有判定，每 50ms 把狀態傳給對方；對方只送操作過來。

import { hostRoom, joinRoom } from './net.js';
import { createMatch, matchAction, tickMatch } from './match.js';
import { Screens } from './ui.js';
import { PlayScreen } from './play.js';
import { unlockAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const LOCAL = params.has('local');
const NAME_KEY = 'couple-fishing-name';
const TIMEOUT_MS = 20000;
const $ = (id) => document.getElementById(id);

let link = null;
let me = null;
let match = null;
let screens = null;
let play = null;
let lastHeard = 0;
let lastStateAt = 0; // 最近一次拿到新狀態的時間（房主：模擬一步；對方：收到封包）
let ended = false;
const timers = [];

// ---------- 小工具 ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

function myName(fallback) {
  const v = $('name').value.trim().slice(0, 8);
  if (v) storage(NAME_KEY, v);
  return v || fallback;
}

function homeUrl() {
  return location.pathname + (LOCAL ? '?local' : '');
}

function inviteUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('room', code);
  if (LOCAL) u.searchParams.set('local', '');
  return u.toString().replace('local=', 'local');
}

// ---------- 狀態同步 ----------

// 選角時不讓對方從封包偷看房主選了什麼
function forGuest(m) {
  if (m.screen === 'select' && m.picks.host && !m.picks.guest) {
    return { ...m, picks: { ...m.picks, host: 'hidden' } };
  }
  return m;
}

function broadcast() {
  if (link && match) link.send({ t: 'state', s: forGuest(match) });
}

function refresh() {
  if (!match || ended) return;
  show(`s-${match.screen}`);
  if (match.screen === 'play') play.start();
  else play.stop();
  screens.render(match);
}

function send(action) {
  if (!match) return;
  if (me === 'host') {
    matchAction(match, 'host', action);
    broadcast();
    refresh();
  } else {
    link.send({ t: 'act', a: action });
  }
}

function lost(msg) {
  if (ended) return;
  ended = true;
  timers.forEach(clearInterval);
  play?.stop();
  $('lost-msg').textContent = msg;
  $('overlay-lost').hidden = false;
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  lastHeard = performance.now();
  if (me === 'host') {
    if (msg.t === 'hello' && !match) {
      const guestName = String(msg.name || '').trim().slice(0, 8) || '對手';
      match = createMatch({ hostName: myName('房主'), guestName });
      startHostLoop();
      broadcast();
      refresh();
    } else if (msg.t === 'act' && match) {
      matchAction(match, 'guest', msg.a);
    }
  } else if (msg.t === 'state') {
    match = msg.s;
    lastStateAt = performance.now();
    refresh();
  }
}

function startHostLoop() {
  let last = performance.now();
  let n = 0;
  timers.push(setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tickMatch(match, dt);
    lastStateAt = now;
    refresh();
    if (++n % 2 === 0) broadcast();
  }, 25));
}

function beginSession(role) {
  me = role;
  screens = new Screens({ send, me });
  play = new PlayScreen({ send, getMatch: () => match, me, stateAge: () => performance.now() - lastStateAt });
  lastHeard = performance.now();
  link.onMessage = onMessage;
  link.onClose = () => lost('對方離開了。');
  timers.push(setInterval(() => {
    if (!link.open) return;
    link.send({ t: 'ping' });
    if (performance.now() - lastHeard > TIMEOUT_MS) lost('連線好像斷了，重新開一個房間吧。');
  }, 1000));
}

// ---------- 開房 / 加入 ----------

async function startHost() {
  unlockAudio();
  myName('房主');
  show('s-lobby');
  $('lobby-title').textContent = '建立房間中…';
  $('lobby-code').textContent = '';
  $('lobby-qr').innerHTML = '';
  $('lobby-hint').textContent = '';
  try {
    link = await hostRoom({
      local: LOCAL,
      onCode: (code) => {
        const url = inviteUrl(code);
        $('lobby-title').textContent = '請對方輸入房號';
        $('lobby-code').textContent = code;
        $('lobby-hint').textContent = '或用對方手機掃 QR code 直接加入';
        try {
          const qr = window.qrcode(0, 'M');
          qr.addData(url);
          qr.make();
          $('lobby-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        } catch {}
        const share = $('btn-share');
        share.hidden = false;
        share.onclick = async () => {
          try {
            if (navigator.share) await navigator.share({ title: '釣到你了！', text: `來釣魚！房號 ${code}`, url });
            else {
              await navigator.clipboard.writeText(url);
              toast('邀請連結已複製');
            }
          } catch {}
        };
      },
    });
    beginSession('host');
    link.onOpen = () => {
      $('lobby-title').textContent = '對方加入了！';
      lastHeard = performance.now();
    };
  } catch (err) {
    show('s-home');
    $('home-msg').textContent = err.message;
  }
}

async function startJoin(code) {
  unlockAudio();
  if (!/^\d{4}$/.test(code)) {
    $('home-msg').textContent = '房號是 4 位數字喔';
    return;
  }
  const name = myName('玩家');
  show('s-lobby');
  $('lobby-title').textContent = `連線到房間 ${code}…`;
  $('lobby-code').textContent = '';
  $('lobby-qr').innerHTML = '';
  $('lobby-hint').textContent = '如果一直連不上，試試兩支手機連同一個 Wi-Fi';
  $('btn-share').hidden = true;
  try {
    link = await joinRoom(code, { local: LOCAL });
    beginSession('guest');
    $('lobby-title').textContent = '連上了！';
    link.send({ t: 'hello', name });
  } catch (err) {
    show('s-home');
    $('home-msg').textContent = err.message;
  }
}

// 方便在瀏覽器 console 除錯
window.__game = {
  get match() { return match; },
  get play() { return play; },
  get me() { return me; },
};

// ---------- 首頁與全域事件 ----------

$('name').value = storage(NAME_KEY) || '';
$('btn-host').addEventListener('click', startHost);
$('btn-join').addEventListener('click', () => startJoin($('join-code').value.trim()));
$('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startJoin($('join-code').value.trim());
});
$('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

$('btn-pause').addEventListener('click', () => {
  if (match) send({ a: match.paused ? 'resume' : 'pause' });
});

document.getElementById('app').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act="home"]');
  if (!el) return;
  try { link?.close(); } catch {}
  location.href = homeUrl();
});

// 切出 App（接電話、看訊息）時自動暫停
document.addEventListener('visibilitychange', () => {
  if (document.hidden && match?.screen === 'play' && !match.paused && !ended) send({ a: 'pause' });
});

const room = params.get('room');
if (room) {
  $('join-code').value = room.replace(/\D/g, '').slice(0, 4);
  if ($('name').value) startJoin($('join-code').value);
  else {
    $('home-msg').textContent = '輸入暱稱後按「加入」';
    $('name').focus();
  }
}
