// emoji 圖片快取：彩色 emoji 用 fillText 畫很慢（尤其 Android），
// 所以每個 emoji 只畫一次到離屏 canvas，之後都用 drawImage。

const cache = new Map();
let dpr = 1;

export function setSpriteScale(scale) {
  if (scale !== dpr) {
    dpr = scale;
    cache.clear();
  }
}

// 回傳一張正方形 canvas，emoji 置中；size 是 CSS 像素
export function sprite(emoji, size) {
  const px = Math.max(8, Math.round(size));
  const key = `${emoji}|${px}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const side = Math.ceil(px * 1.3 * dpr);
  c.width = side;
  c.height = side;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.font = `${px * dpr}px serif`;
  g.fillText(emoji, side / 2, side / 2 + px * dpr * 0.06);
  c.cssSize = side / dpr;
  if (cache.size > 300) cache.clear();
  cache.set(key, c);
  return c;
}

// 把 emoji 畫在 (x, y) 中心
export function drawSprite(ctx, emoji, x, y, size) {
  const c = sprite(emoji, size);
  const s = c.cssSize;
  ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
}
