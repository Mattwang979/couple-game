// 連線層：預設用 PeerJS（WebRTC P2P），網址加 ?local 則改用 BroadcastChannel，
// 方便在同一台電腦開兩個分頁測試。兩種實作對外介面相同：
//   link.send(obj)、link.onMessage = fn、link.onOpen = fn、link.onClose = fn、link.close()

const PREFIX = 'couple-fishing-v1-';

const randomCode = () => String(Math.floor(1000 + Math.random() * 9000));

class Link {
  constructor() {
    this.onMessage = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
    this.open = false;
  }
  _opened() {
    if (this.open) return;
    this.open = true;
    this.onOpen();
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    this.onClose();
  }
}

// ---------- PeerJS ----------

class PeerLink extends Link {
  constructor(peer) {
    super();
    this.peer = peer;
    this.conn = null;
  }
  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this._opened());
    conn.on('data', (d) => this.onMessage(d));
    conn.on('close', () => this._closed());
    conn.on('error', () => this._closed());
  }
  send(obj) {
    if (this.conn && this.conn.open) this.conn.send(obj);
  }
  close() {
    try { this.conn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    this.open = false;
  }
}

function peerErrorText(err) {
  switch (err?.type) {
    case 'peer-unavailable': return '找不到這個房間，確認一下房號？';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return '連不上配對伺服器，檢查一下網路';
    case 'browser-incompatible': return '這個瀏覽器不支援連線，換 Chrome 或 Safari 試試';
    default: return '連線失敗，再試一次';
  }
}

function createPeerHost(onCode) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = randomCode();
      const peer = new window.Peer(PREFIX + code, { debug: 0 });
      const link = new PeerLink(peer);
      peer.on('open', () => {
        onCode(code);
        resolve(link);
      });
      peer.on('connection', (conn) => {
        if (link.conn) {
          // 房間已經有人了
          conn.on('open', () => conn.close());
          return;
        }
        link.attach(conn);
      });
      peer.on('disconnected', () => {
        // 跟配對伺服器斷線不影響已建立的 P2P 連線，試著重新註冊房號
        if (!peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && tries++ < 5) {
          peer.destroy();
          attempt();
        } else if (!link.conn) {
          peer.destroy();
          reject(new Error(peerErrorText(err)));
        }
      });
    };
    attempt();
  });
}

function joinPeer(code) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer({ debug: 0 });
    const link = new PeerLink(peer);
    const timer = setTimeout(() => {
      link.close();
      reject(new Error('連線逾時，確認一下房號或網路'));
    }, 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      link.attach(conn);
      conn.on('open', () => {
        clearTimeout(timer);
        resolve(link);
      });
    });
    peer.on('error', (err) => {
      if (link.open) return;
      clearTimeout(timer);
      link.close();
      reject(new Error(peerErrorText(err)));
    });
  });
}

// ---------- BroadcastChannel（本機測試用） ----------

class LocalLink extends Link {
  constructor(code, role) {
    super();
    this.role = role;
    this.ch = new BroadcastChannel(PREFIX + code);
    this.ch.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.from === role) return;
      if (msg.kind === 'knock' && role === 'host') {
        if (this.open) return;
        this.ch.postMessage({ from: role, kind: 'welcome' });
        this._opened();
      } else if (msg.kind === 'welcome' && role === 'guest') {
        this._opened();
      } else if (msg.kind === 'bye') {
        this._closed();
      } else if (msg.kind === 'data' && this.open) {
        this.onMessage(msg.data);
      }
    };
    addEventListener('pagehide', () => this.close());
  }
  send(obj) {
    if (this.open) this.ch.postMessage({ from: this.role, kind: 'data', data: obj });
  }
  close() {
    try {
      this.ch.postMessage({ from: this.role, kind: 'bye' });
      this.ch.close();
    } catch {}
    this.open = false;
  }
}

// ---------- 對外 ----------

export function hostRoom({ local, onCode }) {
  if (local) {
    const code = randomCode();
    const link = new LocalLink(code, 'host');
    onCode(code);
    return Promise.resolve(link);
  }
  if (!window.Peer) return Promise.reject(new Error('連線元件載入失敗，重新整理看看'));
  return createPeerHost(onCode);
}

export function joinRoom(code, { local }) {
  if (local) {
    return new Promise((resolve, reject) => {
      const link = new LocalLink(code, 'guest');
      const timer = setTimeout(() => {
        link.close();
        reject(new Error('找不到這個房間（本機模式）'));
      }, 3000);
      link.onOpen = () => {
        clearTimeout(timer);
        resolve(link);
      };
      link.ch.postMessage({ from: 'guest', kind: 'knock' });
    });
  }
  if (!window.Peer) return Promise.reject(new Error('連線元件載入失敗，重新整理看看'));
  return joinPeer(code);
}
