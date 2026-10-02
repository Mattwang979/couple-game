# 釣到你了！🎣

情侶用兩支手機連線玩的釣魚對戰遊戲。不用登入、不用下載，兩人輪流當魚和漁夫。

- 玩法企劃：[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)

## 怎麼玩

1. 一個人按「開房間」，畫面會出現 4 位數房號和 QR code
2. 另一個人輸入房號（或掃 QR code）加入
3. 設定懲罰輪盤 → 猜拳 → 每局秘密選角 → 開打！一共 6 局，最後一局分數 ×2

| | 魚 | 漁夫 |
|---|---|---|
| 暗流試探 | 拖曳畫面游到浮標旁，按住「假咬」騙人、「真咬」吃餌，吃掉 3 個餌就贏 | 點水面拋竿，看浮標判斷魚是不是真咬，真咬時按「提竿！」 |
| 熱血拔河 | 在畫面上滑動掙扎、按「跳！」跳出水面 | 狂點「收線」但別讓張力爆表；魚掙扎時往箭頭方向滑；魚跳起來時要放手 |

## 放上網路（GitHub Pages）

這是純靜態網頁，不需要伺服器：

1. GitHub repo → Settings → Pages → Build and deployment 的 Source 選「GitHub Actions」（選了就生效，不用按 Save）
2. 每次 `main` 有更新，`.github/workflows/pages.yml` 會自動跑測試並發佈；可以在 Actions 分頁看進度，也能手動按「Run workflow」
3. 幾分鐘後用手機打開 `https://<帳號>.github.io/couple-game/` 就能玩

連線用的是 [PeerJS](https://peerjs.com/) 免費的配對伺服器，配對完兩支手機直接 P2P 連線。少數行動網路會擋 P2P，連不上時請兩人連同一個 Wi-Fi。

## 開發

```bash
npm start   # 本機開伺服器 http://localhost:8080
npm test    # 跑遊戲邏輯的單元測試
```

- 在網址後面加 `?local`（例如 `http://localhost:8080/?local`）會改用瀏覽器分頁之間的連線，可以在同一台電腦開兩個分頁自己跟自己玩。電腦上可以用鍵盤：方向鍵/WASD 移動或滑動、J 假咬、K 真咬、空白鍵 提竿/收線/跳、U 大招。
- 角色數值、時間、分數都在 `js/data.js`，調平衡改那裡就好。

| 檔案 | 用途 |
|---|---|
| `js/data.js` | 角色與數值 |
| `js/game.js` | 單局模擬（純邏輯，可測試） |
| `js/match.js` | 整場流程：設定 → 猜拳 → 選角 → 對戰 → 結算 |
| `js/net.js` | 連線（PeerJS / 本機測試用 BroadcastChannel） |
| `js/main.js` | 進入點、房主主迴圈、狀態同步 |
| `js/play.js` / `js/render.js` | 對戰畫面的操作、HUD 與 Canvas 繪圖 |
| `js/ui.js` | 其他畫面（選角、結算、輪盤…） |
| `vendor/` | PeerJS 與 QR code 函式庫（MIT） |
