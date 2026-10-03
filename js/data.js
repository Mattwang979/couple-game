// 角色資料與遊戲數值。改平衡只需要動這個檔案。

export const RULES = {
  totalRounds: 6,

  // 階段一：暗流試探
  lureTime: 75, // 秒，時間到魚餓暈 → 漁夫拿一半分數
  eatTime: 1.4, // 真咬累積多久吃掉一個餌
  eatToWin: 3, // 吃掉幾個餌魚就贏
  castCooldown: 2, // 拋竿冷卻
  castFlight: 0.6, // 浮標飛行時間
  autoCastAfter: 4, // 浮標不在水裡多久會自動拋竿
  hookGrace: 0.2, // 魚放開真咬後還能被提竿的寬限（抵銷網路延遲）
  missRecast: 0.8, // 提竿落空後多久可以再拋

  // 階段二：熱血拔河
  hookedPause: 1.8, // 「中魚！」慢動作特寫
  endShowTime: 3, // 單局結束後播動畫的時間
  fightTime: 60, // 時間到魚掙脫
  startDistance: 40,
  escapeDistance: 65,
  fishPull: 0.9, // 魚每秒往外拉幾公尺（滿體力）
  tensionBase: 30,
  tensionRelax: 1.4, // 張力回到基準的速度
  reelDistance: 0.45, // 每點一下收幾公尺
  reelTension: 5.5, // 每點一下張力增加（穩定每秒 7～9 下最剛好，狂點會爆）
  snapGrace: 0.35, // 張力超過上限要持續多久才會斷線（給反應時間、抵銷延遲）
  reelCost: 1.5, // 每點一下消耗漁夫體力
  tiredReel: 0.5, // 漁夫體力 < 20 時收線效率
  slackLimit: 8, // 張力低於這個值算鬆線
  slackTime: 1.2, // 鬆線多久會脫鉤
  dashWindow: 0.8, // 漁夫反應時間
  dashCost: 18,
  dashCooldown: 1.0,
  jumpCost: 30,
  jumpWarn: 0.35, // 起跳預備
  jumpAir: 1.0, // 在空中的時間
  jumpGap: 0.4, // 鯉躍龍門連跳間隔
  jumpCooldown: 2.5,
  jumpReelTension: 20, // 魚在空中時收線的張力懲罰
  fishRegen: 6,
  fisherRegen: 10,

  // 大招
  chargeRate: 5.5, // 每秒集氣
  chargeOnEat: 15,
  chargeOnMiss: 10,
  chargeOnBlock: 8,

  // 分數
  fishWinPoints: 100,
  baitBonus: 10, // 漁夫釣到魚時，每個剩下的餌加分
  starveRatio: 0.5,
  lastRoundMultiplier: 2,
};

export const FISH = {
  carp: {
    id: 'carp',
    name: '鯉魚',
    emoji: '🐟',
    tag: '平衡新手',
    weight: 100,
    speed: 0.38,
    pull: 1.0,
    shadow: 0.14,
    biteRange: 0.09,
    tell: true,
    passive: '數值平均，沒有弱點',
    ult: { name: '鯉躍龍門', desc: '拔河時連跳 3 次，漁夫要忍住 3 次不收線', phases: ['fight'] },
  },
  shark: {
    id: 'shark',
    name: '鯊魚',
    emoji: '🦈',
    tag: '力量型',
    weight: 150,
    speed: 0.34,
    pull: 1.3,
    shadow: 0.32,
    biteRange: 0.09,
    tell: true,
    passive: '拔河力量 +30%，但魚影超大很好找',
    ult: { name: '咬斷', desc: '拔河時線的張力瞬間 +55', phases: ['fight'] },
  },
  puffer: {
    id: 'puffer',
    name: '河豚',
    emoji: '🐡',
    tag: '心機型',
    weight: 120,
    speed: 0.32,
    pull: 1.0,
    shadow: 0.14,
    biteRange: 0.09,
    tell: false,
    passive: '真咬和假咬的浮標看起來一模一樣',
    ult: { name: '膨脹', desc: '拔河時 3 秒內漁夫收線無效', phases: ['fight'] },
  },
  octopus: {
    id: 'octopus',
    name: '章魚',
    emoji: '🐙',
    tag: '搗蛋型',
    weight: 130,
    speed: 0.35,
    pull: 1.05,
    shadow: 0.12,
    biteRange: 0.13,
    tell: true,
    passive: '觸手長，離餌遠一點也咬得到',
    ult: { name: '噴墨', desc: '漁夫畫面被墨汁遮住 3 秒', phases: ['lure', 'fight'] },
  },
};

export const FISHERS = {
  oldman: {
    id: 'oldman',
    name: '老漁夫',
    emoji: '👴',
    tag: '穩健型',
    reel: 1,
    snapAt: 115,
    baits: 5,
    shadowBonus: 0,
    passive: '線比較耐拉，張力 115 才會斷',
    ult: { name: '穩如泰山', desc: '拔河時 3 秒內張力固定在安全區', phases: ['fight'] },
  },
  pirate: {
    id: 'pirate',
    name: '海盜船長',
    emoji: '🏴‍☠️',
    tag: '爆發型',
    reel: 1.3,
    snapAt: 100,
    baits: 5,
    shadowBonus: 0,
    passive: '收線力量 +30%',
    ult: { name: '魚叉', desc: '拔河時把魚直接拉近 12 公尺', phases: ['fight'] },
  },
  scientist: {
    id: 'scientist',
    name: '科學家',
    emoji: '🧑‍🔬',
    tag: '偵查型',
    reel: 1,
    snapAt: 100,
    baits: 5,
    shadowBonus: 0.14,
    passive: '魚影看得比較清楚',
    ult: { name: '聲納', desc: '顯示魚的位置 3 秒；拔河時反應時間加倍 4 秒', phases: ['lure', 'fight'] },
  },
  grandma: {
    id: 'grandma',
    name: '阿嬤',
    emoji: '👵',
    tag: '心理戰型',
    reel: 1,
    snapAt: 100,
    baits: 6,
    shadowBonus: 0,
    passive: '多帶 1 個餌（共 6 個）',
    ult: { name: '回家吃飯了！', desc: '魚 2 秒不能動', phases: ['lure', 'fight'] },
  },
};

export const DEFAULT_PENALTIES = [
  '餵對方吃一口',
  '幫對方買飲料',
  '按摩 5 分鐘',
  '幫對方拍 10 張美照',
  '今天洗碗',
  '說三個對方的優點',
];

export const REASONS = {
  caught: '釣起來了！',
  starve: '時間到，魚餓暈被撈走了',
  ate: '餌被吃光光',
  nobait: '漁夫的餌用完了',
  snap: '線斷了！',
  unhook: '線太鬆，脫鉤了',
  escape: '魚游走了',
  timeout: '拔河時間到，魚掙脫了',
};
